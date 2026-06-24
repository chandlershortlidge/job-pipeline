// Daytona de-risk — Part 1: hello-world round-trip, run LOCALLY first.
//
// Goal: prove auth + create sandbox + run code + read output, with nothing else
// in the way. Once this prints the sandbox's output, Part 2 wraps the same call
// in a Vercel function.
//
// ⚠️ UNVERIFIED until run with a real key. The SDK method names below
// (Daytona, .create, .process.codeRun, .delete, response.result/exitCode) are
// from Daytona's current docs — the first real run is the actual test. If a name
// is off, the error will say so and we fix it against the docs.
//
// Run (needs a key in the repo-root .env as DAYTONA_API_KEY=...):
//   cd scratch
//   npm install @daytona/sdk        # one-time
//   node --env-file=../.env daytona_hello.mjs

import { Daytona } from '@daytona/sdk'

const apiKey = process.env.DAYTONA_API_KEY
if (!apiKey) {
  console.error('DAYTONA_API_KEY not set. Add it to the repo-root .env and run with --env-file=../.env')
  process.exit(1)
}

const daytona = new Daytona({ apiKey })

console.log('Creating sandbox...')
const sandbox = await daytona.create({ language: 'python' })
try {
  console.log('Running code in sandbox...')
  const response = await sandbox.process.codeRun('print("hi from daytona")')
  if (response.exitCode !== 0) {
    console.error(`Sandbox error (exit ${response.exitCode}): ${response.result}`)
    process.exitCode = 1
  } else {
    console.log('Sandbox output:', response.result)
    console.log('OK — round-trip works.')
  }
} finally {
  console.log('Deleting sandbox...')
  await sandbox.delete()
}
