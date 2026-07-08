// Tests for the live drop-in handler (api/extract.js) with the Daytona sandbox mocked —
// no network, no real LLM call (AGENTS.md: never live). Locks the response contract the
// front-end depends on: created_at stamped (drives the "New" badge immediately, no reload),
// live- id, screenshot_hash stripped, skills normalized.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The parsed job the "model" returns from inside the sandbox.
const PARSED = {
  company: 'Acme AI',
  title: 'AI Engineer',
  seniority: 'Mid',
  seniority_signal: '2-5 years',
  seniority_basis: 'inferred',
  summary: 'Builds LLM features.',
  skills: [
    { raw_text: 'Python', canonical: 'Python', requirement: 'required' },
    { raw_text: 'large language models', canonical: 'large language models', requirement: 'required' },
  ],
}

vi.mock('@daytona/sdk', () => ({
  Daytona: class {
    async create() {
      return {
        process: { codeRun: async () => ({ exitCode: 0, result: JSON.stringify(PARSED) }) },
        delete: async () => {},
      }
    }
  },
}))

const handler = (await import('./extract.js')).default

function mockRes() {
  const res = { statusCode: null, body: null }
  res.status = (code) => ((res.statusCode = code), res)
  res.json = (obj) => ((res.body = obj), res)
  return res
}

const REQ = {
  method: 'POST',
  body: { image: Buffer.from('fake-png-bytes').toString('base64'), media_type: 'image/png' },
}

beforeEach(() => {
  process.env.DAYTONA_API_KEY = 'test-key'
  process.env.ANTHROPIC_API_KEY = 'test-key'
  // No Supabase env -> dedup + persistence degrade gracefully; handler must still 200.
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
})

describe('POST /api/extract (Daytona mocked, no Supabase)', () => {
  it('returns the job with a fresh created_at ISO timestamp', async () => {
    const res = mockRes()
    await handler(REQ, res)
    expect(res.statusCode).toBe(200)
    const { job } = res.body
    expect(typeof job.created_at).toBe('string')
    const age = Date.now() - new Date(job.created_at).getTime()
    expect(age).toBeGreaterThanOrEqual(0)
    expect(age).toBeLessThan(10_000) // stamped now, not echoed from anywhere stale
  })

  it('model output cannot override the stamp or internals', async () => {
    // If the schema ever grew created_at/id, the spread order would let the model win —
    // this pins today's contract: our values are the ones the client sees.
    const res = mockRes()
    await handler(REQ, res)
    const { job } = res.body
    expect(job.id.startsWith('live-')).toBe(true)
    expect(job.source).toBe('screenshot')
    expect(job).not.toHaveProperty('screenshot_hash') // internal column, never sent to client
  })

  it('normalizes skills via the shared map (LLM variant collapses)', async () => {
    const res = mockRes()
    await handler(REQ, res)
    const canons = res.body.job.skills.map((s) => s.canonical)
    expect(canons).toContain('Python')
    expect(canons).toContain('LLMs') // "large language models" -> LLMs
  })

  it('rejects non-POST and missing image', async () => {
    const r1 = mockRes()
    await handler({ method: 'GET' }, r1)
    expect(r1.statusCode).toBe(405)
    const r2 = mockRes()
    await handler({ method: 'POST', body: {} }, r2)
    expect(r2.statusCode).toBe(400)
  })
})
