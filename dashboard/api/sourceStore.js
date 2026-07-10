// The ONLY code that touches Supabase Storage (bucket "sources") — uploads,
// signed URLs, and removal for JD screenshots + résumé PDFs (storage-blueprint.md #2).
//
// What it does NOT do: create Supabase clients (callers pass their service-role
// client), decide who may read a file (api/file.js owns access), or throw —
// every call is best-effort and returns null / [] on failure, so a storage
// outage never fails an upload, a parse, or a row delete.
//
// Invariants: storage keys are built only from server-generated ids plus an
// allowlisted extension — never from client-supplied strings. Screenshots live
// under screenshots/, CV PDFs under cvs/. This module has no route handler
// export (a stray request to /api/sourceStore has nothing to invoke).

const BUCKET = 'sources'

// Media-type allowlist → fixed extension. Anything else returns null and the
// upload is skipped — client-controlled strings never reach a storage key.
const EXT_BY_MEDIA_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export function extForMediaType(mediaType) {
  return EXT_BY_MEDIA_TYPE[mediaType] ?? null
}

async function upload(supabase, path, bytes, contentType) {
  try {
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType })
    if (error) {
      console.error('storage upload failed:', path, error)
      return null
    }
    return path
  } catch (e) {
    console.error('storage upload threw:', path, e)
    return null
  }
}

// → 'screenshots/<jobId>.<ext>' on success, null on unknown media type or failure.
export async function uploadScreenshot(supabase, bytes, jobId, mediaType) {
  const ext = extForMediaType(mediaType)
  if (!ext) return null
  return upload(supabase, `screenshots/${jobId}.${ext}`, bytes, mediaType)
}

// → 'cvs/<cvId>.pdf' on success, null on failure.
export async function uploadCvPdf(supabase, bytes, cvId) {
  return upload(supabase, `cvs/${cvId}.pdf`, bytes, 'application/pdf')
}

// Remove every object in `folder` whose name starts with `namePrefix`.
// Delete-cleanup calls this with the row id regardless of what the path column
// says (blueprint orphan rule: deterministic prefixes make orphans reachable).
// Returns the removed paths ([] on failure or no matches).
export async function removeByPrefix(supabase, folder, namePrefix) {
  try {
    const { data, error } = await supabase.storage.from(BUCKET).list(folder, { search: namePrefix })
    if (error || !data?.length) return []
    const paths = data
      .filter((f) => f.name.startsWith(namePrefix))
      .map((f) => `${folder}/${f.name}`)
    if (!paths.length) return []
    const { error: rmError } = await supabase.storage.from(BUCKET).remove(paths)
    if (rmError) {
      console.error('storage remove failed:', paths, rmError)
      return []
    }
    return paths
  } catch (e) {
    console.error('storage removeByPrefix threw:', folder, namePrefix, e)
    return []
  }
}

// → signed URL (default 3600 s: covers a lightbox session; a leaked URL dies
// same-day) or null if the object is missing or storage errors.
export async function signedUrl(supabase, path, ttlSeconds = 3600) {
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, ttlSeconds)
    if (error) return null
    return data?.signedUrl ?? null
  } catch (e) {
    console.error('storage signedUrl threw:', path, e)
    return null
  }
}
