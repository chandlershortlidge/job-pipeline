// Step 2 check — invoke the real handler (dashboard/api/resume.js) locally with a mock
// request carrying a real CV, and confirm it returns a valid normalized { profile }.
// This exercises the SAME code Vercel will run (incl. normalizeSkills + canonicalMap reuse).
//
// Run from repo root:  node --env-file=.env scratch/resume_endpoint_test.mjs
import fs from 'node:fs'
import handler from '../dashboard/api/resume.js'

const PDF_PATH = process.argv[2] || 'scratch/resumes/Chandler_Shortlidge_CV.pdf'
const pdf = fs.readFileSync(PDF_PATH).toString('base64')

const req = { method: 'POST', body: { pdf, media_type: 'application/pdf' } }
const res = {
  _status: 200,
  status(c) { this._status = c; return this },
  json(o) { this._body = o; return this },
}

console.log(`Invoking handler with ${PDF_PATH} (~15s, real sandbox)...`)
await handler(req, res)

console.log('HTTP status:', res._status)
const p = res._body?.profile
if (!p) {
  console.error('NO PROFILE. Body:', JSON.stringify(res._body))
  process.exitCode = 1
} else {
  console.log('\n=== NORMALIZED PROFILE (what the front-end receives) ===')
  console.log('title:', p.title)
  console.log('years_experience:', p.years_experience)
  console.log(`skills (${p.skills.length}):`)
  for (const s of p.skills) {
    const same = s.raw_text === s.canonical
    console.log(`  - ${s.canonical}${same ? '' : `   (raw: "${s.raw_text}")`}`)
  }
}
