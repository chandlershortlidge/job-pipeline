# Tasks: Tailored Résumé — Provenance Pipeline

Decomposed from `spec.md` (grilled READY 2026-07-13, round 2). One commit per
task, tests green before commit (house rule). All paths under `dashboard/`.
BDD scenario names below refer to `spec.md` "Acceptance criteria" — each named
scenario must have a passing test (or an explicit manual step) before its task
is done.

## Dependency graph / parallel groups

```
Group A (fully parallel, no shared state): T1, T2, T3, T4, T8
Group B: T5 (after T4)
Group C: T6 (after T1, T2, T4)
Group D: T7 (after T3, T5, T6)
Group E: T9 (after T7, T8)
Final:   T10 (after T9 and T0)
T0 is manual/human, can happen any time before T10.
```

---

- [ ] **T0 — Manual: SQL migration + first project template** · *human, Supabase editor*
  - Context: `spec.md` "SQL migration" block (verbatim, incl. the RLS
    statements — do not skip); companion plan owns template synthesis.
  - Acceptance: `cv.full_text` + `cv.sections` columns exist; `project_template`
    + `tailor_log` tables exist with RLS as specced (anon: select-only on
    project_template, nothing on tailor_log); ≥1 real `project_template` row
    with claims `[{id, text, skills}]`, ids globally unique. Verify with a REST
    probe (house pattern).
  - Deps: none. Blocks: T10 (and any live use of T6/T7).

- [x] **T1 — `sourceStore.download`** · *domain: none (web backend)*
  - Context: modify `api/sourceStore.js` (+ `api/sourceStore.test.js`); follow
    the module's non-throwing contract (returns null, console.error) — read the
    file header comment first.
  - Acceptance: `download(supabase, path)` → Buffer | null per spec C1; tests
    mock `supabase.storage.from('sources').download` for success / error /
    throw; existing tests stay green.
  - Deps: none. Parallel: group A.

- [x] **T2 — `src/tailor/anchor.js` (anchorSections + sha256Hex)** · *domain: llm-engineering*
  - Context: new file + `src/tailor/anchor.test.js`; spec C4 is the whole
    contract (gap shape `{section, quote}` everywhere; first-line-quote-in-span
    coverage check; `_header` auto-prepend + exemption; fuzzy ≥ 0.85
    whitespace-collapsed; webcrypto-only sha256Hex — no `node:crypto`).
  - Acceptance: unit tests cover happy path, heading-quote miss (exact + fuzzy
    fail), first-line quote outside span (the falsifiable coverage case),
    empty fullText, single section, unicode; `sha256Hex` returns identical hex
    in Node (vitest) for a fixture string.
  - Deps: none. Parallel: group A.

- [x] **T3 — `src/tailor/provenance.js` (validateClaimIds + digitDiff)** · *domain: llm-engineering*
  - Context: new file + `src/tailor/provenance.test.js`; spec C5 (evidence
    side = tokenize + set membership, NOT substring; trailing `./,` stripped;
    24/7 and range splits are documented accepted behavior).
  - Acceptance: tests: empty claim_ids fails; unknown id fails; "1,405" in
    evidence does NOT legitimize bullet "40"; sentence-final "40." passes when
    evidence has "40"; "3.11." → "3.11"; % tokens.
  - Deps: none. Parallel: group A.

- [x] **T4 — `api-lib/tailor/prompts.js`** · *domain: llm-engineering*
  - Context: new dir `api-lib/tailor/`; spec C2 verbatim (MODEL_MAIN/JUDGE
    constants, per-action max_tokens pins incl. transcribe 8192,
    BULLETS_SCHEMA, buildPrefix with cache_control + sorted serialization,
    buildSuffix, buildGenerateBody/buildTranscribeBody/buildSplitBody,
    SYSTEM_RULES verbatim, forced-tool pattern per S1).
  - Acceptance: BDD "score isolation" test (build every body from a full
    fixture, assert no "score" substring, no matchJob output); prefix is
    byte-identical across two calls with same inputs (cache discipline);
    suffix carries note/priorBullets/objection after the breakpoint.
  - Deps: none. Parallel: group A.

- [x] **T5 — `api-lib/tailor/judge.js`** · *domain: llm-engineering*
  - Context: spec C3; imports MODEL_JUDGE from T4; forced tool `verdict`,
    temperature 0, max_tokens 512; never throws — infra failure →
    `{pass:false, objection:'judge unavailable', judgeError:true}`.
  - Acceptance: tests with fetch mocked: pass verdict, fail verdict with
    objection, non-200 → judgeError shape, fetch throw → judgeError shape,
    malformed body → judgeError shape.
  - Deps: T4.

