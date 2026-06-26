// Vercel serverless function — Resume match (Phase 4 stretch, additive).
// POST { pdf: <base64>, media_type } -> extracts the candidate's skills INSIDE a Daytona
// sandbox (stdlib urllib, no pip), normalizes them to the chart's canonicals, and returns
// { profile }. The front-end matches the profile against jobs.json client-side.
//
// Mirrors api/extract.js (the proven JD drop-in) exactly, swapping the image content block
// for a PDF `document` block. Kept as a SEPARATE file so the working drop-in can't regress.
//
// Env vars (Vercel project settings): DAYTONA_API_KEY, ANTHROPIC_API_KEY.
import { Daytona } from '@daytona/sdk'
import canonicalMap from './canonicalMap.js'

const MODEL = 'claude-sonnet-4-6'

// Apply the same deterministic normalization the corpus got, so a resume skill lands on the
// SAME canonical the chart uses (split slash-lists -> map lowercased / paren-acronym /
// paren-stripped spelling -> canonical; fallback: keep as-is). Dedupe by canonical.
// (Verified on a real CV: 13 of 25 skills mapped onto required job skills.)
function normalizeSkills(skills) {
  const { splits, map } = canonicalMap
  const byCanon = {}
  for (const s of skills || []) {
    const raw = (s.canonical || '').trim()
    const parts = splits[raw.toLowerCase()] || [raw]
    for (const part of parts) {
      const k1 = part.toLowerCase()
      const k3 = (part.match(/\(([^)]+)\)/)?.[1] || '').toLowerCase().trim()
      const k2 = k1.replace(/\s*\([^)]*\)/g, '').trim()
      const canon = map[k1] || map[k3] || map[k2] || part
      if (!canon) continue
      if (!byCanon[canon]) {
        byCanon[canon] = { canonical: canon, raw_text: s.raw_text }
      }
    }
  }
  return Object.values(byCanon)
}

// "LLMs" rarely appears literally on a résumé even when the candidate clearly does LLM work,
// so most JDs mark it as missing. Deterministic inference (in code, NOT the prompt — per the
// project's normalize-in-code principle, DECISIONS 09:26): if the résumé carries clear
// LLM-signal skills, add "LLMs". Conservative: only strong signals trigger it.
const LLM_SIGNALS = new Set([
  'RAG', 'LangChain', 'LangGraph', 'LangSmith', 'LlamaIndex', 'Prompt engineering',
  'Fine-tuning', 'Tool calling', 'Agents', 'OpenAI API',
])
function addInferredLLMs(skills) {
  const have = new Set(skills.map((s) => s.canonical))
  if (have.has('LLMs')) return skills
  if (skills.some((s) => LLM_SIGNALS.has(s.canonical))) {
    return [...skills, { canonical: 'LLMs', raw_text: 'inferred from LLM tooling' }]
  }
  return skills
}

const USER_TEXT = "Extract the candidate's technical skills from this resume."

// Plain JSON schema (no $ref) for the tool the model must call.
const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: ['string', 'null'] },
    years_experience: { type: ['number', 'null'] },
    skills: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          raw_text: { type: 'string' },
          canonical: { type: 'string' },
        },
        required: ['raw_text', 'canonical'],
      },
    },
  },
  required: ['title', 'years_experience', 'skills'],
}

const SYSTEM_PROMPT = `You extract a candidate's TECHNICAL skills from their resume/CV (a PDF).

List the distinct technical skills, tools, programming languages, frameworks, libraries, and
platforms the candidate actually has experience with -- drawn from their work experience,
projects, and any skills section. BE HONEST: only include skills evidenced in the document;
do not pad the list with things that aren't there.

For each skill give:
- raw_text: the skill as written in the resume.
- canonical: a normalized name for it.

Also extract:
- title: the candidate's most recent or target role (null if unclear).
- years_experience: total professional years if statable from the resume, else null.

DISCARD soft skills and generic words -- NOT skills: teamwork, communication, leadership,
problem-solving, attention to detail, languages spoken, hobbies. Technical only.`

function sandboxCode(pyParams) {
  // pyParams is a double-JSON-encoded string -> a safe Python string literal.
  return `import json, urllib.request
P = json.loads(${pyParams})
body = {
    "model": P["model"],
    "max_tokens": 1024,
    "system": P["system"],
    "tools": [{"name": "record_resume", "description": "Record the candidate's extracted technical skills.", "input_schema": P["schema"]}],
    "tool_choice": {"type": "tool", "name": "record_resume"},
    "messages": [{"role": "user", "content": [
        {"type": "document", "source": {"type": "base64", "media_type": P["mediaType"], "data": P["pdf"]}},
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
  const pdf = body?.pdf
  const mediaType = body?.media_type || 'application/pdf'
  if (!pdf) return res.status(400).json({ error: 'no pdf provided' })

  const params = JSON.stringify({
    apiKey: modelKey,
    model: MODEL,
    system: SYSTEM_PROMPT,
    userText: USER_TEXT,
    schema: INPUT_SCHEMA,
    pdf,
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
    if (!parsed) return res.status(500).json({ error: "couldn't parse the resume" })
    const profile = {
      title: parsed.title ?? null,
      years_experience: parsed.years_experience ?? null,
      skills: addInferredLLMs(normalizeSkills(parsed.skills)),
    }
    return res.status(200).json({ profile })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  } finally {
    if (sandbox) {
      try { await sandbox.delete() } catch { /* best effort */ }
    }
  }
}
