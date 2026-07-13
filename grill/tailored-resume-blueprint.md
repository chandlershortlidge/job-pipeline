# Grill: blueprint (`tailored-resume-blueprint.md`) — rounds 1–3

## Round 3 — 2026-07-13 — VERDICT: READY

- **Griller:** separate agent (`a1f895163e8bb8552`). All 11 axes PASS; no CRITICAL/HIGH.
- Verified all round-2 residue resolved in rev 3 (orig-claims, staleness hash, judge-error
  fail-visible rule, log payloads, skills-on-claims, model pins, citation).
- Two residual findings, both folded into the blueprint immediately after the verdict:
  - MEDIUM: carryover-only export path bypassed generate's 409 staleness guard → client
    now asserts `full_text_hash` (SHA-256) before slicing carryover; mismatch blocks export.
  - LOW: D4 overstated what survives a refresh → pill confirmations named as client-only,
    re-confirmable.

```
AXIS | ambiguity | PASS
AXIS | hidden-assumptions | PASS
AXIS | testability | PASS
AXIS | edge-cases-error-paths | PASS
AXIS | scope | PASS
AXIS | ml-data-risk | PASS
AXIS | singular-requirements | PASS
AXIS | ears-error-coverage | PASS
AXIS | traceability | PASS
AXIS | constitution | PASS
AXIS | behaviour-orientation | PASS
```

VERDICT: READY

---

## Round 2 — 2026-07-13 — VERDICT: BLOCK

- **Griller:** separate agent (`ac904a16da473ad0e`). Verified all five round-1 HIGHs
  genuinely resolved in rev 2 (422/badge taxonomy, persisted `cv.sections`, pill-claim
  minting, widened evidence universe, transcribe 409).
- Two new HIGHs (residue of the round-1 fixes) + 3 MEDIUM + 2 LOW:

```
FINDING | HIGH | Provenance contract / Component 4 / D7 | Original-text evidence had no claim id — sections with no template claims and no pills (About me, Education) would systematically hard-fail guard 1. Resolved rev 3: orig-claim minted per section (`orig-<sectionName>`, D7 pattern).
FINDING | HIGH | D1/D4 + Interfaces | full_text console-corrected after split leaves cv.sections offsets stale — silent wrong-evidence slicing / mangled carryover. Resolved rev 3: full_text_hash stamped at split; generate 409 on mismatch; (round 3) client hash assert on export path.
FINDING | MEDIUM | Component 9 / schema | Skill-gap math uncomputable from `[{id, text}]` claim shape + implied src←api import. Resolved rev 3: claims carry canonical `skills` stamped at synthesis; client uses only materialized row data.
FINDING | MEDIUM | Provenance contract / errors | Judge infrastructure failure (429/timeout) undecided — 502 would fail-closed. Resolved rev 3: 200 + verified:false + objection "judge unavailable", logged as guard:"judge-error"; 502 reserved for generation failure.
FINDING | MEDIUM | tailor_log columns | No payload — calibration promise empty. Resolved rev 3: payload jsonb (bullets + evidence ids/text).
FINDING | LOW | Model constants | transcribe/split unpinned. Resolved rev 3: all four actions pinned.
FINDING | LOW | Eval citation | Half-fixed pointer. Resolved rev 3: research §7 "Eval strategy" bullet.
```

VERDICT: BLOCK (superseded by round 3)

---

## Round 1 — 2026-07-13 — VERDICT: BLOCK (superseded)

- **Date:** 2026-07-13
- **Target:** `tailored-resume-blueprint.md` (Tailored Résumé — Provenance Pipeline, Approach B)
- **Prior-stage context:** `proposals.md`; upstream `tailored-resume-plan.md`, `research.md`
- **Griller:** separate agent (general-purpose subagent `a43de9614cd762711`), not the blueprint author. Codebase claims verified against the live repo (function count, model pins, sourceStore exports, matchJob signature, .vercelignore, package.json).
- **File name note:** `grill/blueprint.md` is the storage-blueprint record; this target gets its own file.

## Codebase verification notes (griller's evidence)

- Confirmed: 8/12 function slots today → 9/12 with tailor.js; model pins `claude-sonnet-4-6` (extract.js:52, resume.js:46); `docx` and `@anthropic-ai/sdk` absent from package.json; file.js allowlist screenshot-only; DECISIONS.md entry present.
- **Refuted:** D3's "raw fetch house pattern" — extract.js/resume.js actually call Anthropic via Python urllib inside a Daytona sandbox with forced `tool_choice`. No plain-fetch precedent exists in `api/`.
- sourceStore.js has no byte-download helper (transcribe assumes one).
- `matchJob(job, resumeSet)` takes a canonical-skill Set — no extraction path exists for a generated docx.

## Per-axis verdicts

```
AXIS | ambiguity | FAIL
AXIS | hidden-assumptions | FAIL
AXIS | testability | PASS
AXIS | edge-cases-error-paths | FAIL
AXIS | scope | PASS
AXIS | ml-data-risk | FAIL
AXIS | singular-requirements | PASS
AXIS | ears-error-coverage | FAIL
AXIS | traceability | FAIL
AXIS | constitution | PASS
AXIS | behaviour-orientation | PASS
```

## Findings

