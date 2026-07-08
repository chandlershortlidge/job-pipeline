import { describe, it, expect } from 'vitest'
import { findSimilarJob } from './similar'

const JOBS = [
  { id: 'live-2', company: 'Mercanis', title: 'AI (Agentic) Engineer (m/f/d)' },
  { id: 'job-12', company: ' mercanis ', title: 'Agentic AI Engineer' },
  { id: 'job-3', company: 'WaveSix', title: 'AI & Automation Engineer' },
  { id: 'job-4', company: null, title: 'Mystery role' },
]

describe('findSimilarJob', () => {
  it('matches same company case-insensitively and trimmed', () => {
    const hit = findSimilarJob(JOBS, { id: 'live-9', company: 'MERCANIS' })
    expect(hit.id).toBe('live-2') // first (newest-first list) match wins
  })

  it('never matches the new job itself', () => {
    const hit = findSimilarJob(JOBS, { id: 'live-2', company: 'Mercanis' })
    expect(hit.id).toBe('job-12') // skips its own id, still finds the other Mercanis
  })

  it('null/blank company on the new job -> null (no warning)', () => {
    expect(findSimilarJob(JOBS, { id: 'x', company: null })).toBeNull()
    expect(findSimilarJob(JOBS, { id: 'x', company: '  ' })).toBeNull()
  })

  it('null-company rows in the list never match', () => {
    expect(findSimilarJob(JOBS, { id: 'x', company: 'Unknown Co' })).toBeNull()
  })

  it('no same-company row -> null', () => {
    expect(findSimilarJob(JOBS, { id: 'x', company: 'Acme' })).toBeNull()
  })
})
