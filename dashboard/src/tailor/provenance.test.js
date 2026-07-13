// T3 — failing tests for src/tailor/provenance.js (spec C5).
// Contract:
//   validateClaimIds(bullets, evidenceIds) → {ok:true} | {ok:false, reason}
//   digitDiff(bullets, evidenceTexts)      → {ok:true} | {ok:false, digits:[...]}
import { describe, it, expect } from 'vitest';
import { validateClaimIds, digitDiff } from './provenance.js';

const bullet = (text, claim_ids = ['c1']) => ({ text, claim_ids });

describe('validateClaimIds (hard guard)', () => {
  it('fails when bullets is missing', () => {
    const res = validateClaimIds(undefined, ['c1']);
    expect(res.ok).toBe(false);
    expect(typeof res.reason).toBe('string');
  });

  it('fails when bullets is an empty array', () => {
    const res = validateClaimIds([], ['c1']);
    expect(res.ok).toBe(false);
    expect(typeof res.reason).toBe('string');
  });

  it('fails when any bullet has empty claim_ids', () => {
    const res = validateClaimIds(
      [bullet('cited', ['c1']), bullet('uncited', [])],
      ['c1'],
    );
    expect(res.ok).toBe(false);
    expect(typeof res.reason).toBe('string');
  });

  it('fails when a bullet cites an id not in evidenceIds', () => {
    const res = validateClaimIds(
      [bullet('rogue claim', ['c1', 'ghost-99'])],
      ['c1', 'c2'],
    );
    expect(res.ok).toBe(false);
    expect(typeof res.reason).toBe('string');
  });

  it('passes when every bullet cites only known evidence ids', () => {
    const res = validateClaimIds(
      [bullet('a', ['c1']), bullet('b', ['c2', 'c1'])],
      ['c1', 'c2'],
    );
    expect(res).toEqual({ ok: true });
  });
});

describe('digitDiff (soft guard)', () => {
  it('fails on a fabricated number absent from evidence, listing it', () => {
    const res = digitDiff(
      [bullet('Improved throughput by 67% across services')],
      ['Improved throughput across services'],
    );
    expect(res.ok).toBe(false);
    expect(res.digits).toContain('67%');
  });

  it('uses set membership, not substring: evidence "1,405" does NOT legitimize bullet "40"', () => {
    const res = digitDiff(
      [bullet('Cut costs by 40 percent')],
      ['Processed 1,405 tickets per week'],
    );
    expect(res.ok).toBe(false);
    expect(res.digits).toContain('40');
  });

  it('passes sentence-final "40." when evidence has "40" (trailing dot stripped)', () => {
    const res = digitDiff(
      [bullet('Cut costs by 40.')],
      ['Reduced infrastructure spend by 40 percent'],
    );
    expect(res).toEqual({ ok: true });
  });

  it('normalizes "3.11." to "3.11" (only the trailing dot stripped)', () => {
    const res = digitDiff(
      [bullet('Migrated the stack to Python 3.11.')],
      ['Led the migration to Python 3.11'],
    );
    expect(res).toEqual({ ok: true });
  });

  it('splits "24/7" into "24" and "7": both parts must appear in evidence', () => {
    const pass = digitDiff(
      [bullet('Ran 24/7 on-call rotation')],
      ['Covered 24 hour shifts, 7 days a week'],
    );
    expect(pass).toEqual({ ok: true });

    const fail = digitDiff(
      [bullet('Ran 24/7 on-call rotation')],
      ['Covered 24 hour shifts'],
    );
    expect(fail.ok).toBe(false);
    expect(fail.digits).toContain('7');
  });

  it('matches %-suffixed tokens as distinct normalized tokens', () => {
    const res = digitDiff(
      [bullet('Boosted conversion 15%')],
      ['Boosted conversion 15% quarter over quarter'],
    );
    expect(res).toEqual({ ok: true });
  });

  it('normalizes commas: bullet "1,405" matches evidence "1,405"', () => {
    const res = digitDiff(
      [bullet('Handled 1,405 tickets')],
      ['Handled 1,405 tickets in Q3'],
    );
    expect(res).toEqual({ ok: true });
  });

  it('passes when bullets contain no digits at all', () => {
    const res = digitDiff(
      [bullet('Led cross-functional initiatives')],
      ['Led cross-functional initiatives with design and PM'],
    );
    expect(res).toEqual({ ok: true });
  });
});