```
FINDING | HIGH | Interfaces — errors vs Data flow V2→BADGE | "422 guard failure after retry" contradicts the flow's "second failure → render with unverified badge" and the response shape `{bullets, verified: bool, objection?}` — a 422 carries no bullets to badge; decide per guard which failures return 200+verified:false vs 422, and state it in the error contract.
FINDING | HIGH | Interfaces — `generate {jobId, cvId, section, claimIds}` | The prompt needs "that section's original text" but split offsets live only in the client (D4: no persistence) and the server cannot slice `cv.full_text` from a section name; add offsets/text to the request or persist the split — currently the API shape cannot produce the closed-world prompt.
FINDING | HIGH | Provenance contract / Component 9 — skill pills | Pill-confirmed skills (e.g. Docker, confirmed but present in no template claim) have no claim IDs, so every Skills-section bullet citing them fails guard 1 (`claim_ids` non-empty ∧ ⊆ selected set); decide how human-confirmed skills enter the evidence set (synthetic claims, section-type exemption, or pills minted as claims).
FINDING | HIGH | Component 4 / Guard order (2) — digit-diff | Digit universe is "confirmed claims" only, but the closed world also includes the section's original text — legitimate numbers carried from it (Education years, GPA, dates) are in no claim and get auto-rejected; same hole in the judge's "entailed by claims Y" (original-text facts fail entailment); define evidence universe = claims ∪ section original text or accept systematic false rejections.
FINDING | HIGH | Interfaces — `transcribe {cvId}` … "also persisted to cv.full_text" | No overwrite/idempotency rule: re-running transcribe after the human has corrected `full_text` silently clobbers the hand-corrected ground truth that D1, split, anchoring, and carryover all depend on; add an IF-exists guard (confirm/refuse or versioning).
FINDING | MEDIUM | D3 — "raw fetch … house pattern (extract.js, resume.js)" | Factually wrong: both precedents call Anthropic via Python urllib inside a Daytona sandbox with forced `tool_choice`, not raw fetch with `output_config.format`; tailor.js is a NEW integration pattern (dropping Daytona) — state that explicitly and decide it, don't inherit a precedent that doesn't exist.
FINDING | MEDIUM | D3 — `output_config.format` on `claude-sonnet-4-6` | Structured-outputs support on Sonnet 4.6 is unverified (current Anthropic docs list Fable 5/Opus 4.8/Sonnet 5/Haiku 4.5; Sonnet 4.6 is conspicuously absent) and the repo's working pattern is forced tool_use; verify capability via the Models API or specify fallback to the house tool-forcing pattern.
FINDING | MEDIUM | Data flow — `ASM --> SCORE [matchJob before/after]` | `matchJob(job, resumeSet)` takes a canonical-skill Set and no extraction path exists for the generated docx — the "after" input is undefined; specify it (e.g. base résumé set ∪ pill-confirmed skills) or the before/after display is unimplementable as drawn.
FINDING | MEDIUM | Components 5, 6 — `src/tailor/judge.js`, `prompts.js` | Server-only modules placed under the Vite browser app's `src/` alongside client-side `docx.js` with no import boundary named — nothing prevents a client import of judge.js (broken runtime, bundle bloat, and an env-key temptation path); name the convention or lint rule that enforces server-only status.
FINDING | MEDIUM | D1 / Risks — "human can correct the stored full_text" | No component owns the correction surface: component 8's screen lists provenance highlight, early-exit, and score, but no full_text editor; the mitigation for the top transcription risk is currently unassigned — add it to a component or name the manual channel (e.g. Supabase console) explicitly.
FINDING | MEDIUM | Component 5 / D5 — cached prefix contains "confirmed claims" | Claim selection happens per-project mid-session (flow: G0 → CC → GEN), so the prefix mutates as the user progresses and invalidates the cache it exists to exploit; also Sonnet 4.6's minimum cacheable prefix is 2048 tokens — a short résumé+claims prefix silently never caches; decide prefix composition (full claim corpus in prefix, selection in suffix) and note the minimum.
FINDING | MEDIUM | Interfaces — `revise {…same + note}` | The note ("make this sound less junior") refers to prior generated bullets that are neither in the request shape nor the prefix+suffix prompt as specified; state whether the client resends the prior bullets and where they sit relative to the cache breakpoint.
FINDING | MEDIUM | Risks — "calibrate against real failures later (eval deferred)" | With D4 (session state client-only, lost on refresh) no component persists judge verdicts/objections, so there will be zero recorded failures to calibrate against; name where judge outcomes are logged (even a jsonb column) or the calibration promise is empty.
FINDING | MEDIUM | Cross-artifact — plan steps 2 and 10 | Plan's DoD gate "Notebook-verify before promotion" (step 10) and the trigger affordance ("Create a résumé" action on the expanded job row, step 2) map to no blueprint component; add them (verification story + trigger ownership in component 8) or the DoD has zero-coverage items.
FINDING | LOW | Interfaces — transcribe "PDF pulled server-side via sourceStore" | sourceStore.js exports only `signedUrl`/`upload*`/`removeByPrefix` — no byte-download helper exists; note the new export needed so the spec doesn't assume a function that isn't there.
FINDING | LOW | Component 3 — "assert `join(sections) ≈ source`" | "≈" is undefined — unfalsifiable as written; state the tolerance (e.g. equality after whitespace normalization) so the 422 trigger is testable.
FINDING | LOW | Risks — "eval deferred, research §7" | Broken citation: research §7 is "Prior art, legal, and norms"; the eval material (Hamel playbook) lives in per-researcher contributions/takeaways — fix the pointer.
```

## Gate

BLOCK derived mechanically: ambiguity, hidden-assumptions, edge-cases, ml-data-risk,
ears-error-coverage, and traceability axes each carry HIGH findings.
Feed findings back to `/blueprint` to revise, then re-grill — or run `/grill-loop`.
Human override of this BLOCK must be recorded here, never silent.

VERDICT: BLOCK
