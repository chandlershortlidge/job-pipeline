// T4 — failing-first tests for api-lib/tailor/prompts.js (spec.md C2 + Pinned versions).
// The module under test does not exist yet; these tests define its contract.
import { describe, it, expect } from 'vitest'
import {
  MODEL_MAIN,
  MODEL_JUDGE,
  BULLETS_SCHEMA,
  buildPrefix,
  buildSuffix,
  buildGenerateBody,
  buildTranscribeBody,
  buildSplitBody,
} from './prompts.js'

// ---------------------------------------------------------------------------
// Rich fixture: full text, JD skills, template + pill claims, revise extras.
// Distinctive markers let us assert presence/absence in serialized output.
// ---------------------------------------------------------------------------
const FULL_TEXT = [
  'Jane Doe — jane@example.com',
  'EXPERIENCE',
  'Data Engineer, Acme Corp (2022-2026). Built ELT pipelines feeding a warehouse.',
  'PROJECTS',
  'Graph ingestion service. Streamed 2M events/day into Neo4j.',
].join('\n')

const JD_SKILLS = ['python', 'sql', 'airflow', 'dbt']

// Honest fixture: the prefix corpus holds template + pill claims ONLY. The
// orig-claim is per-section evidence — it is bound in the suffix as
// "orig-<sectionName>", never serialized into the session-stable prefix.
const ALL_CLAIMS = [
  { id: 'tmpl-1', text: 'Built Airflow DAGs orchestrating 40 daily ELT jobs', skills: ['airflow', 'python'] },
  { id: 'tmpl-2', text: 'Modeled marts in dbt consumed by three product teams', skills: ['dbt', 'sql'] },
  { id: 'pill-1', text: 'Wrote incremental SQL models cutting warehouse spend 30%', skills: ['sql'] },
]

const NOTE_MARKER = 'NOTE_MARKER_make_it_punchier_71f3'
const PRIOR_BULLET_MARKER = 'PRIOR_BULLET_MARKER_led_pipeline_work_9c2e'
const OBJECTION_MARKER = 'OBJECTION_MARKER_bullet_two_invents_a_metric_5b8d'

const PRIOR_BULLETS = [
  { text: PRIOR_BULLET_MARKER, claim_ids: ['tmpl-1'] },
  { text: 'Shipped dbt marts adopted by three teams', claim_ids: ['tmpl-2'] },
]

const PDF_BASE64 = 'JVBERi0xLjQKJdP0zOEKMSAwIG9iag=='

const prefixInputs = () => ({ fullText: FULL_TEXT, jdSkills: JD_SKILLS, allClaims: ALL_CLAIMS })

const fullSuffixInputs = () => ({
  sectionName: 'EXPERIENCE',
  origClaim: 'Data Engineer, Acme Corp (2022-2026). Built ELT pipelines feeding a warehouse.',
  selectedClaimIds: ['tmpl-1', 'tmpl-2'],
  pillClaimIds: ['pill-1'],
  note: NOTE_MARKER,
  priorBullets: PRIOR_BULLETS,
  objection: OBJECTION_MARKER,
})

const minimalSuffixInputs = () => ({
  sectionName: 'EXPERIENCE',
  origClaim: 'Data Engineer, Acme Corp (2022-2026). Built ELT pipelines feeding a warehouse.',
  selectedClaimIds: ['tmpl-1', 'pill-1'],
})

function buildEveryBody() {
  const prefix = buildPrefix(prefixInputs())
  const suffix = buildSuffix(fullSuffixInputs())
  return {
    generate: buildGenerateBody({ prefix, suffix }),
    transcribe: buildTranscribeBody({ pdfBase64: PDF_BASE64 }),
    split: buildSplitBody({ fullText: FULL_TEXT }),
  }
}

function lastBlockOf(prefix) {
  const blocks = Array.isArray(prefix) ? prefix : [prefix]
  return blocks[blocks.length - 1]
}

function findDocumentBlocks(body) {
  const found = []
  for (const msg of body.messages ?? []) {
    const content = Array.isArray(msg.content) ? msg.content : []
    for (const block of content) {
      if (block && block.type === 'document') found.push(block)
    }
  }
  return found
}

// ---------------------------------------------------------------------------
// BDD: score isolation (Goodhart invariant)
// ---------------------------------------------------------------------------
describe('score isolation', () => {
  it('no body produced by any builder contains "score" (case-insensitive)', () => {
    const bodies = buildEveryBody()
    for (const [name, body] of Object.entries(bodies)) {
      const serialized = JSON.stringify(body)
      expect(serialized, `${name} body must not mention score`).not.toMatch(/score/i)
    }
  })

  it('no body contains matchJob output or matchJob-like fields', () => {
    const bodies = buildEveryBody()
    for (const [name, body] of Object.entries(bodies)) {
      const serialized = JSON.stringify(body)
      expect(serialized, `${name} body must not carry matchJob output`).not.toMatch(/matchjob/i)
      expect(serialized, `${name} body must not carry matchJob output`).not.toMatch(/match_job/i)
    }
  })

  it('fixture sanity: the forbidden substrings are absent from the inputs themselves', () => {
    const inputs = JSON.stringify([prefixInputs(), fullSuffixInputs(), PDF_BASE64])
    expect(inputs).not.toMatch(/score/i)
    expect(inputs).not.toMatch(/matchjob/i)
  })
})

