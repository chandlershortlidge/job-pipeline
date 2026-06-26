// Resume-match de-risk — Step 1: PDF skill extraction in a Daytona sandbox, in isolation.
//
// Proves, before any wiring: (a) a resume PDF's base64 embeds into the sandbox code string
// the way the JD image did, (b) the Anthropic `document` (PDF) content block works through
// the sandbox's stdlib urllib call, (c) the resume prompt returns sane skills.
// Mirrors dashboard/api/extract.js exactly, swapping the image block -> a PDF document block.
//
// Run from repo root (resolves @daytona from scratch/node_modules, .env from repo root):
//   node --env-file=.env scratch/resume_probe.mjs
// Optional: pass a PDF path as arg 1 (defaults to the CV in scratch/resumes/).

import fs from 'node:fs'
import { Daytona } from '@daytona/sdk'

const MODEL = 'claude-sonnet-4-6'
const PDF_PATH = process.argv[2] || 'scratch/resumes/Chandler_Shortlidge_CV.pdf'

const daytonaKey = process.env.DAYTONA_API_KEY
const modelKey = process.env.ANTHROPIC_API_KEY
if (!daytonaKey || !modelKey) {
  console.error('Missing DAYTONA_API_KEY or ANTHROPIC_API_KEY in .env')
  process.exit(1)
}

// PDF -> base64, no newlines (the API requires a clean base64 string).
const pdfB64 = fs.readFileSync(PDF_PATH).toString('base64')
console.log(`PDF: ${PDF_PATH}  (${(pdfB64.length / 1024).toFixed(0)} KB base64)`)

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

const USER_TEXT = 'Extract the candidate\'s technical skills from this resume.'

function sandboxCode(pyParams) {
  // pyParams is a double-JSON-encoded string -> a safe Python string literal.
  return `import json, urllib.request
P = json.loads(${pyParams})
body = {
    "model": P["model"],
    "max_tokens": 1024,
    "system": P["system"],
    "tools": [{"name": "record_resume", "description": "Record the candidate's extracted skills.", "input_schema": P["schema"]}],
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

const params = JSON.stringify({
  apiKey: modelKey,
  model: MODEL,
  system: SYSTEM_PROMPT,
  userText: USER_TEXT,
  schema: INPUT_SCHEMA,
  pdf: pdfB64,
  mediaType: 'application/pdf',
})
const pyParams = JSON.stringify(params)

const daytona = new Daytona({ apiKey: daytonaKey })
console.log('Creating sandbox...')
const sandbox = await daytona.create({ language: 'python' })
try {
  console.log('Running PDF extraction in sandbox (~15s)...')
  const r = await sandbox.process.codeRun(sandboxCode(pyParams))
  if (r.exitCode !== 0) {
    console.error(`Sandbox error (exit ${r.exitCode}):\n${r.result}`)
    process.exitCode = 1
  } else {
    const profile = JSON.parse(String(r.result).trim())
    console.log('\n=== EXTRACTED PROFILE ===')
    console.log('title:', profile.title)
    console.log('years_experience:', profile.years_experience)
    console.log(`skills (${profile.skills.length}):`)
    for (const s of profile.skills) {
      const same = s.raw_text === s.canonical
      console.log(`  - ${s.canonical}${same ? '' : `   (raw: "${s.raw_text}")`}`)
    }
  }
} finally {
  console.log('\nDeleting sandbox...')
  await sandbox.delete()
}
