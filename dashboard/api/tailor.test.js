// Tests for the tailor dispatcher (api/tailor.js) — T6 scope ONLY: preamble
// (method/env/action guards) + transcribe + split (spec C6). generate/revise
// are T7 and are not exercised here beyond the unknown-action 400.
//
// House pattern (extract.test.js / file.test.js): mock req/res, Supabase
// client mocked via vi.mock, Anthropic mocked via global fetch,
// sourceStore.download mocked. anchor.js + prompts.js are REAL (pure) —
// fixtures are crafted so the good quotes anchor cleanly and the gap fixture
// fails the coverage rule. No network, no real LLM call (AGENTS.md: never live).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { anchorSections, sha256Hex } from '../src/tailor/anchor.js'

// ---------------------------------------------------------------------------
// Controllable fake Supabase (DB only — storage goes through sourceStore).
const supa = {
  rows: { cv: {} }, // table -> id -> row
  updates: [], // { table, id, values }
  reset() {
    this.rows = { cv: {} }
    this.updates = []
  },
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => ({
      select: () => ({
        eq: (_col, id) => {
          const row = supa.rows[table]?.[id] ?? null
          return {
            maybeSingle: async () => ({ data: row, error: null }),
            single: async () =>
              row ? { data: row, error: null } : { data: null, error: { message: 'no rows' } },
          }
        },
      }),
      update: (values) => ({
        eq: async (_col, id) => {
          supa.updates.push({ table, id, values: { ...values } })
          const row = supa.rows[table]?.[id]
          if (row) Object.assign(row, values)
          return { data: null, error: null }
        },
      }),
      // tailor_log is T7 territory — tolerate best-effort inserts, never assert.
      insert: async () => ({ error: null }),
    }),
  }),
}))

// sourceStore.download mocked; every other export stays real.
const store = {
  bytes: null,
  calls: [],
  reset() {
    this.bytes = Buffer.from('%PDF-1.4 tiny test fixture')
    this.calls = []
  },
}
vi.mock('./sourceStore.js', async (importOriginal) => ({
  ...(await importOriginal()),
  download: async (_supabase, path) => {
    store.calls.push(path)
    return store.bytes
  },
}))

const handler = (await import('./tailor.js')).default

// ---------------------------------------------------------------------------
// Anthropic over global fetch: queue-driven, records every call.
const anthropic = {
  queue: [], // Response-likes (or Error instances to throw) served in order
  calls: [], // { url, headers, body }
  reset() {
    this.queue = []
    this.calls = []
  },
}
function toolUse(name, input) {
  const payload = {
    id: 'msg_test',
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 'tu_test', name, input }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }
  return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) }
}
function apiError(status) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { type: 'api_error', message: 'boom' } }),
    text: async () => 'boom',
  }
}

// Every response body produced anywhere in this suite lands here — the final
// leakage sweep serializes them all (spec C6: no key/URL material, ever).
const allResponses = []
function mockRes() {
  const res = { statusCode: null, body: null }
  res.status = (code) => ((res.statusCode = code), res)
  res.json = (obj) => ((res.body = obj), allResponses.push(obj), res)
  res.setHeader = () => res
  res.end = (body) => (body !== undefined && allResponses.push(body), res)
  return res
}

const ANTHROPIC_KEY = 'sk-ant-test-secret-key'
const SERVICE_KEY = 'service-role-test-secret'

// Fixture transcript: headings + first lines the REAL anchor.js can anchor.
const FULL_TEXT = [
  'Jane Doe',
  'jane@example.com | Amsterdam',
  '',
  'EXPERIENCE',
  'Software engineer at Initech since 2019.',
  'Shipped the billing pipeline end to end.',
  '',
  'PROJECTS',
  'Built a job pipeline with LLM extraction.',
  '',
  'SKILLS',
  'Python, JavaScript, SQL',
].join('\n')

const GOOD_QUOTES = [
  { name: 'Experience', heading_quote: 'EXPERIENCE', first_line_quote: 'Software engineer at Initech since 2019.' },
  { name: 'Projects', heading_quote: 'PROJECTS', first_line_quote: 'Built a job pipeline with LLM extraction.' },
  { name: 'Skills', heading_quote: 'SKILLS', first_line_quote: 'Python, JavaScript, SQL' },
]

// Bogus heading nowhere near anything in FULL_TEXT — exact AND fuzzy must miss.
const GAP_QUOTES = [
  GOOD_QUOTES[0],
  {
    name: 'Certifications',
    heading_quote: 'CERTIFIED KUBERNETES ADMINISTRATOR CREDENTIALS',
    first_line_quote: 'CKA issued 2024 by the CNCF.',
  },
]

function post(body) {
  return { method: 'POST', body }
}

