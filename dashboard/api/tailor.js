// Vercel serverless function — tailor dispatcher (spec C6, slot 9/12).
// POST {action, ...}: 'transcribe' {cvId, overwrite?} -> {fullText};
// 'split' {cvId} -> {sections:[{name,start,end}]}. Anthropic calls go direct
// over fetch (forced tool_use, bodies built by api-lib/tailor/prompts.js);
// PDF bytes come from the private bucket via sourceStore.download using the
// DB row's path — never a client-supplied path.
//
// What it does NOT do (yet): 'generate'/'revise' are T7 — they answer 501
// until the guard pipeline lands. No response ever carries API keys, bucket
// URLs, or signed-URL material (spec C6 final clause).
import { createClient } from '@supabase/supabase-js'
import { download } from './sourceStore.js'
import { buildTranscribeBody, buildSplitBody } from '../api-lib/tailor/prompts.js'
import { anchorSections, sha256Hex } from '../src/tailor/anchor.js'

// One Anthropic messages call. Returns the forced tool_use input object, or
// null on non-200 / missing tool block. Network throws propagate to the caller
// (both map to 502 there).
async function callAnthropic(body, apiKey) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!resp.ok) return null
  const msg = await resp.json()
  const block = (msg.content ?? []).find((b) => b.type === 'tool_use')
  return block?.input ?? null
}

async function loadCv(supabase, cvId) {
  const { data } = await supabase.from('cv').select('*').eq('id', cvId).maybeSingle()
  return data ?? null
}

// transcribe: PDF bytes -> full_text ground truth. A new transcript always
// nulls cv.sections in the same update — any prior split is stale by definition.
async function transcribe(supabase, apiKey, body, res) {
  const cv = await loadCv(supabase, body?.cvId)
  if (!cv) return res.status(404).json({ error: 'cv not found' })
  if (cv.full_text != null && body?.overwrite !== true) {
    return res.status(409).json({ error: 'full_text exists; pass overwrite:true' })
  }
  if (!cv.pdf_path) return res.status(404).json({ error: 'cv has no stored pdf' })
  const bytes = await download(supabase, cv.pdf_path)
  if (!bytes) return res.status(404).json({ error: 'stored pdf not found' })

  let input
  try {
    input = await callAnthropic(buildTranscribeBody({ pdfBase64: bytes.toString('base64') }), apiKey)
  } catch {
    input = null
  }
  const fullText = input?.full_text
  if (typeof fullText !== 'string') return res.status(502).json({ error: 'transcription failed' })

  const { error } = await supabase
    .from('cv')
    .update({ full_text: fullText, sections: null })
    .eq('id', body.cvId)
  if (error) return res.status(500).json({ error: 'persist failed' })
  return res.status(200).json({ fullText })
}

// split: full_text -> section offsets via the model's verbatim quotes,
// anchored (exact then fuzzy) by the REAL anchorSections. Coverage failure is
// loud (422 + gap) and writes nothing; success persists {full_text_hash,
// sections} so generate can detect staleness later.
async function split(supabase, apiKey, body, res) {
  const cv = await loadCv(supabase, body?.cvId)
  if (!cv || cv.full_text == null) return res.status(404).json({ error: 'cv full_text not found' })

  let input
  try {
    input = await callAnthropic(buildSplitBody({ fullText: cv.full_text }), apiKey)
  } catch {
    input = null
  }
  const quotes = input?.sections
  if (!Array.isArray(quotes)) return res.status(502).json({ error: 'split failed' })

  const anchored = anchorSections(cv.full_text, quotes)
  if (!anchored.ok) return res.status(422).json({ error: 'split coverage failed', gap: anchored.gap })

  const stored = { full_text_hash: await sha256Hex(cv.full_text), sections: anchored.sections }
  const { error } = await supabase.from('cv').update({ sections: stored }).eq('id', body.cvId)
  if (error) return res.status(500).json({ error: 'persist failed' })
  return res.status(200).json({ sections: anchored.sections })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    return res.status(400).json({ error: 'bad JSON body' })
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!url || !key || !apiKey) return res.status(500).json({ error: 'tailor not configured' })
  const supabase = createClient(url, key)

  switch (body?.action) {
    case 'transcribe':
      return transcribe(supabase, apiKey, body, res)
    case 'split':
      return split(supabase, apiKey, body, res)
    case 'generate':
    case 'revise':
      return res.status(501).json({ error: 'not implemented' }) // T7
    default:
      return res.status(400).json({ error: 'unknown action' })
  }
}