- [x] **T6 — `api/tailor.js`: dispatcher + transcribe + split** · *domain: ai-agent-engineering*
  - Context: new file (slot 9/12 — the ONLY new `api/` file) +
    `api/tailor.test.js`; spec C6 preamble + transcribe/split blocks; env
    guard, 405/400 handling; uses T1 download, T2 anchor, T4 bodies; supabase
    client per `api/file.js` pattern.
  - Acceptance: BDD scenarios pass (mocked): "transcribe happy path",
    "transcribe refuses silent overwrite" (409), "transcribe with overwrite
    invalidates the split" (sections nulled), "split persists offsets with
    hash", "split coverage failure is loud" (422 + gap, sections not written),
    "method and action guards", "no secret leakage" (serialize every response,
    assert no key/URL material).
  - Deps: T1, T2, T4.

- [x] **T7 — `api/tailor.js`: generate + revise guard pipeline** · *domain: ai-agent-engineering*
  - Context: spec C6 steps 1–9 EXACTLY (staleness 409; jdSkills query; global
    claim-id uniqueness 500; evidence resolution incl. orig-claim minting;
    hard→digit→judge order with digit short-circuit; retry budget max 3
    generation calls; judge-error rule; tailor_log rows best-effort with
    payload; 502 only for generation-call failure). Largest task — the
    product's core.
  - Acceptance: BDD scenarios pass (mocked): "generate verified happy path",
    "bullet without claim ids is a hard error" (422 + 2 hard log rows),
    "foreign metric is a soft failure" (200 verified:false), "judge outage
    degrades visibly" (guard:'judge-error' row), "sections without template
    claims still generate" (orig-claim only), "revision note cannot smuggle
    evidence (mocked)", "stale split blocks generation" (409), "unknown
    section 404s", "unknown template claim id rejected" (400), "duplicate
    claim ids across templates fail loudly" (500), "unknown job 404s", "retry
    budget capped" (call-count assertion).
  - Deps: T3, T5, T6.

- [x] **T8 — `src/tailor/docx.js` + eslint boundary + dep** · *domain: none (web frontend)*
  - Context: spec C7 (dynamic import, single-column house template,
    candidateName = first non-empty `_header` line) + C9 eslint rule
    (`files: ['src/**']`, `no-restricted-imports` `['**/api/**',
    '**/api-lib/**']` — double globstar) + `package.json` add `docx@^9.7.1`.
  - Acceptance: docx test per spec verification C7 (Blob > 0; marker search
    with zlib-inflate fallback); eslint catches a deliberate
    `src → api-lib` import in a scratch test then passes clean; `vite build`
    green; `npm run lint` green.
  - Deps: none. Parallel: group A.

- [x] **T9 — UI: trigger + TailorScreen + pills + checklist + loop + export + score** · *domain: none (web frontend)*
  - Context: spec C8 (whole section); new `src/tailor/TailorScreen.jsx` +
    `SectionCard.jsx`; modify `App.jsx` (expanded-row "Create a résumé"
    trigger + mount) + `App.css`; reads `project_template` via existing anon
    client (`src/supabase.js`); uses T2 sha256Hex (export staleness assert
    with `await`), T8 buildDocx, existing `matchJob`.
  - Acceptance: BDD scenarios: "pill mints a first-class claim", "pill reject
    leaves no trace", "approve transition feeds export", "early exit carries
    over verbatim", "stale split blocks export too" (blocked + re-split
    prompt), "score fixture pins canonicalMap drift", "pill-claim id fixture
    pins canonical naming"; unverified badge + 422 error state rendered;
    `vite build` + headless screenshot (house practice).
  - Deps: T7, T8.

- [ ] **T10 — Notebook-verify end-to-end + promote** · *domain: ai-agent-engineering*
  - Context: spec "Verification" end-to-end protocol, verbatim: real job +
    real template; transcribe → console-correct → split → pill → checklist →
    generate with one forced soft-fail (badge) + one forced hard-fail (422) →
    approve → early-exit → docx opens in Word (manual check) → before/after
    score → tailor_log rows for every judge call →
    `usage.cache_read_input_tokens` logged once. Throwaway rows deleted after.
  - Acceptance: every step above demonstrated in the notebook run; "function
    count stays at 9" checked (`ls api/*.js` minus tests = 9); deployed verify
    on the live site per house practice. Stop-and-report if Anthropic/Supabase
    misbehave — no patching around.
  - Deps: T0, T9 (i.e., everything).

## Notes

- Group A (T1–T4, T8) = five independent workstreams; safe for parallel agents
  (no shared files). T6/T7 both touch `api/tailor.js` — sequential by design.
- Domains route context-engines for `/implement-task`: llm-engineering tasks
  should load prompt/eval lessons; ai-agent-engineering tasks the gate/orchestration
  lessons; "none" tasks are plain web work, standard review axis only.
- The spec is the single source of truth — where this file and `spec.md`
  disagree, `spec.md` wins.