// ---------------------------------------------------------------------------
// Prefix: determinism + cache discipline
// ---------------------------------------------------------------------------
describe('buildPrefix', () => {
  it('is deterministic: two calls with the same inputs are byte-identical', () => {
    const a = buildPrefix(prefixInputs())
    const b = buildPrefix(prefixInputs())
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('puts cache_control {type:"ephemeral"} on the last prefix block', () => {
    const prefix = buildPrefix(prefixInputs())
    const last = lastBlockOf(prefix)
    expect(last).toBeTruthy()
    expect(last.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('carries the full text, JD skills, and every claim id', () => {
    const serialized = JSON.stringify(buildPrefix(prefixInputs()))
    expect(serialized).toContain('Graph ingestion service')
    for (const skill of JD_SKILLS) expect(serialized).toContain(skill)
    for (const claim of ALL_CLAIMS) expect(serialized).toContain(claim.id)
  })

  it('does NOT contain per-request revise material (the note) — cache discipline', () => {
    const serialized = JSON.stringify(buildPrefix(prefixInputs()))
    expect(serialized).not.toContain(NOTE_MARKER)
    expect(serialized).not.toContain(PRIOR_BULLET_MARKER)
    expect(serialized).not.toContain(OBJECTION_MARKER)
  })

  it('sorts + dedupes jdSkills: permuted duplicate-bearing arrays -> byte-identical prefixes', () => {
    const a = buildPrefix({ ...prefixInputs(), jdSkills: ['sql', 'python', 'dbt', 'airflow', 'sql', 'python'] })
    const b = buildPrefix({ ...prefixInputs(), jdSkills: ['airflow', 'dbt', 'python', 'sql', 'airflow'] })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

// ---------------------------------------------------------------------------
// Suffix: carries the per-request material, omits it cleanly when absent
// ---------------------------------------------------------------------------
describe('buildSuffix', () => {
  it('carries note, priorBullets, and objection when given', () => {
    const serialized = JSON.stringify(buildSuffix(fullSuffixInputs()))
    expect(serialized).toContain(NOTE_MARKER)
    expect(serialized).toContain(PRIOR_BULLET_MARKER)
    expect(serialized).toContain(OBJECTION_MARKER)
  })

  it('carries section name, orig claim, and the selected claim ids', () => {
    const serialized = JSON.stringify(buildSuffix(fullSuffixInputs()))
    expect(serialized).toContain('EXPERIENCE')
    expect(serialized).toContain('Built ELT pipelines feeding a warehouse')
    for (const id of fullSuffixInputs().selectedClaimIds) expect(serialized).toContain(id)
  })

  it('omits note/priorBullets/objection cleanly when absent (no leftover markers or "undefined"/"null" text)', () => {
    const serialized = JSON.stringify(buildSuffix(minimalSuffixInputs()))
    expect(serialized).not.toContain(NOTE_MARKER)
    expect(serialized).not.toContain(PRIOR_BULLET_MARKER)
    expect(serialized).not.toContain(OBJECTION_MARKER)
    expect(serialized).not.toContain('undefined')
    expect(serialized).not.toMatch(/note:\s*(null|")/i)
  })

  it('binds the citeable orig id verbatim: the literal string orig-<sectionName> appears in the suffix', () => {
    const text = buildSuffix(fullSuffixInputs())[0].text
    expect(text).toContain('cite as claim id "orig-EXPERIENCE"')
    expect(text).toContain('orig-EXPERIENCE')
  })

  it('enumerates the allowlist: selected + pill + orig ids, and marks any other id a failure', () => {
    const text = buildSuffix(fullSuffixInputs())[0].text
    const allowLine = text.split('\n').find((l) => l.startsWith('Use ONLY these claim ids'))
    expect(allowLine).toBeTruthy()
    for (const id of ['tmpl-1', 'tmpl-2', 'pill-1', 'orig-EXPERIENCE']) {
      expect(allowLine).toContain(id)
    }
    expect(allowLine).toContain('Citing any other id is a failure.')
  })

  it('orig-only path: selectedClaimIds [] -> orig-About me is bound citeable and is the entire allowlist', () => {
    const suffix = buildSuffix({
      sectionName: 'About me',
      origClaim: 'A short personal blurb about shipping data products.',
      selectedClaimIds: [],
    })
    const text = suffix[0].text
    expect(text).toContain('cite as claim id "orig-About me"')
    const allowLine = text.split('\n').find((l) => l.startsWith('Use ONLY these claim ids'))
    expect(allowLine).toBe(
      "Use ONLY these claim ids for this section's bullets: orig-About me. Citing any other id is a failure."
    )
  })
})

// ---------------------------------------------------------------------------
// Evidence-id binding across the assembled body (the lesson's grep detector):
// every id the suffix allows must appear verbatim somewhere in the request.
// ---------------------------------------------------------------------------
describe('assembled generate body — allowed ids present verbatim', () => {
  it('prefix+suffix body contains every allowed id (selected + pill + orig)', () => {
    const inputs = fullSuffixInputs()
    const body = buildGenerateBody({
      prefix: buildPrefix(prefixInputs()),
      suffix: buildSuffix(inputs),
    })
    const serialized = JSON.stringify(body)
    const allowedIds = [...inputs.selectedClaimIds, ...inputs.pillClaimIds, `orig-${inputs.sectionName}`]
    for (const id of allowedIds) {
      expect(serialized, `body must contain allowed id ${id} verbatim`).toContain(id)
    }
  })
})

// ---------------------------------------------------------------------------
// Body pins (Pinned versions section + S1 forced-tool pattern)
// ---------------------------------------------------------------------------
describe('model constants', () => {
  it('exports the pinned main and judge model ids', () => {
    expect(MODEL_MAIN).toBe('claude-sonnet-4-6')
    expect(MODEL_JUDGE).toBe('claude-haiku-4-5')
  })
})

describe('buildGenerateBody', () => {
  it('pins model MODEL_MAIN, max_tokens 2048, and default temperature (field omitted)', () => {
    const body = buildGenerateBody({
      prefix: buildPrefix(prefixInputs()),
      suffix: buildSuffix(fullSuffixInputs()),
    })
    expect(body.model).toBe(MODEL_MAIN)
    expect(body.max_tokens).toBe(2048)
    expect(body).not.toHaveProperty('temperature')
  })

  it('forces the write_bullets tool (house forced-tool pattern)', () => {
    const body = buildGenerateBody({
      prefix: buildPrefix(prefixInputs()),
      suffix: buildSuffix(fullSuffixInputs()),
    })
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'write_bullets' })
    const tool = (body.tools ?? []).find((t) => t.name === 'write_bullets')
    expect(tool).toBeTruthy()
    expect(tool.input_schema).toEqual(BULLETS_SCHEMA)
  })
})

describe('buildTranscribeBody', () => {
  it('pins max_tokens 8192 (a full CV transcript; house 1024 would truncate)', () => {
    const body = buildTranscribeBody({ pdfBase64: PDF_BASE64 })
    expect(body.max_tokens).toBe(8192)
    expect(body.model).toBe(MODEL_MAIN)
  })

  it('carries the PDF as a base64 document block and forces the record_transcript tool', () => {
    const body = buildTranscribeBody({ pdfBase64: PDF_BASE64 })
    const docs = findDocumentBlocks(body)
    expect(docs.length).toBeGreaterThanOrEqual(1)
    expect(docs[0].source).toMatchObject({ type: 'base64', data: PDF_BASE64 })
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'record_transcript' })
    expect((body.tools ?? []).map((t) => t.name)).toContain('record_transcript')
  })
})

describe('buildSplitBody', () => {
  it('pins max_tokens 2048, model MODEL_MAIN, forces record_sections, and carries the full text', () => {
    const body = buildSplitBody({ fullText: FULL_TEXT })
    expect(body.max_tokens).toBe(2048)
    expect(body.model).toBe(MODEL_MAIN)
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'record_sections' })
    expect((body.tools ?? []).map((t) => t.name)).toContain('record_sections')
    expect(JSON.stringify(body)).toContain('Graph ingestion service')
  })
})

// ---------------------------------------------------------------------------
// BULLETS_SCHEMA shape
// ---------------------------------------------------------------------------
describe('BULLETS_SCHEMA', () => {
  it('requires bullets at the top level', () => {
    expect(BULLETS_SCHEMA.type).toBe('object')
    expect(BULLETS_SCHEMA.required).toEqual(['bullets'])
    expect(BULLETS_SCHEMA.properties.bullets.type).toBe('array')
  })

  it('each bullet requires text and claim_ids (string array)', () => {
    const item = BULLETS_SCHEMA.properties.bullets.items
    expect(item.type).toBe('object')
    expect(item.required).toContain('text')
    expect(item.required).toContain('claim_ids')
    expect(item.properties.text).toEqual({ type: 'string' })
    expect(item.properties.claim_ids).toEqual({ type: 'array', items: { type: 'string' } })
  })
})
