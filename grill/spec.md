# Grill: spec (`spec.md`) — rounds 1–2

## Round 2 — 2026-07-13 — VERDICT: READY

- **Griller:** separate agent (`a8732b128b1e1943a`). All 11 axes PASS; no CRITICAL/HIGH.
- Audited every round-1 finding as genuinely resolved in the revised spec (HIGH: global
  claim-id uniqueness with loud 500 + BDD scenario; all 10 MEDIUMs; all 3 LOWs).
  Repo spot-checks passed (skill-table query shape vs extract.js, anon supabase client,
  .vercelignore, 8 non-test api files).
- Three residual LOWs, folded into the spec immediately after the verdict:
  - C8 export assert missing `await` on sha256Hex (would compare Promise to string).
  - digitDiff evidence side pinned to tokenize+set-membership (substring search would
    let evidence "1,405" legitimize a fabricated "40").
  - anchorSections gap payload unified to ONE shape `gap:{section, quote}` across all
    failure modes (was three inconsistent shapes).

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
AXIS | behaviour-orientation+spec-quality | PASS
```

VERDICT: READY

---

## Round 1 — 2026-07-13 — VERDICT: BLOCK (superseded)

- **Date:** 2026-07-13
- **Target:** `spec.md` (Tailored Résumé — Provenance Pipeline)
- **Prior-stage context:** `tailored-resume-blueprint.md` rev 3 (grilled READY), `tailored-resume-plan.md`, `research.md`
- **Griller:** separate agent (general-purpose subagent `a474d747a7ce195ca`), not the spec author. Claims verified against the live repo (skill table, eslint flat config, .vercelignore, house tool pattern, Vercel Node webcrypto).

## Per-axis verdicts

```
AXIS | ambiguity | FAIL
AXIS | hidden-assumptions | FAIL
AXIS | testability | FAIL
AXIS | edge-cases-error-paths | FAIL
AXIS | scope | PASS
AXIS | ml-data-risk | FAIL
AXIS | singular-requirements | PASS
AXIS | ears-error-coverage | FAIL
AXIS | traceability | FAIL
AXIS | constitution | FAIL
AXIS | behaviour-orientation | PASS
```

## Findings

```
FINDING | HIGH | Data schemas `claim.id` + C6 step 3 | Claim ids are "unique within template" but generate carries bare `claimIds:[]`, resolution is global, and the prefix holds the full corpus — a cross-template id collision attaches the WRONG evidence text to a cited claim_id and the guards verify bullets against the wrong claim, silently breaking the traceability guarantee. Decide: enforce global claim-id uniqueness (loud validation at load) OR make the API take (templateId, claimId) pairs.
FINDING | MEDIUM | C6 guard pipeline steps 1–9 | No pipeline step loads the job row / skill rows that buildPrefix's jdSkills needs; unknown jobId has no defined status. Name the query (skill table by job_id, canonical field, required-only or all) and the error path.
FINDING | MEDIUM | C6 steps 5–6 retry semantics | Total retry budget ambiguous: soft-retry breaking provenance = immediate 422 or fresh hard retry? does judge run before a digit-fail retry? judge-after-digit-fix retry? Worst-case model-call count unstated. Pin max N calls, short-circuit order, objection composition.
FINDING | MEDIUM | C5 digitDiff regex | /\d[\d,.]*%?/g captures trailing punctuation ("40.", "3.11.") → guaranteed false soft-fails on sentence-final numbers; "24/7" and "2019–2023" split into independent tokens. Pin normalization (strip trailing ./,) and name accepted token-split cases.
FINDING | MEDIUM | C4 sha256Hex dual-runtime | Prose invites node:crypto import inside src/ (unbundleable) and the code block shows sync signature above prose saying async. Vercel Node ≥18 has globalThis.crypto.subtle — pin ONE webcrypto async implementation for both runtimes.
FINDING | MEDIUM | C4 join-coverage rule | Spans defined heading→next-heading + _header + last→end tile fullText BY CONSTRUCTION — the "falsifiable" assert can never fire; first_line_quote is demanded but never used. Make coverage real: each section's first_line_quote must anchor inside its computed span (or drop the falsifiability claim).
FINDING | MEDIUM | SQL migration + C8 checklist | project_template/tailor_log created with RLS OFF (anon read/write on evidence ground truth + eval log); and the client's source for "all template claims" is unnamed. Add RLS: anon read-only on project_template, no anon policy on tailor_log; name the checklist data source (browser supabase select, house pattern).
FINDING | MEDIUM | C9 eslint boundary rule | no-restricted-imports pattern '**/api-lib/*' does not cross '/' — misses '../../api-lib/tailor/prompts.js', the exact import it exists to block. Use '**/api-lib/**' and '**/api/**'.
FINDING | MEDIUM | C2 request bodies | max_tokens/temperature unpinned for main calls; house 1024 copied to transcribe truncates a full-CV transcript. Pin per-action budgets + main temperature.
FINDING | MEDIUM | BDD "revision note cannot smuggle evidence" | Then-clause asserts live-model behavior no mocked test can observe. Restate mock-conditional or move explicitly to notebook-verify.
FINDING | MEDIUM | Traceability — blueprint CACE note | Blueprint rev 3 requires a score fixture + pill-claim-id fixture (canonicalMap drift); spec pins neither. Add both or record why dropped.
FINDING | LOW | BDD coverage vs plan DoD | No scenario for pill Reject path or approve state transition. Add.
FINDING | LOW | C7 buildDocx | candidateName source undefined (cv.name is filename-derived; real name lives in _header slice). Say which.
FINDING | LOW | Verification C7 | Marker-bytes-in-Packer-output assumes STOREd zip entries — unverified; name fallback.
```

## Gate

BLOCK derived mechanically: HIGH on the claim-id resolution ambiguity (constitution +
traceability axes). Feed findings back to `/spec`, re-grill. Human override must be
recorded here, never silent.

VERDICT: BLOCK
