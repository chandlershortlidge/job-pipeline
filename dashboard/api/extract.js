// Vercel serverless function — Daytona live drop-in.
// POST { image: <base64>, media_type } -> runs the extraction INSIDE a Daytona
// sandbox (stdlib urllib, no pip install) -> returns { job } in jobs.json shape.
//
// Env vars (Vercel project settings): DAYTONA_API_KEY, ANTHROPIC_API_KEY.
import { Daytona } from '@daytona/sdk'
import canonicalMap from './canonicalMap.js'

const MODEL = 'claude-sonnet-4-6'

// Apply the same deterministic normalization the corpus got, so an uploaded job
// increments the right bars (split slash-lists -> map lowercased spelling -> canonical).
function normalizeSkills(skills) {
  const { splits, map } = canonicalMap
  const byCanon = {}
  for (const s of skills || []) {
    const raw = (s.canonical || '').trim()
    const parts = splits[raw.toLowerCase()] || [raw]
    for (const part of parts) {
      // Try, in order: exact lowercased form; the parenthetical acronym (catches
      // "Large Language Models (LLMs)" -> "llms" -> LLMs); the paren-stripped form
      // (catches "Retrieval-Augmented Generation (RAG)" -> "retrieval-augmented generation").
      const k1 = part.toLowerCase()
      const k3 = (part.match(/\(([^)]+)\)/)?.[1] || '').toLowerCase().trim()
      const k2 = k1.replace(/\s*\([^)]*\)/g, '').trim()
      const canon = map[k1] || map[k3] || map[k2] || part
      if (!canon) continue
      if (!byCanon[canon]) {
        byCanon[canon] = { canonical: canon, raw_text: s.raw_text, requirement: s.requirement }
      } else if (s.requirement === 'required') {
        byCanon[canon].requirement = 'required'
      }
    }
  }
  return Object.values(byCanon)
}
const USER_TEXT = 'Extract the job posting from this screenshot.'

// Plain JSON schema (no $ref) for the tool the model must call.
const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    company: { type: ['string', 'null'] },
    title: { type: ['string', 'null'] },
    seniority: { type: ['string', 'null'], enum: ['Junior', 'Mid', 'Senior', null] },
    seniority_signal: { type: ['string', 'null'] },
    seniority_basis: { type: ['string', 'null'], enum: ['stated', 'inferred', null] },
    summary: { type: ['string', 'null'] },
    skills: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          raw_text: { type: 'string' },
          canonical: { type: 'string' },
          requirement: { type: 'string', enum: ['required', 'nice_to_have'] },
        },
        required: ['raw_text', 'canonical', 'requirement'],
      },
    },
  },
  required: ['company', 'title', 'seniority', 'seniority_signal', 'seniority_basis', 'summary', 'skills'],
}

const SYSTEM_PROMPT = `You extract structured data from a SINGLE screenshot of a job posting.
The screenshots are PARTIAL: they may start or end mid-section, and the company/title
may be cropped out or shown only as a logo.

CORE RULE: BE HONEST ABOUT ABSENCE. If a field is not visible in this screenshot,
return null. Never guess or fill gaps. "not stated" beats a wrong guess.

Fields:
- company: the hiring company. May be logo-only (read the logo if you can) or cropped out -> null.
- title: the role name. If the screenshot opens mid-section with no title in frame -> null.
- seniority: one of Junior | Mid | Senior. Usually NOT stated outright -- infer it, but
  follow these ladders STRICTLY (do not freelance):
    Years:    <2yr -> Junior, 2-5yr -> Mid, 5+yr -> Senior
    Language: lead/principal/architect/deep expertise -> Senior;
              proven/production/ownership -> Mid;
              eager to learn/initial experience/strong interest -> Junior
- seniority_signal: the exact phrase or years the label keyed off.
- seniority_basis: "stated" if the posting names the level explicitly, else "inferred".
- summary: 1-2 sentences, what this role wants.
- skills: the SET of distinct technical skills this role asks for. For each, give
  raw_text (as it appeared), canonical (normalized), and requirement.
- requirement: "required" or "nice_to_have". When ambiguous, default to "required".

DISCARD UI chrome -- NOT skills: apply buttons, German UI words (Vollzeit), model-name
corner labels (gpt4), verified checkmarks, bookmark/share icons, nav.`

function sandboxCode(pyParams) {
  // pyParams is a double-JSON-encoded string -> a safe Python string literal.
  return `import json, urllib.request
P = json.loads(${pyParams})
body = {
    "model": P["model"],
    "max_tokens": 1024,
    "system": P["system"],
    "tools": [{"name": "record_job", "description": "Record the extracted job fields. Use null for anything not visible.", "input_schema": P["schema"]}],
    "tool_choice": {"type": "tool", "name": "record_job"},
    "messages": [{"role": "user", "content": [
        {"type": "image", "source": {"type": "base64", "media_type": P["mediaType"], "data": P["image"]}},
        {"type": "text", "text": P["userText"]},
    ]}],
}
req = urllib.request.Request(
    "https://api.anthropic.com/v1/messages",
    data=json.dumps(body).encode(),
    headers={"x-api-key": P["apiKey"], "anthropic-version": "2023-06-01", "content-type": "application/json"},
)
resp = json.loads(urllib.request.urlopen(req).read())
out = None
for block in resp.get("content", []):
    if block.get("type") == "tool_use":
        out = block["input"]
        break
print(json.dumps(out))`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const daytonaKey = process.env.DAYTONA_API_KEY
  const modelKey = process.env.ANTHROPIC_API_KEY
  if (!daytonaKey || !modelKey) {
    return res.status(500).json({ error: 'missing DAYTONA_API_KEY or ANTHROPIC_API_KEY' })
  }

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    return res.status(400).json({ error: 'bad JSON body' })
  }
  const image = body?.image
  const mediaType = body?.media_type || 'image/png'
  if (!image) return res.status(400).json({ error: 'no image provided' })

  const params = JSON.stringify({
    apiKey: modelKey,
    model: MODEL,
    system: SYSTEM_PROMPT,
    userText: USER_TEXT,
    schema: INPUT_SCHEMA,
    image,
    mediaType,
  })
  const pyParams = JSON.stringify(params)

  let sandbox
  try {
    const daytona = new Daytona({ apiKey: daytonaKey })
    // ephemeral + short auto-stop = the sandbox self-deletes even if this function
    // never reaches the explicit delete() below (timeout/error/overlap). Prevents the
    // disk-limit leak from sandboxes piling up.
    sandbox = await daytona.create({ language: 'python', ephemeral: true, autoStopInterval: 2 })
    const r = await sandbox.process.codeRun(sandboxCode(pyParams))
    if (r.exitCode !== 0) {
      return res.status(500).json({ error: 'sandbox error', detail: String(r.result).slice(0, 500) })
    }
    const parsed = JSON.parse(String(r.result).trim())
    if (!parsed) return res.status(500).json({ error: "couldn't parse the screenshot" })
    const job = {
      id: 'live-' + Date.now(),
      source: 'screenshot',
      ...parsed,
      skills: normalizeSkills(parsed.skills),
    }
    return res.status(200).json({ job })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  } finally {
    if (sandbox) {
      try { await sandbox.delete() } catch { /* best effort */ }
    }
  }
}
