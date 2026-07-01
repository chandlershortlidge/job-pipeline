import { createClient } from '@supabase/supabase-js'

// Client-side Supabase. Uses the publishable/anon key (safe in the browser — RLS
// allows public reads only; all writes happen server-side with the secret key).
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)
