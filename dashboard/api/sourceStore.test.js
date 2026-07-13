// Unit tests for api/sourceStore.js with the Supabase Storage client faked —
// no network (AGENTS.md: never live). Locks: the media-type allowlist (client
// strings never reach storage keys), best-effort nulls on failure, and the
// prefix-based removal shape the delete-cleanup relies on.
import { describe, it, expect } from 'vitest'
import {
  extForMediaType,
  uploadScreenshot,
  uploadCvPdf,
  removeByPrefix,
  signedUrl,
} from './sourceStore.js'

// Minimal fake of supabase.storage.from('sources') — records calls, and can be
// told to fail any operation.
function fakeSupabase({ files = [], failUpload = false, failList = false, failRemove = false, failSign = false } = {}) {
  const calls = { uploads: [], removes: [] }
  const client = {
    storage: {
      from: (bucket) => {
        calls.bucket = bucket
        return {
          upload: async (path, _bytes, opts) => {
            if (failUpload) return { data: null, error: { message: 'upload boom' } }
            calls.uploads.push({ path, contentType: opts?.contentType })
            return { data: { path }, error: null }
          },
          list: async (folder, opts) => {
            if (failList) return { data: null, error: { message: 'list boom' } }
            const names = files
              .filter((f) => f.startsWith(folder + '/'))
              .map((f) => f.slice(folder.length + 1))
              .filter((n) => n.includes(opts?.search ?? ''))
            return { data: names.map((name) => ({ name })), error: null }
          },
          remove: async (paths) => {
            if (failRemove) return { data: null, error: { message: 'remove boom' } }
            calls.removes.push(paths)
            return { data: paths.map((p) => ({ name: p })), error: null }
          },
          createSignedUrl: async (path, ttl) => {
            if (failSign) return { data: null, error: { message: 'Object not found' } }
            calls.signed = { path, ttl }
            return { data: { signedUrl: `https://signed.example/${path}?t=${ttl}` }, error: null }
          },
        }
      },
    },
  }
  return { client, calls }
}

describe('extForMediaType (the allowlist)', () => {
  it('maps the three allowed types to fixed extensions', () => {
    expect(extForMediaType('image/png')).toBe('png')
    expect(extForMediaType('image/jpeg')).toBe('jpg')
    expect(extForMediaType('image/webp')).toBe('webp')
  })
  it('rejects everything else (null → upload skipped)', () => {
    expect(extForMediaType('image/svg+xml')).toBe(null)
    expect(extForMediaType('application/pdf')).toBe(null)
    expect(extForMediaType('../../evil')).toBe(null)
    expect(extForMediaType(undefined)).toBe(null)
  })
})

describe('uploadScreenshot', () => {
  it('uploads to screenshots/<jobId>.<ext> in the sources bucket and returns the path', async () => {
    const { client, calls } = fakeSupabase()
    const path = await uploadScreenshot(client, Buffer.from('img'), 'live-123', 'image/png')
    expect(path).toBe('screenshots/live-123.png')
    expect(calls.bucket).toBe('sources')
    expect(calls.uploads).toEqual([{ path: 'screenshots/live-123.png', contentType: 'image/png' }])
  })
  it('skips disallowed media types without touching storage', async () => {
    const { client, calls } = fakeSupabase()
    const path = await uploadScreenshot(client, Buffer.from('img'), 'live-123', 'image/svg+xml')
    expect(path).toBe(null)
    expect(calls.uploads).toEqual([])
  })
  it('returns null when the upload fails (best-effort, never throws)', async () => {
    const { client } = fakeSupabase({ failUpload: true })
    const path = await uploadScreenshot(client, Buffer.from('img'), 'live-123', 'image/png')
    expect(path).toBe(null)
  })
})

describe('uploadCvPdf', () => {
  it('uploads to cvs/<cvId>.pdf as application/pdf', async () => {
    const { client, calls } = fakeSupabase()
    const path = await uploadCvPdf(client, Buffer.from('pdf'), 17)
    expect(path).toBe('cvs/17.pdf')
    expect(calls.uploads[0].contentType).toBe('application/pdf')
  })
})

