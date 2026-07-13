// T2 failing tests — contract from spec.md C4.
// anchorSections(fullText, quotes) and sha256Hex(text) live in ./anchor.js
// (not implemented yet — these tests define the contract).
import { describe, it, expect } from 'vitest'
import { anchorSections, sha256Hex } from './anchor'

// ---------- fixtures ----------

const RESUME = `Jane Doe
jane@example.com | 555-0100

SUMMARY
Engineer with a decade of experience shipping data products.

WORK HISTORY
Acme Corp — built ETL pipelines processing 2M rows daily.
Led a team of four.

EDUCATION
B.S. Computer Science, State University.`

const q = (name, heading_quote, first_line_quote) => ({
  name,
  heading_quote,
  first_line_quote,
})

const happyQuotes = [
  q('summary', 'SUMMARY', 'Engineer with a decade of experience'),
  q('work', 'WORK HISTORY', 'Acme Corp — built ETL pipelines'),
  q('education', 'EDUCATION', 'B.S. Computer Science'),
]

// ---------- anchorSections ----------

describe('anchorSections — happy path', () => {
  it('anchors 3 sections with exact offsets and auto-prepends _header', () => {
    const res = anchorSections(RESUME, happyQuotes)
    expect(res.ok).toBe(true)

    const iSummary = RESUME.indexOf('SUMMARY')
    const iWork = RESUME.indexOf('WORK HISTORY')
    const iEdu = RESUME.indexOf('EDUCATION')

    expect(res.sections).toEqual([
      { name: '_header', start: 0, end: iSummary },
      { name: 'summary', start: iSummary, end: iWork },
      { name: 'work', start: iWork, end: iEdu },
      { name: 'education', start: iEdu, end: RESUME.length },
    ])
  })

  it('spans tile fullText: each end is the next start, last end = length', () => {
    const { ok, sections } = anchorSections(RESUME, happyQuotes)
    expect(ok).toBe(true)
    expect(sections[0].start).toBe(0)
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i].start).toBe(sections[i - 1].end)
    }
    expect(sections[sections.length - 1].end).toBe(RESUME.length)
  })

  it('_header is exempt from the first-line check (it has no quotes)', () => {
    // No quote object mentions _header; presence of header text must not fail.
    const res = anchorSections(RESUME, happyQuotes)
    expect(res.ok).toBe(true)
    expect(res.sections[0].name).toBe('_header')
  })
})

describe('anchorSections — heading quote misses', () => {
  it('heading quote absent entirely -> ok:false with gap {section, quote}', () => {
    const quotes = [
      q('summary', 'SUMMARY', 'Engineer with a decade of experience'),
      q('awards', 'AWARDS AND HONORS', 'Best in show'),
    ]
    const res = anchorSections(RESUME, quotes)
    expect(res).toEqual({
      ok: false,
      gap: { section: 'awards', quote: 'AWARDS AND HONORS' },
    })
  })

  it('empty fullText -> ok:false gap on the first section heading', () => {
    const res = anchorSections('', [q('summary', 'SUMMARY', 'anything')])
    expect(res).toEqual({
      ok: false,
      gap: { section: 'summary', quote: 'SUMMARY' },
    })
  })

  it('zero sections is never a valid split -> ok:false (schema-valid empty model output must not persist)', () => {
    expect(anchorSections(RESUME, [])).toEqual({ ok: false, gap: { section: null, quote: null } })
    expect(anchorSections(RESUME, undefined)).toEqual({ ok: false, gap: { section: null, quote: null } })
  })
})

describe('anchorSections — fuzzy fallback (>= 0.85, whitespace-collapsed)', () => {
  it('anchors a heading quote whose whitespace differs from the document', () => {
    const quotes = [
      q('summary', 'SUMMARY', 'Engineer with a decade of experience'),
      // doc has 'WORK HISTORY' (single space); quote has extra whitespace
      q('work', 'WORK   HISTORY', 'Acme Corp — built ETL pipelines'),
      q('education', 'EDUCATION', 'B.S. Computer Science'),
    ]
    const res = anchorSections(RESUME, quotes)
    expect(res.ok).toBe(true)
    const work = res.sections.find((s) => s.name === 'work')
    expect(work.start).toBe(RESUME.indexOf('WORK HISTORY'))
    expect(work.end).toBe(RESUME.indexOf('EDUCATION'))
  })

  it('anchors a heading quote with a minor typo (similarity >= 0.85)', () => {
    const doc = `Jane Doe

PROFESSIONAL EXPERIENCE
Acme Corp — built ETL pipelines.

EDUCATION
B.S. Computer Science.`
    const quotes = [
      // one substituted char in 23: similarity ~0.96
      q('experience', 'PROFESSIONAL EXPERIENSE', 'Acme Corp — built ETL pipelines.'),
      q('education', 'EDUCATION', 'B.S. Computer Science.'),
    ]
    const res = anchorSections(doc, quotes)
    expect(res.ok).toBe(true)
    const exp = res.sections.find((s) => s.name === 'experience')
    expect(exp.start).toBe(doc.indexOf('PROFESSIONAL EXPERIENCE'))
  })

  it('a heading quote nothing like the document text stays a miss', () => {
    const quotes = [
      q('summary', 'COMPLETELY UNRELATED TEXT ZZZZ', 'Engineer with a decade'),
    ]
    const res = anchorSections(RESUME, quotes)
    expect(res.ok).toBe(false)
    expect(res.gap).toEqual({
      section: 'summary',
      quote: 'COMPLETELY UNRELATED TEXT ZZZZ',
    })
  })
})

