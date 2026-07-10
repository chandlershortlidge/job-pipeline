// Vercel serverless function — delete a job listing (and its skills).
//   DELETE ?id=<jobId>   (id may also be passed in the JSON body)
// Writes go through the service-role key because the browser has read-only RLS on the
// job/skill tables (same pattern as cv.js / extract.js — never write from the client).
import { createClient } from '@supabase/supabase-js'
import { removeByPrefix } from './sourceStore.js'

function client() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'DELETE only' })

  const supabase = client()
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })

  let body = {}
  if (req.body) {
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    } catch {
      /* ignore — id can still come from the query string */
    }
  }
  const id = body?.id || req.query?.id
  if (!id) return res.status(400).json({ error: 'no id provided' })

  // Remove the job's skills first (skill.job_id FK), then the job row itself.
  const { error: skillErr } = await supabase.from('skill').delete().eq('job_id', id)
  if (skillErr) return res.status(500).json({ error: String(skillErr.message || skillErr) })
  const { error: jobErr } = await supabase.from('job').delete().eq('id', id)
  if (jobErr) return res.status(500).json({ error: String(jobErr.message || jobErr) })

  // Remove the stored screenshot by deterministic prefix — regardless of what the
  // path column said, so files orphaned by partial failures stay reachable (orphan
  // rule, storage-blueprint.md). Best-effort: a storage error never fails the delete.
  await removeByPrefix(supabase, 'screenshots', id + '.')

  return res.status(200).json({ ok: true })
}
