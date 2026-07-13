// T5 — failing-first tests for api-lib/tailor/judge.js (spec.md C3).
// The module under test does not exist yet; these tests define its contract:
//   judge({bullets, evidence, apiKey}) → {pass:boolean, objection:string|null}
//   NEVER throws. Infra failure (fetch throw, non-200, malformed response) →
//   {pass:false, objection:'judge unavailable', judgeError:true}.
// One Anthropic messages call: MODEL_JUDGE, temperature 0, max_tokens 512,
// forced tool 'verdict' ({pass:boolean, objection:string|null}), headers
// x-api-key + anthropic-version 2023-06-01.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MODEL_JUDGE } from './prompts.js'
import { judge } from './judge.js'

// ---------------------------------------------------------------------------
// Fixtures — distinctive markers so we can assert presence in the request body.
// ---------------------------------------------------------------------------
const EVIDENCE = [
  { id: 'tmpl-neo4j-ingest', text: 'Streamed 2M events/day into Neo4j MARKER_EV_ONE' },
  { id: 'orig-projects', text: 'Original projects section text MARKER_EV_TWO' },
]

const BULLETS = [
  { text: 'Built a graph ingestion service handling 2M events/day MARKER_BULLET_ONE', claim_ids: ['tmpl-neo4j-ingest'] },
  { text: 'Maintained the projects portfolio MARKER_BULLET_TWO', claim_ids: ['orig-projects'] },
]

const API_KEY = 'sk-ant-test-judge-key'

function verdictResponse(input) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: 'tool_use', name: 'verdict', input }],
    }),
  }
}

const INFRA_SHAPE = { pass: false, objection: 'judge unavailable', judgeError: true }

let fetchMock

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function callJudge() {
  return judge({ bullets: BULLETS, evidence: EVIDENCE, apiKey: API_KEY })
}

// ---------------------------------------------------------------------------
// Verdict extraction
// ---------------------------------------------------------------------------
describe('judge — verdict extraction', () => {
  it('pass verdict: extracts {pass:true, objection:null} from the tool_use block', async () => {
    fetchMock.mockResolvedValue(verdictResponse({ pass: true, objection: null }))
    const result = await callJudge()
    expect(result.pass).toBe(true)
    expect(result.objection).toBeNull()
    // Not an infra failure — judgeError must not be set truthy on a real verdict.
    expect(result.judgeError).toBeFalsy()
  })

  it('fail verdict: propagates the objection string', async () => {
    const objection = 'Bullet 1 invents a metric not present in the evidence.'
    fetchMock.mockResolvedValue(verdictResponse({ pass: false, objection }))
    const result = await callJudge()
    expect(result.pass).toBe(false)
    expect(result.objection).toBe(objection)
    expect(result.judgeError).toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
// Infrastructure failure → {pass:false, objection:'judge unavailable', judgeError:true}
// ---------------------------------------------------------------------------
describe('judge — infrastructure failures', () => {
  it('non-200 response → judgeError shape', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 529,
      json: async () => ({ type: 'error', error: { type: 'overloaded_error' } }),
    })
    await expect(callJudge()).resolves.toMatchObject(INFRA_SHAPE)
  })

  it('fetch rejection → judgeError shape (never throws)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    await expect(callJudge()).resolves.toMatchObject(INFRA_SHAPE)
  })

  it('malformed body (no tool_use block) → judgeError shape', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: 'not a verdict' }] }),
    })
    await expect(callJudge()).resolves.toMatchObject(INFRA_SHAPE)
  })

  it('unparseable body (json() rejects) → judgeError shape (never throws)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected end of JSON input') },
    })
    await expect(callJudge()).resolves.toMatchObject(INFRA_SHAPE)
  })
})

// ---------------------------------------------------------------------------
// Request shape — one call, house Anthropic pattern
// ---------------------------------------------------------------------------
describe('judge — request shape', () => {
  async function capturedRequest() {
    fetchMock.mockResolvedValue(verdictResponse({ pass: true, objection: null }))
    await callJudge()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    return { url: String(url), init, body: JSON.parse(init.body) }
  }

  it('POSTs to the Anthropic messages endpoint with api key + version headers', async () => {
    const { url, init } = await capturedRequest()
    expect(url).toContain('api.anthropic.com/v1/messages')
    expect(init.method).toBe('POST')
    const headers = init.headers
    expect(headers['x-api-key']).toBe(API_KEY)
    expect(headers['anthropic-version']).toBe('2023-06-01')
  })

  it('uses MODEL_JUDGE (claude-haiku-4-5), temperature 0, max_tokens 512', async () => {
    const { body } = await capturedRequest()
    expect(MODEL_JUDGE).toBe('claude-haiku-4-5')
    expect(body.model).toBe(MODEL_JUDGE)
    expect(body.temperature).toBe(0)
    expect(body.max_tokens).toBe(512)
  })

  it('forces the verdict tool with the {pass, objection} schema', async () => {
    const { body } = await capturedRequest()
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'verdict' })
    const verdictTool = (body.tools ?? []).find((t) => t.name === 'verdict')
    expect(verdictTool).toBeDefined()
    const props = verdictTool.input_schema.properties
    expect(props.pass.type).toBe('boolean')
    expect(props.objection.type).toEqual(['string', 'null'])
  })

  it('user text carries the evidence (id + text) list and the bullets', async () => {
    const { body } = await capturedRequest()
    const serialized = JSON.stringify(body.messages)
    for (const claim of EVIDENCE) {
      expect(serialized).toContain(claim.id)
      expect(serialized).toContain(claim.text)
    }
    for (const bullet of BULLETS) {
      expect(serialized).toContain(bullet.text)
    }
  })
})
