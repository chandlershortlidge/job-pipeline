// Tests for the tailor dispatcher (api/tailor.js) — T6: preamble
// (method/env/action guards) + transcribe + split (spec C6). T7 (generate/
// revise guard pipeline) tests are appended at the bottom of this file.
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
// Backward-compatibly extended for T7: multi-row tables (skill,
// project_template) live in `lists`; queries are chainable (.eq().eq()) AND
// awaitable (thenable -> {data:[rows]}); inserts are recorded so tailor_log
// rows can be asserted, and `insertError` simulates a failing log insert.
const supa = {
  rows: { cv: {} }, // table -> id -> row (single-row-by-id tables: cv, job)
  lists: {}, // table -> [rows] (multi-row tables: skill, project_template)
  updates: [], // { table, id, values }
  inserts: [], // { table, values }
  insertError: null, // when set, tailor_log inserts resolve {error: insertError}
  reset() {
    this.rows = { cv: {} }
    this.lists = {}
    this.updates = []
    this.inserts = []
    this.insertError = null
  },
}
function allRows(table) {
  return [...Object.values(supa.rows[table] ?? {}), ...(supa.lists[table] ?? [])]
}
function makeQuery(table, rows) {
  return {
    eq: (col, val) => makeQuery(table, rows.filter((r) => r?.[col] === val)),
    in: (col, vals) => makeQuery(table, rows.filter((r) => (vals ?? []).includes(r?.[col]))),
    order: () => makeQuery(table, rows),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    single: async () =>
      rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'no rows' } },
    then: (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  }
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => ({
      select: () => makeQuery(table, allRows(table)),
      update: (values) => ({
        eq: async (_col, id) => {
          supa.updates.push({ table, id, values: { ...values } })
          const row = supa.rows[table]?.[id]
          if (row) Object.assign(row, values)
          return { data: null, error: null }
        },
      }),
      insert: async (values) => {
        supa.inserts.push({ table, values })
        return { error: table === 'tailor_log' ? supa.insertError : null }
      },
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

// Sweeps every T6 response recorded so far (T7 has its own sweep at the very
// end of the file — vitest executes tests in declaration order).
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

// ===========================================================================
// T7 — generate/revise guard pipeline (spec C6 steps 1–9 + BDD scenarios).
// Everything below is RED by design until api/tailor.js implements the
// pipeline (both actions currently answer 501). provenance.js + prompts.js +
// anchor.js stay REAL; the judge is module-mocked (programmable per test);
// generation calls flow through the same global-fetch queue as T6.

const judgeState = vi.hoisted(() => ({
  queue: [], // {pass, objection, judgeError?} served in order; empty -> pass
  calls: [], // every {bullets, evidence, apiKey} the pipeline handed the judge
}))
vi.mock('../api-lib/tailor/judge.js', () => ({
  judge: async (args) => {
    judgeState.calls.push(args)
    return judgeState.queue.length > 0 ? judgeState.queue.shift() : { pass: true, objection: null }
  },
}))

beforeEach(() => {
  judgeState.queue = []
  judgeState.calls = []
})

const JOB_ID = 'job-1'
// jp-2 carries the 'quetzal' sentinel: it sits in the template corpus but is
// never selected by any test — its text must never surface in any HTTP
// response (final T7 leakage sweep greps for it).
const TEMPLATE_CLAIMS = [
  { id: 'jp-1', text: 'Built a job pipeline with LLM extraction using Python.', skills: ['Python', 'LLMs'] },
  { id: 'jp-2', text: 'Wrote quetzal migration tooling in SQL.', skills: ['SQL'] },
]
const SECTIONS = anchorSections(FULL_TEXT, GOOD_QUOTES).sections
const PROJECTS_SPAN = SECTIONS.find((s) => s.name === 'Projects')
const ORIG_PROJECTS_TEXT = FULL_TEXT.slice(PROJECTS_SPAN.start, PROJECTS_SPAN.end)

// Seed cv 7 (valid split, hash matching full_text unless overridden), job-1
// with required skills Python+LLMs (Docker is nice_to_have, COBOL belongs to
// another job — both must stay out of jdSkills), one project template.
async function seedGenerateFixture({ sections = SECTIONS, hash, templates } = {}) {
  supa.rows.cv[7] = {
    id: 7,
    pdf_path: 'cvs/7.pdf',
    full_text: FULL_TEXT,
    sections: { full_text_hash: hash ?? (await sha256Hex(FULL_TEXT)), sections },
  }
  supa.rows.job = { [JOB_ID]: { id: JOB_ID, title: 'ML Engineer', company: 'Initech' } }
  supa.lists.skill = [
    { job_id: JOB_ID, requirement: 'required', canonical: 'Python' },
    { job_id: JOB_ID, requirement: 'required', canonical: 'LLMs' },
    { job_id: JOB_ID, requirement: 'nice_to_have', canonical: 'Docker' },
    { job_id: 'other-job', requirement: 'required', canonical: 'COBOL' },
  ]
  supa.lists.project_template = templates ?? [{ id: 1, name: 'job-pipeline', claims: TEMPLATE_CLAIMS }]
}

function bulletsResponse(bullets) {
  return toolUse('write_bullets', { bullets })
}
function generateReq(overrides = {}) {
  return post({
    action: 'generate',
    jobId: JOB_ID,
    cvId: 7,
    sectionName: 'Projects',
    claimIds: ['jp-1'],
    pillClaims: [],
    ...overrides,
  })
}
// All tailor_log rows inserted so far, flattened whether the implementation
// inserts row-by-row or in batches.
function tailorLogs() {
  return supa.inserts
    .filter((i) => i.table === 'tailor_log')
    .flatMap((i) => (Array.isArray(i.values) ? i.values : [i.values]))
}
// Prefix = first content block (carries cache_control); suffix = the rest.
function genParts(call) {
  const content = call.body.messages[0].content
  return {
    prefix: content[0],
    suffixText: content
      .slice(1)
      .map((b) => b.text ?? '')
      .join('\n'),
  }
}
function evidenceIds(evidence) {
  return [...new Set((evidence ?? []).map((e) => e.id))].sort()
}

describe('action=generate — guard pipeline (T7)', () => {
  it('verified happy path: 200 {bullets, verified:true}, ONE generation call, one judge call, one pass log per guard', async () => {
    await seedGenerateFixture()
    const good = [{ text: 'Built a job pipeline with LLM extraction.', claim_ids: ['jp-1'] }]
    anthropic.queue.push(bulletsResponse(good))

    const res = mockRes()
    await handler(generateReq(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.verified).toBe(true)
    expect(res.body.bullets).toEqual(good)

    // exactly one generation call; judge consulted exactly once
    expect(anthropic.calls).toHaveLength(1)
    expect(judgeState.calls).toHaveLength(1)
    expect(judgeState.calls[0].bullets).toEqual(good)
    expect(evidenceIds(judgeState.calls[0].evidence)).toEqual(['jp-1', 'orig-Projects'])

    // prompt shape: cached prefix block + per-request suffix with the orig id
    // and the explicit allowlist; jdSkills = required-only, this job only
    const call = anthropic.calls[0]
    expect(call.body.tool_choice).toEqual({ type: 'tool', name: 'write_bullets' })
    const { prefix, suffixText } = genParts(call)
    expect(prefix.cache_control).toEqual({ type: 'ephemeral' })
    expect(prefix.text).toContain('Python')
    expect(prefix.text).not.toContain('COBOL') // other job's skill filtered out
    expect(suffixText).toContain('orig-Projects')
    expect(suffixText).toContain('jp-1')
    expect(suffixText).toContain('Citing any other id is a failure')

    // one tailor_log row per guard evaluation, all pass:true, full row shape
    const logs = tailorLogs()
    expect(logs.map((r) => `${r.guard}:${r.pass}`).sort()).toEqual([
      'digit:true',
      'hard:true',
      'judge:true',
    ])
    for (const row of logs) {
      expect(row).toMatchObject({ job_id: JOB_ID, cv_id: 7, section: 'Projects' })
      expect(row.payload.bullets).toEqual(good)
      // evidence = selected template claim + server-minted orig-claim, id+text
      expect(evidenceIds(row.payload.evidence)).toEqual(['jp-1', 'orig-Projects'])
      const orig = row.payload.evidence.find((e) => e.id === 'orig-Projects')
      expect(orig.text).toBe(ORIG_PROJECTS_TEXT) // full_text.slice(start,end), server-minted
    }
  })

  it('hard guard failing twice → 422 "generation failed provenance", 2 generation calls, TWO hard log rows, judge never runs', async () => {
    await seedGenerateFixture()
    anthropic.queue.push(bulletsResponse([{ text: 'Did impressive things.', claim_ids: [] }]))
    anthropic.queue.push(bulletsResponse([{ text: 'Did impressive things again.', claim_ids: [] }]))

    const res = mockRes()
    await handler(generateReq(), res)

    expect(res.statusCode).toBe(422)
    expect(res.body.error).toBe('generation failed provenance')
    expect(String(res.body.reason)).toContain('claim_ids')

    expect(anthropic.calls).toHaveLength(2) // initial + ONE hard retry
    // the retry suffix carries the validator's objection
    const retry = genParts(anthropic.calls[1])
    expect(retry.suffixText).toContain('no claim_ids')
    expect(judgeState.calls).toHaveLength(0) // hard failure never reaches the judge

    const logs = tailorLogs()
    expect(logs).toHaveLength(2)
    for (const row of logs) expect(row).toMatchObject({ guard: 'hard', pass: false })
  })

  it('foreign metric is a SOFT failure: digit guard short-circuits the judge, one retry, then 200 {verified:false, objection}', async () => {
    await seedGenerateFixture()
    const attempt2 = [{ text: 'Cut screening time 67% with the pipeline.', claim_ids: ['jp-1'] }]
    anthropic.queue.push(
      bulletsResponse([{ text: 'Improved latency 67% end to end.', claim_ids: ['jp-1'] }])
    )
    anthropic.queue.push(bulletsResponse(attempt2))

    const res = mockRes()
    await handler(generateReq(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.verified).toBe(false)
    expect(res.body.bullets).toEqual(attempt2) // bullets still returned for display
    expect(String(res.body.objection)).toContain('67')

    expect(anthropic.calls).toHaveLength(2)
    expect(genParts(anthropic.calls[1]).suffixText).toContain('67') // objection drives the retry
    expect(judgeState.calls).toHaveLength(0) // digit failure short-circuits: judge NEVER called

    const logs = tailorLogs()
    expect(logs.filter((r) => r.guard === 'hard' && r.pass === true)).toHaveLength(2)
    expect(logs.filter((r) => r.guard === 'digit' && r.pass === false)).toHaveLength(2)
    expect(logs.filter((r) => r.guard === 'judge' || r.guard === 'judge-error')).toHaveLength(0)
  })

  it('judge outage degrades open: 200 {verified:false, objection:"judge unavailable"}, guard:"judge-error" log, NO retry, no judgeError leak', async () => {
    await seedGenerateFixture()
    const good = [{ text: 'Built a job pipeline with LLM extraction.', claim_ids: ['jp-1'] }]
    anthropic.queue.push(bulletsResponse(good))
    judgeState.queue.push({ pass: false, objection: 'judge unavailable', judgeError: true })

    const res = mockRes()
    await handler(generateReq(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.verified).toBe(false)
    expect(res.body.objection).toBe('judge unavailable')
    expect(res.body).not.toHaveProperty('judgeError') // infra flag never leaves the server

    expect(anthropic.calls).toHaveLength(1) // infra failure, not content: NO retry
    expect(judgeState.calls).toHaveLength(1)
    const errRows = tailorLogs().filter((r) => r.guard === 'judge-error')
    expect(errRows).toHaveLength(1)
    expect(errRows[0]).toMatchObject({ pass: false, objection: 'judge unavailable' })
  })

  it('orig-claim-only section: claimIds [] → evidence is exactly orig-About me; a bullet citing it passes the hard guard', async () => {
    const aboutSections = [
      { name: '_header', start: 0, end: 9 },
      { name: 'About me', start: 9, end: 38 },
      { name: 'Skills', start: 38, end: FULL_TEXT.length },
    ]
    await seedGenerateFixture({ sections: aboutSections })
    anthropic.queue.push(
      bulletsResponse([{ text: 'Amsterdam-based engineer, easy to reach.', claim_ids: ['orig-About me'] }])
    )

    const res = mockRes()
    await handler(generateReq({ sectionName: 'About me', claimIds: [] }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.verified).toBe(true)
    // evidence set = the server-minted orig claim, nothing else
    expect(evidenceIds(judgeState.calls[0].evidence)).toEqual(['orig-About me'])
    const orig = judgeState.calls[0].evidence.find((e) => e.id === 'orig-About me')
    expect(orig.text).toBe(FULL_TEXT.slice(9, 38))
    expect(genParts(anthropic.calls[0]).suffixText).toContain('orig-About me')
  })

  it('pill claim is first-class evidence: a bullet citing ["pill-Docker"] passes the hard guard and the allowlist names it', async () => {
    await seedGenerateFixture()
    const pill = { id: 'pill-Docker', text: 'Has skill: Docker (self-confirmed 2026-07-13)', source: 'pill' }
    anthropic.queue.push(
      bulletsResponse([{ text: 'Comfortable working with Docker.', claim_ids: ['pill-Docker'] }])
    )

    const res = mockRes()
    await handler(generateReq({ pillClaims: [pill] }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.verified).toBe(true)
    expect(genParts(anthropic.calls[0]).suffixText).toContain('pill-Docker')
    expect(evidenceIds(judgeState.calls[0].evidence)).toEqual(['jp-1', 'orig-Projects', 'pill-Docker'])
  })

  it('malformed pillClaims shape (id not starting "pill-") → 400 before any generation call', async () => {
    await seedGenerateFixture()
    const res = mockRes()
    await handler(generateReq({ pillClaims: [{ id: 'Docker', text: 'Has skill: Docker' }] }), res)
    expect(res.statusCode).toBe(400)
    expect(anthropic.calls).toHaveLength(0)
  })

  it('stale split blocks generation: hash mismatch → 409 "stale split — re-run split", no model call', async () => {
    await seedGenerateFixture({ hash: 'stale-hash-from-before-the-console-edit' })
    const res = mockRes()
    await handler(generateReq(), res)
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'stale split — re-run split' })
    expect(anthropic.calls).toHaveLength(0)
    expect(judgeState.calls).toHaveLength(0)
  })

  it('unknown job → 404, no model call', async () => {
    await seedGenerateFixture()
    const res = mockRes()
    await handler(generateReq({ jobId: 'nope' }), res)
    expect(res.statusCode).toBe(404)
    expect(anthropic.calls).toHaveLength(0)
  })

  it('unknown section → 404, no model call', async () => {
    await seedGenerateFixture()
    const res = mockRes()
    await handler(generateReq({ sectionName: 'Hobbies' }), res)
    expect(res.statusCode).toBe(404)
    expect(anthropic.calls).toHaveLength(0)
  })

  it('unknown template claim id → 400, no model call', async () => {
    await seedGenerateFixture()
    const res = mockRes()
    await handler(generateReq({ claimIds: ['nope-1'] }), res)
    expect(res.statusCode).toBe(400)
    expect(anthropic.calls).toHaveLength(0)
  })

  it('duplicate claim id across templates → 500 naming "jp-1" and both templates, no model call', async () => {
    await seedGenerateFixture({
      templates: [
        { id: 1, name: 'job-pipeline', claims: TEMPLATE_CLAIMS },
        { id: 2, name: 'other-template', claims: [{ id: 'jp-1', text: 'A colliding claim.', skills: [] }] },
      ],
    })
    const res = mockRes()
    await handler(generateReq(), res)
    expect(res.statusCode).toBe(500)
    const wire = JSON.stringify(res.body)
    expect(wire).toContain('jp-1')
    expect(wire).toContain('job-pipeline')
    expect(wire).toContain('other-template')
    expect(anthropic.calls).toHaveLength(0)
  })

  it('retry budget: every attempt soft-fails → EXACTLY 2 generation calls, ≤2 judge calls, 200 verified:false', async () => {
    await seedGenerateFixture()
    // three responses queued on purpose — the third must never be consumed
    for (const text of [
      'Improved latency 67% end to end.',
      'Cut screening time 67% overall.',
      'Should never be requested 67%.',
    ]) {
      anthropic.queue.push(bulletsResponse([{ text, claim_ids: ['jp-1'] }]))
    }

    const res = mockRes()
    await handler(generateReq(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.verified).toBe(false)
    expect(anthropic.calls).toHaveLength(2) // initial + ONE soft retry, hard cap
    expect(anthropic.queue).toHaveLength(1) // third response never consumed
    expect(judgeState.calls.length).toBeLessThanOrEqual(2)
  })

  it('generation call failure (non-200, then fetch throw) → 502 "generation failed"', async () => {
    await seedGenerateFixture()
    anthropic.queue.push(apiError(500))
    const r1 = mockRes()
    await handler(generateReq(), r1)
    expect(r1.statusCode).toBe(502)
    expect(r1.body).toEqual({ error: 'generation failed' })

    anthropic.reset()
    anthropic.queue.push(new Error('ECONNRESET'))
    const r2 = mockRes()
    await handler(generateReq(), r2)
    expect(r2.statusCode).toBe(502)
    expect(r2.body).toEqual({ error: 'generation failed' })
  })

  it('tailor_log insert failure never fails the request (best-effort logging)', async () => {
    await seedGenerateFixture()
    supa.insertError = { message: 'tailor_log insert exploded' }
    anthropic.queue.push(
      bulletsResponse([{ text: 'Built a job pipeline with LLM extraction.', claim_ids: ['jp-1'] }])
    )

    const res = mockRes()
    await handler(generateReq(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.verified).toBe(true)
    expect(tailorLogs().length).toBeGreaterThan(0) // logging was attempted, failure swallowed
  })
})

describe('action=revise — guard pipeline (T7)', () => {
  it('note + priorBullets ride the suffix only (never the cached prefix); evidence set unchanged; judge non-entailment → verified:false', async () => {
    await seedGenerateFixture()
    const note = 'mention my Kubernetes experience'
    const priorBullets = [{ text: 'Built a job pipeline with LLM extraction.', claim_ids: ['jp-1'] }]
    // hard + digit pass (valid ids, no numbers) — only the judge catches the smuggle
    anthropic.queue.push(
      bulletsResponse([{ text: 'Ran Kubernetes clusters in production.', claim_ids: ['jp-1'] }])
    )
    anthropic.queue.push(
      bulletsResponse([{ text: 'Operated Kubernetes workloads at scale.', claim_ids: ['jp-1'] }])
    )
    judgeState.queue.push({ pass: false, objection: 'Kubernetes is not entailed by the evidence' })
    judgeState.queue.push({ pass: false, objection: 'Kubernetes is not entailed by the evidence' })

    const res = mockRes()
    await handler(generateReq({ action: 'revise', note, priorBullets }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.verified).toBe(false)
    expect(String(res.body.objection)).toContain('Kubernetes')

    // one soft retry happened; note/priorBullets never contaminate the cached prefix
    expect(anthropic.calls).toHaveLength(2)
    const first = genParts(anthropic.calls[0])
    expect(first.prefix.cache_control).toEqual({ type: 'ephemeral' })
    expect(first.suffixText).toContain(note)
    expect(first.suffixText).toContain(priorBullets[0].text)
    for (const call of anthropic.calls) {
      expect(genParts(call).prefix.text).not.toContain(note)
      expect(genParts(call).prefix.text).not.toContain('Kubernetes')
    }

    // the note cannot smuggle evidence: judge sees the same evidence set as generate
    expect(judgeState.calls.length).toBeGreaterThanOrEqual(1)
    for (const jc of judgeState.calls) {
      expect(evidenceIds(jc.evidence)).toEqual(['jp-1', 'orig-Projects'])
      for (const e of jc.evidence) expect(e.text).not.toContain('Kubernetes')
    }
  })
})

// Runs LAST: re-sweeps EVERY response this file produced, now including all
// T7 generate/revise bodies (spec C6 final clause + T7 leak surface).
describe('T7 leakage sweep — generate/revise responses included', () => {
  it('T7 responses leak no secrets, no judgeError flag, no prompt text, no unselected evidence', () => {
    // precondition: the suite really exercised successful AND degraded
    // generate/revise bodies (guards this sweep against sweeping only errors)
    const guarded = allResponses.filter((r) => r && typeof r === 'object' && 'verified' in r)
    expect(guarded.some((r) => r.verified === true)).toBe(true)
    expect(guarded.some((r) => r.verified === false)).toBe(true)

    const wire = JSON.stringify(allResponses)
    expect(wire).not.toContain(ANTHROPIC_KEY)
    expect(wire).not.toContain(SERVICE_KEY)
    expect(wire).not.toContain('supabase.co')
    expect(wire).not.toContain('signedUrl')
    expect(wire).not.toContain('token=')
    expect(wire).not.toContain('judgeError') // infra flag is server-internal
    expect(wire).not.toContain('No buzzword stuffing') // prompt text never leaves the server
    expect(wire).not.toContain('quetzal') // unselected evidence text never surfaces
  })
})