beforeEach(() => {
  supa.reset()
  store.reset()
  anthropic.reset()
  process.env.SUPABASE_URL = 'https://fake.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
  process.env.ANTHROPIC_API_KEY = ANTHROPIC_KEY
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, opts = {}) => {
      anthropic.calls.push({
        url: String(url),
        headers: opts.headers ?? {},
        body: opts.body ? JSON.parse(opts.body) : null,
      })
      const next = anthropic.queue.shift()
      if (!next) throw new Error('unexpected Anthropic call — this test queued no response')
      if (next instanceof Error) throw next
      return next
    })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /api/tailor — dispatcher preamble', () => {
  it('is POST only: GET and DELETE get 405', async () => {
    for (const method of ['GET', 'DELETE']) {
      const res = mockRes()
      await handler({ method, body: { action: 'transcribe', cvId: 7 } }, res)
      expect(res.statusCode).toBe(405)
    }
  })

  it('unknown action → 400', async () => {
    const res = mockRes()
    await handler(post({ action: 'nope', cvId: 7 }), res)
    expect(res.statusCode).toBe(400)
  })

  it('missing env (each of the three) → 500 "tailor not configured" before any work', async () => {
    for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY']) {
      process.env.SUPABASE_URL = 'https://fake.supabase.co'
      process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
      process.env.ANTHROPIC_API_KEY = ANTHROPIC_KEY
      delete process.env[name]
      supa.rows.cv[7] = { id: 7, pdf_path: 'cvs/7.pdf', full_text: null, sections: null }
      const res = mockRes()
      await handler(post({ action: 'transcribe', cvId: 7 }), res)
      expect(res.statusCode).toBe(500)
      expect(res.body).toEqual({ error: 'tailor not configured' })
    }
    expect(anthropic.calls).toHaveLength(0) // env guard fires before any Anthropic work
  })
})

describe('action=transcribe (Anthropic + Supabase mocked)', () => {
  it('happy path: 200 {fullText}, persists full_text, nulls cv.sections', async () => {
    supa.rows.cv[7] = { id: 7, pdf_path: 'cvs/7.pdf', full_text: null, sections: null }
    anthropic.queue.push(toolUse('record_transcript', { full_text: FULL_TEXT }))

    const res = mockRes()
    await handler(post({ action: 'transcribe', cvId: 7 }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ fullText: FULL_TEXT })
    // persisted ground truth + split invalidation in the same update pass
    expect(supa.rows.cv[7].full_text).toBe(FULL_TEXT)
    expect(
      supa.updates.some((u) => u.table === 'cv' && 'sections' in u.values && u.values.sections === null)
    ).toBe(true)
    // bytes came from the DB row's path via sourceStore.download — never a client string
    expect(store.calls).toEqual(['cvs/7.pdf'])
    // house forced-tool call shape (spec S1): record_transcript over the PDF bytes
    expect(anthropic.calls).toHaveLength(1)
    const call = anthropic.calls[0]
    expect(call.url).toContain('api.anthropic.com/v1/messages')
    expect(call.headers['x-api-key']).toBe(ANTHROPIC_KEY)
    expect(call.body.tool_choice).toEqual({ type: 'tool', name: 'record_transcript' })
    expect(call.body.messages[0].content[0].source.data).toBe(store.bytes.toString('base64'))
  })

  it('unknown cv → 404', async () => {
    const res = mockRes()
    await handler(post({ action: 'transcribe', cvId: 999 }), res)
    expect(res.statusCode).toBe(404)
  })

  it('refuses silent overwrite: existing full_text without overwrite → 409, cv untouched', async () => {
    supa.rows.cv[7] = { id: 7, pdf_path: 'cvs/7.pdf', full_text: 'the original transcript', sections: null }
    const res = mockRes()
    await handler(post({ action: 'transcribe', cvId: 7 }), res)
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'full_text exists; pass overwrite:true' })
    expect(supa.rows.cv[7].full_text).toBe('the original transcript')
    expect(supa.updates).toHaveLength(0)
    expect(anthropic.calls).toHaveLength(0)
  })

  it('overwrite:true replaces full_text AND nulls the stale split', async () => {
    supa.rows.cv[7] = {
      id: 7,
      pdf_path: 'cvs/7.pdf',
      full_text: 'the original transcript',
      sections: { full_text_hash: 'stale-hash', sections: [{ name: 'Experience', start: 0, end: 10 }] },
    }
    anthropic.queue.push(toolUse('record_transcript', { full_text: FULL_TEXT }))

    const res = mockRes()
    await handler(post({ action: 'transcribe', cvId: 7, overwrite: true }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ fullText: FULL_TEXT })
    expect(supa.rows.cv[7].full_text).toBe(FULL_TEXT)
    expect(supa.rows.cv[7].sections).toBe(null) // a new transcript invalidates any split
  })

  it('cv without pdf_path → 404, and the model is never called', async () => {
    supa.rows.cv[7] = { id: 7, pdf_path: null, full_text: null, sections: null }
    const res = mockRes()
    await handler(post({ action: 'transcribe', cvId: 7 }), res)
    expect(res.statusCode).toBe(404)
    expect(anthropic.calls).toHaveLength(0)
  })

  it('stored object gone (download → null) → 404', async () => {
    supa.rows.cv[7] = { id: 7, pdf_path: 'cvs/7.pdf', full_text: null, sections: null }
    store.bytes = null
    const res = mockRes()
    await handler(post({ action: 'transcribe', cvId: 7 }), res)
    expect(res.statusCode).toBe(404)
    expect(anthropic.calls).toHaveLength(0)
  })

  it('Anthropic non-200 → 502 and nothing is persisted', async () => {
    supa.rows.cv[7] = { id: 7, pdf_path: 'cvs/7.pdf', full_text: null, sections: null }
    anthropic.queue.push(apiError(500))
    const res = mockRes()
    await handler(post({ action: 'transcribe', cvId: 7 }), res)
    expect(res.statusCode).toBe(502)
    expect(supa.updates).toHaveLength(0)
    expect(supa.rows.cv[7].full_text).toBe(null)
  })
})