describe('anchorSections — coverage rule (first_line_quote inside its span)', () => {
  it("first_line_quote landing in the NEXT section's span -> ok:false with that section+quote", () => {
    // Model omitted a heading: it claims 'Led a team of four.' (which sits in
    // the work span... here we force the harder case: summary's first line is
    // actually the work section's first line, i.e. it anchors AFTER summary's
    // span ends at WORK HISTORY).
    const quotes = [
      q('summary', 'SUMMARY', 'Acme Corp — built ETL pipelines'),
      q('work', 'WORK HISTORY', 'Acme Corp — built ETL pipelines'),
      q('education', 'EDUCATION', 'B.S. Computer Science'),
    ]
    const res = anchorSections(RESUME, quotes)
    expect(res).toEqual({
      ok: false,
      gap: { section: 'summary', quote: 'Acme Corp — built ETL pipelines' },
    })
  })

  it('first_line_quote found nowhere in the document -> ok:false gap', () => {
    const quotes = [
      q('summary', 'SUMMARY', 'THIS LINE DOES NOT EXIST ANYWHERE QQQQ'),
      q('work', 'WORK HISTORY', 'Acme Corp — built ETL pipelines'),
      q('education', 'EDUCATION', 'B.S. Computer Science'),
    ]
    const res = anchorSections(RESUME, quotes)
    expect(res).toEqual({
      ok: false,
      gap: { section: 'summary', quote: 'THIS LINE DOES NOT EXIST ANYWHERE QQQQ' },
    })
  })
})

describe('anchorSections — empty/whitespace-only quotes fail loudly', () => {
  it('empty heading_quote -> ok:false with gap {section, quote} (no indexOf("")===0 anchoring)', () => {
    const quotes = [
      q('summary', '', 'Engineer with a decade of experience'),
      q('work', 'WORK HISTORY', 'Acme Corp — built ETL pipelines'),
    ]
    const res = anchorSections(RESUME, quotes)
    expect(res).toEqual({ ok: false, gap: { section: 'summary', quote: '' } })
  })

  it('whitespace-only heading_quote -> ok:false with gap', () => {
    const quotes = [q('summary', '   \n\t', 'Engineer with a decade of experience')]
    const res = anchorSections(RESUME, quotes)
    expect(res).toEqual({ ok: false, gap: { section: 'summary', quote: '   \n\t' } })
  })

  it('empty first_line_quote -> ok:false with gap', () => {
    const quotes = [
      q('summary', 'SUMMARY', ''),
      q('work', 'WORK HISTORY', 'Acme Corp — built ETL pipelines'),
    ]
    const res = anchorSections(RESUME, quotes)
    expect(res).toEqual({ ok: false, gap: { section: 'summary', quote: '' } })
  })

  it('whitespace-only first_line_quote -> ok:false with gap', () => {
    const quotes = [q('summary', 'SUMMARY', '  ')]
    const res = anchorSections(RESUME, quotes)
    expect(res).toEqual({ ok: false, gap: { section: 'summary', quote: '  ' } })
  })

  it('degenerate case: two sections with empty quotes no longer swallow the header — fails loudly', () => {
    // Previously '' anchored at index 0 via indexOf('')===0, producing
    // zero-width heading spans that silently absorbed the header text.
    const quotes = [q('a', '', ''), q('b', '', '')]
    const res = anchorSections(RESUME, quotes)
    expect(res).toEqual({ ok: false, gap: { section: 'a', quote: '' } })
  })
})

describe('anchorSections — single section', () => {
  it('one section spans from its heading to fullText.length; header before it', () => {
    const doc = `Jane Doe
jane@example.com

SKILLS
Python, SQL, dbt.`
    const res = anchorSections(doc, [q('skills', 'SKILLS', 'Python, SQL, dbt.')])
    expect(res.ok).toBe(true)
    const iSkills = doc.indexOf('SKILLS')
    expect(res.sections).toEqual([
      { name: '_header', start: 0, end: iSkills },
      { name: 'skills', start: iSkills, end: doc.length },
    ])
  })
})

describe('anchorSections — unicode', () => {
  it('offsets are UTF-16 string indices consistent with slice()', () => {
    const doc = `José Müller — 日本語レジュメ 🚀

RÉSUMÉ
Ingénieur données — pipelines señor.

ÉDUCATION
Licence d'informatique.`
    const quotes = [
      q('resume', 'RÉSUMÉ', 'Ingénieur données'),
      q('education', 'ÉDUCATION', "Licence d'informatique."),
    ]
    const res = anchorSections(doc, quotes)
    expect(res.ok).toBe(true)

    const iRes = doc.indexOf('RÉSUMÉ')
    const iEdu = doc.indexOf('ÉDUCATION')
    expect(res.sections).toEqual([
      { name: '_header', start: 0, end: iRes },
      { name: 'resume', start: iRes, end: iEdu },
      { name: 'education', start: iEdu, end: doc.length },
    ])
    // round-trip: slicing by the returned offsets reproduces each section
    const resume = res.sections.find((s) => s.name === 'resume')
    expect(doc.slice(resume.start, resume.end)).toContain('Ingénieur données')
    expect(doc.slice(resume.start, resume.end)).not.toContain('ÉDUCATION')
  })
})

// ---------- sha256Hex ----------

describe('sha256Hex', () => {
  it('is async and returns the known SHA-256 hex of "abc"', async () => {
    const p = sha256Hex('abc')
    expect(p).toBeInstanceOf(Promise)
    await expect(p).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('hashes the empty string to the well-known digest', async () => {
    await expect(sha256Hex('')).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )
  })
})
