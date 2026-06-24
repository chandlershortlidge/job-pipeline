// Vercel serverless function — Daytona de-risk Part 2.
// Same repo, same deploy as the React app (Vercel auto-detects the api/ folder).
// For now it runs a hello-world in a Daytona sandbox and returns the output as JSON.
// On the day, swap the trivial script for the real extraction (vision call + schema)
// and accept an uploaded image from the request body.
import { Daytona } from '@daytona/sdk'

export default async function handler(req, res) {
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'DAYTONA_API_KEY not set in environment' })
  }

  let sandbox
  try {
    const daytona = new Daytona({ apiKey })
    sandbox = await daytona.create({ language: 'python' })
    const response = await sandbox.process.codeRun('print("hi from daytona")')
    return res.status(200).json({ output: response.result, exitCode: response.exitCode })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  } finally {
    if (sandbox) {
      try { await sandbox.delete() } catch { /* best-effort cleanup */ }
    }
  }
}
