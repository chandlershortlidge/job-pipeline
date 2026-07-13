# Loop log: tailored-resume

- Started: 2026-07-13
- Modes: --execute --team --tdd --logic --advisor
- Source of truth: `spec.md` (grilled READY r2) · task list: `tasks.md`
- Lessons recalled: NONE EXIST yet (first loop run; `~/.sigma` has no ratcheted
  lesson slugs). Ratchet target for new lessons: `~/.sigma/skills/<slug>/SKILL.md`.
- Isolation note: sigma.config.yml says worktrees:true, but wave-1 tasks touch
  provably disjoint files, so cycles run in the main tree in WAVES (dependency
  groups from tasks.md). Deviation logged here per loop rule 6. T6/T7 share
  api/tailor.js → strictly sequential.
- Budget cap: max 2 implement attempts per task; max 5 waves; stop-and-surface
  on any second failure or any ambiguity (advisor mode: human review queue at
  end of every wave).
- TDD roles per task: test-writer ≠ implementer ≠ checker (≠ logic-evaluator
  for llm-engineering / ai-agent-engineering tasks).

## Review queue (advisor)

- T0 (manual SQL migration + first project_template row) — HUMAN, not started.
  Blocks T10 and any live probe. Code waves proceed mocked.
- T10 (notebook-verify, live keys + deployed site) — will NOT be auto-run by
  the loop; surfaced for human-supervised run after T9.

## Cycles

### Wave 1 — T1, T2, T3, T4, T8 — DONE (2 attempts)

- [x] RED: 5 test-writers, 54 failing tests, all feature-absence failures.
- [x] GREEN: 5 implementers, full suite 115/0.
- [x] CHECK attempt 1: T1/T2/T3/T4-code PASS. T8 FAIL (lint red: browser-only
  globals). Logic evaluator FAIL: HIGH-1 orig-claim id never printed in any
  prompt (fixture masked it); HIGH-2 corpus labeled "all evidence" vs
  selected-subset guard; MED jdSkills nondeterminism; MED empty-quote anchoring.
- [x] RATCHET: 2 lessons written — `~/.sigma/skills/llm-evidence-id-binding/`,
  `~/.sigma/skills/eslint-globals-per-runtime/`.
- [x] FIX (attempt 2): orig-id bound in suffix + allowlist sentence +
  catalog-framed corpus label + pillClaimIds param (spec C2 amended);
  jdSkills sorted/deduped; empty-quote guard; honest fixtures + grep-detector
  test. eslint node globals for api/api-lib/tests (48→2 errors).
- [x] RE-CHECK: fresh logic evaluator PASS (verified live via node probes).
  Suite 125/0. Main-thread vitest confirm: PASS.

**Review queue additions (advisor):**
- Pre-existing lint (NOT this feature, code untouched): `api/extract.js:236`
  no-unused-vars `screenshot_hash` (likely the deliberate response-strip
  destructure — needs `varsIgnorePattern` or `_`-rename, human call);
  `src/App.jsx:857` react-hooks/set-state-in-effect. T8's "lint green"
  criterion met except these two baseline items — explicitly surfaced, not
  silently absorbed (per eslint-globals-per-runtime lesson rule 2).
- Accepted LOW residue (logged, not fixed): heading==first_line vacuous pass;
  duplicate section names fail loudly; ".5" leading-dot decimal tokenizes to
  "5"; empty bullet text passes validateClaimIds; suffix "SELECTED CLAIM IDS"
  label lists template ids only (allowlist line is authoritative).

### Wave 2 — T5 (judge) → Wave 3 — T6 → Wave 4 — T7 → Wave 5 — T9

- [ ] T5 RED/GREEN/CHECK
