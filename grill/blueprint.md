# Grill: blueprint (`storage-blueprint.md`) — round 2

- **Date:** 2026-07-13
- **Target:** `storage-blueprint.md` (Source-File Storage v1)
- **Prior-stage context:** `source-file-storage-plan.md`
- **Griller:** separate agent (general-purpose subagent `a35b4c889439a31a2`), not the blueprint author. Claims verified against the live codebase (`dashboard/api/*`), not just the documents.
- **Note:** round-1 findings F1–F6 were folded into this blueprint before this grill; this round grills the folded result. Much of the design is already implemented — code reality is cited as evidence where relevant.

## Per-axis verdicts

```
AXIS | ambiguity | FAIL
AXIS | hidden-assumptions | FAIL
AXIS | testability | FAIL
AXIS | edge-cases-error-paths | FAIL
AXIS | scope | PASS
AXIS | ml-data-risk | PASS
AXIS | singular-requirements | FAIL
AXIS | error-path-coverage-ears | FAIL
AXIS | cross-artifact-traceability | FAIL
AXIS | constitution | PASS
AXIS | behaviour-orientation | PASS
```

## Findings

```
FINDING | HIGH | plan Steps §7 ↔ blueprint D1/Next | D1's plan-text fold was applied incompletely: the DoD now says "service-role probe," but plan step 7 still reads "one real résumé upload → signed URL fetch returns the PDF" — impossible through the app's only read path (api/file.js kind-allowlist is screenshot-only, verified at dashboard/api/file.js:15-17); a literal verifier hitting 400 on kind=cv could defensibly "fix" it by widening the allowlist, reopening the exact sequential-cv-id enumeration hole D1 names as making the private bucket "privacy theater." Decide: rewrite step 7 to specify the service-role probe mechanics, or delete the signed-URL wording.
FINDING | MEDIUM | blueprint "Ordering contracts / Delete cleanup" | DoD rewording "no file remains reachable after row delete" contradicts "a storage error never fails the row delete" in the same paragraph — under storage failure a file remains, so the absolute criterion is unfalsifiable-as-stated; "reachable" is also undefined (exists-in-bucket vs retrievable-via-the-route — the two readings give opposite test outcomes). Split into two criteria (delete attempts removal; route returns 404 post-delete) and define "reachable."
FINDING | MEDIUM | blueprint "Interfaces" (GET /api/file) | Error enumeration stops at "400 bad kind | 404 unknown id or null path" — no criterion for: path set but object missing in storage, DB lookup failure, missing id param, or storage env unconfigured; the shipped code (dashboard/api/file.js:25,29,37,43) had to invent 400/500/404 choices for all four, evidence the design underspecified its own only-read-path. Add one IF <trigger> THEN <status> line per failable op.
FINDING | MEDIUM | blueprint "Risks" (accidental-route row) / Components #2,#5 | Blueprint adds two files to api/ (sourceStore.js, file.js) but never budgets the Vercel Hobby 12-function cap — a constraint this repo already hit (dashboard/.vercelignore: "Vercel counts every api/*.js as a serverless function (Hobby cap: 12)"; commit 3ec84ab); count is now 8/12 including two non-route helpers (canonicalMap.js, normalizeSkills.js). Add a function-slot budget line or state why headroom is accepted.
FINDING | MEDIUM | blueprint "Interfaces" (sourceStore signatures) | `uploadScreenshot(bytes, jobId, mediaType)` / `signedUrl(path)` omit the Supabase client and client ownership — the component table's "Depends on: @supabase/supabase-js (service role)" reads as sourceStore constructing its own client, while the implementation has every caller pass one in (dashboard/api/sourceStore.js:43); a literal implementer could defensibly instantiate a second module-level service-role client. State who constructs the client; also `signedUrl → url` hides the null-on-failure return the rest of the design depends on.
FINDING | LOW | blueprint "Risks" (latency row) | "measure on deployed verify, acceptable within Vercel's 300 s ceiling" is not falsifiable — no threshold distinguishes pass from fail (300 s is the function ceiling, not a latency bound). Name a bound (e.g. added p50 < N ms) or drop the measurement claim.
FINDING | LOW | blueprint "Risks" (orphan row) | Mitigation claims "deterministic prefixes make orphans reachable," but a crash/timeout between upload and row insert leaves a file with no row — no delete ever fires, so none of the three named mitigations reach it; permanent unreachable orphan in the bucket. Name it as accepted residual risk or add a sweep to deferred work.
FINDING | LOW | blueprint "Risks" (sourceStore-in-api row) | "It exports no default handler ... same situation as canonicalMap.js today" is factually off: canonicalMap.js DOES default-export an object (dashboard/api/canonicalMap.js:2) while sourceStore exports none, and a stray invocation 500s rather than "404s harmlessly." Correct the analogy or state the actual failure mode.
```

## Gate

BLOCK derived mechanically: cross-artifact-traceability / ambiguity axes carry a HIGH finding.
Feed findings back to `/blueprint` (and the plan-text fold), then re-grill — or run `/grill-loop`.
Human override of this BLOCK must be recorded here, never silent.

VERDICT: BLOCK
