// Vercel serverless function — manage saved résumés (the `cv` table).
//   PATCH  { id, name } -> rename
//   DELETE { id }       -> remove   (id may also be passed as ?id= for clients
//                                     that drop DELETE bodies)
// Writes go through the service-role key here because the browser has read-only
// RLS on `cv` (same pattern as extract.js / resume.js — never write from the client).
import { createClient } from '@supabase/supabase-js'

function client() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export default async function handler(req, res) {
  const supabase = client()
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })

  let body = {}
  if (req.body) {
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    } catch {
      return res.status(400).json({ error: 'bad JSON body' })
    }
  }
  const id = body?.id || req.query?.id
  if (!id) return res.status(400).json({ error: 'no id provided' })

  if (req.method === 'PATCH') {
    const name = (body?.name || '').trim()
    if (!name) return res.status(400).json({ error: 'name required' })
    const { data, error } = await supabase
      .from('cv')
      .update({ name })
      .eq('id', id)
      .select('id, name')
      .single()
    if (error) return res.status(500).json({ error: String(error.message || error) })
    return res.status(200).json({ cv: data })
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase.from('cv').delete().eq('id', id)
    if (error) return res.status(500).json({ error: String(error.message || error) })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'PATCH or DELETE only' })
}