describe('removeByPrefix (the delete-cleanup shape)', () => {
  it('removes exactly the files whose name starts with the prefix', async () => {
    const { client, calls } = fakeSupabase({
      files: ['screenshots/live-123.png', 'screenshots/live-1234.png', 'screenshots/other.png'],
    })
    // 'live-123.' matches live-123.png but NOT live-1234.png — the dot terminates the id
    const removed = await removeByPrefix(client, 'screenshots', 'live-123.')
    expect(removed).toEqual(['screenshots/live-123.png'])
    expect(calls.removes).toEqual([['screenshots/live-123.png']])
  })
  it('returns [] when nothing matches or the row never had a file (null-path tolerance)', async () => {
    const { client, calls } = fakeSupabase({ files: ['screenshots/other.png'] })
    expect(await removeByPrefix(client, 'screenshots', 'live-999.')).toEqual([])
    expect(calls.removes).toEqual([])
  })
  it('returns [] on storage errors instead of throwing', async () => {
    const { client } = fakeSupabase({ failList: true })
    expect(await removeByPrefix(client, 'screenshots', 'live-123.')).toEqual([])
    const { client: c2 } = fakeSupabase({ files: ['screenshots/live-123.png'], failRemove: true })
    expect(await removeByPrefix(c2, 'screenshots', 'live-123.')).toEqual([])
  })
})

describe('signedUrl', () => {
  it('returns a URL with the default 3600 s TTL', async () => {
    const { client, calls } = fakeSupabase()
    const url = await signedUrl(client, 'screenshots/live-123.png')
    expect(url).toContain('screenshots/live-123.png')
    expect(calls.signed.ttl).toBe(3600)
  })
  it('returns null for a missing object (maps to 404 in api/file.js)', async () => {
    const { client } = fakeSupabase({ failSign: true })
    expect(await signedUrl(client, 'screenshots/gone.png')).toBe(null)
  })
})

// --- download (spec C1) -----------------------------------------------------
// Dynamic import on purpose: a static `import { download }` of a missing export
// would fail the whole module and take every test above down with it. This way
// only the new tests fail while the feature is absent.
const loadDownload = async () => (await import('./sourceStore.js')).download

// Same fake shape as fakeSupabase above, extended with storage .download().
// The success payload mimics the Blob the supabase-js client returns: an
// object exposing arrayBuffer().
function fakeSupabaseDownload({ bytes = Buffer.from('object-bytes'), failDownload = false, throwDownload = false } = {}) {
  const calls = { downloads: [] }
  const client = {
    storage: {
      from: (bucket) => {
        calls.bucket = bucket
        return {
          download: async (path) => {
            if (throwDownload) throw new Error('network boom')
            if (failDownload) return { data: null, error: { message: 'Object not found' } }
            calls.downloads.push(path)
            return {
              data: { arrayBuffer: async () => Uint8Array.from(bytes).buffer },
              error: null,
            }
          },
        }
      },
    },
  }
  return { client, calls }
}

describe('download (Buffer of object bytes | null, non-throwing)', () => {
  it('is exported from the module', async () => {
    expect(typeof (await loadDownload())).toBe('function')
  })

  it('downloads from the sources bucket and returns a Buffer of the exact object bytes', async () => {
    const download = await loadDownload()
    const bytes = Buffer.from('png-payload-\u{1F4C4}')
    const { client, calls } = fakeSupabaseDownload({ bytes })
    const result = await download(client, 'screenshots/live-123.png')
    expect(calls.bucket).toBe('sources')
    expect(calls.downloads).toEqual(['screenshots/live-123.png'])
    expect(Buffer.isBuffer(result)).toBe(true)
    expect(result.equals(bytes)).toBe(true)
  })

  it('returns null on a storage error (missing object) without throwing', async () => {
    const download = await loadDownload()
    const { client } = fakeSupabaseDownload({ failDownload: true })
    await expect(download(client, 'screenshots/gone.png')).resolves.toBe(null)
  })

  it('returns null when the storage client throws (best-effort, never throws)', async () => {
    const download = await loadDownload()
    const { client } = fakeSupabaseDownload({ throwDownload: true })
    await expect(download(client, 'cvs/17.pdf')).resolves.toBe(null)
  })
})
