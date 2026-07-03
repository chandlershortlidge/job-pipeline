import { createClient } from '@supabase/supabase-js'

// Vite inlines these at BUILD time. If a deploy is missing them (the classic trap:
// the Vercel project had SUPABASE_*/NEXT_PUBLIC_* but no VITE_* vars — see
// DECISIONS.md 2026-07-03), createClient() throws at import and white-screens the
// whole app before React renders.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const missing = []
if (!url) missing.push('VITE_SUPABASE_URL')
if (!anonKey) missing.push('VITE_SUPABASE_ANON_KEY')

// Stand-in used only when the env vars are absent: every query resolves to
// { data: null, error } instead of throwing, so App.jsx falls back to the static
// jobs.json snapshot rather than crashing the page. Covers the only two reads the
// browser makes — `.from('job').select().order()` and `.from('cv').select().order()`.
function stubClient(reason) {
  const result = { data: null, error: new Error(reason) }
  const builder = {
    select: () => builder,
    order: () => builder,
    eq: () => builder,
    limit: () => builder,
    single: () => builder,
    then: (resolve) => resolve(result),
  }
  return { from: () => builder }
}

if (missing.length) {
  console.error(
    `[supabase] Missing env var(s): ${missing.join(', ')}. ` +
      'Rendering the static jobs.json snapshot instead. ' +
      'Set them in Vercel (Production) and redeploy so Vite can inline them.',
  )
}

// Client-side Supabase. Uses the publishable/anon key (safe in the browser — RLS
// allows public reads only; all writes happen server-side with the secret key).
export const supabase = missing.length
  ? stubClient(`Supabase not configured: missing ${missing.join(', ')}`)
  : createClient(url, anonKey)