describe('action=split (Anthropic + Supabase mocked, REAL anchor.js)', () => {
  it('missing cv row or null full_text → 404', async () => {
    const r1 = mockRes()
    await handler(post({ action: 'split', cvId: 999 }), r1)
    expect(r1.statusCode).toBe(404)

    supa.rows.cv[7] = { id: 7, pdf_path: 'cvs/7.pdf', full_text: null, sections: null }
    const r2 = mockRes()
    await handler(post({ action: 'split', cvId: 7 }), r2)
    expect(r2.statusCode).toBe(404)
    expect(anthropic.calls).toHaveLength(0)
  })

  it('happy path: anchors the model quotes, persists {full_text_hash, sections}', async () => {
    // Fixture sanity: the real anchor must accept these quotes.
    const expected = anchorSections(FULL_TEXT, GOOD_QUOTES)
    expect(expected.ok).toBe(true)

    supa.rows.cv[7] = { id: 7, pdf_path: 'cvs/7.pdf', full_text: FULL_TEXT, sections: null }
    anthropic.queue.push(toolUse('record_sections', { sections: GOOD_QUOTES }))

    const res = mockRes()
    await handler(post({ action: 'split', cvId: 7 }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.sections).toEqual(expected.sections)
    // spans tile the transcript, name block included
    expect(res.body.sections[0]).toEqual({ name: '_header', start: 0, end: expect.any(Number) })
    expect(res.body.sections.at(-1).end).toBe(FULL_TEXT.length)
    // persisted split = hash of full_text exactly as stored + the offsets
    expect(supa.rows.cv[7].sections).toEqual({
      full_text_hash: await sha256Hex(FULL_TEXT),
      sections: expected.sections,
    })
    // forced-tool split call carries the stored transcript
    expect(anthropic.calls).toHaveLength(1)
    expect(anthropic.calls[0].body.tool_choice).toEqual({ type: 'tool', name: 'record_sections' })
    expect(JSON.stringify(anthropic.calls[0].body.messages)).toContain('Jane Doe')
  })

  it('coverage failure is loud: 422 {error, gap} and cv.sections NOT written', async () => {
    // Fixture sanity: the real anchor must reject these quotes with this gap.
    const expected = anchorSections(FULL_TEXT, GAP_QUOTES)
    expect(expected.ok).toBe(false)

    supa.rows.cv[7] = { id: 7, pdf_path: 'cvs/7.pdf', full_text: FULL_TEXT, sections: null }
    anthropic.queue.push(toolUse('record_sections', { sections: GAP_QUOTES }))

    const res = mockRes()
    await handler(post({ action: 'split', cvId: 7 }), res)

    expect(res.statusCode).toBe(422)
    expect(res.body.error).toBe('split coverage failed')
    expect(res.body.gap).toEqual(expected.gap)
    expect(res.body.gap.section).toBe('Certifications')
    expect(supa.rows.cv[7].sections).toBe(null)
    expect(supa.updates.filter((u) => 'sections' in u.values)).toHaveLength(0)
  })

  it('Anthropic fetch throw → 502', async () => {
    supa.rows.cv[7] = { id: 7, pdf_path: 'cvs/7.pdf', full_text: FULL_TEXT, sections: null }
    anthropic.queue.push(new Error('ECONNRESET'))
    const res = mockRes()
    await handler(post({ action: 'split', cvId: 7 }), res)
    expect(res.statusCode).toBe(502)
    expect(supa.updates).toHaveLength(0)
  })
})

// Runs LAST in this file: vitest executes tests in declaration order, so every
// response any scenario above produced (200/4xx/5xx) has been recorded.
describe('no secret leakage (spec C6 final clause)', () => {
  it('no response anywhere in this suite carries key, bucket-URL, or signed-URL material', async () => {
    expect(allResponses.length).toBeGreaterThan(0)
    const wire = JSON.stringify(allResponses)
    expect(wire).not.toContain(ANTHROPIC_KEY)
    expect(wire).not.toContain(SERVICE_KEY)
    expect(wire).not.toContain('supabase.co') // covers supabase.co/storage bucket URLs
    expect(wire).not.toContain('signedUrl')
    expect(wire).not.toContain('token=')
  })
})
