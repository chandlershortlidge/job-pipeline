import { describe, it, expect } from 'vitest'
import { filterJobsByCompany } from './searchJobs'

const JOBS = [
  { id: 'a', company: 'Mercanis' },
  { id: 'b', company: 'ClickHouse' },
  { id: 'c', company: 'WaveSix GmbH' },
  { id: 'd', company: null },
]

describe('filterJobsByCompany', () => {
  it('empty or blank query returns the input unchanged (same reference)', () => {
    expect(filterJobsByCompany(JOBS, '')).toBe(JOBS)
    expect(filterJobsByCompany(JOBS, '   ')).toBe(JOBS)
    expect(filterJobsByCompany(JOBS, undefined)).toBe(JOBS)
  })

  it('matches case-insensitively on a substring', () => {
    expect(filterJobsByCompany(JOBS, 'mercanis').map((j) => j.id)).toEqual(['a'])
    expect(filterJobsByCompany(JOBS, 'CLICK').map((j) => j.id)).toEqual(['b'])
    expect(filterJobsByCompany(JOBS, 'six gmbh').map((j) => j.id)).toEqual(['c'])
  })

  it('trims surrounding whitespace from the query', () => {
    expect(filterJobsByCompany(JOBS, '  wave  ').map((j) => j.id)).toEqual(['c'])
  })

  it('null-company jobs never match a non-empty query', () => {
    expect(filterJobsByCompany(JOBS, 'null')).toEqual([])
  })

  it('no match returns an empty list', () => {
    expect(filterJobsByCompany(JOBS, 'zzz')).toEqual([])
  })
})
