# Grill: spec (`sigma/specs/email-parser/spec.md`) — round 1 (griller ≠ author)

- **Target:** sigma/specs/email-parser/spec.md (Email → Application Parser, part 2)
- **Prior stage chained:** PLAN-email-parser.md (grilled READY round 2) + grill/PLAN-email-parser.md.
  Verified the spec did NOT reintroduce resolved plan-grill flaws: names job/job_id/application
  used verbatim (job.id TEXT), matcher predicate fully enumerated incl. null-title/empty-role_raw
  branches, gmail_message_id UNIQUE idempotency, models pinned to exact ids, extraction_confidence
  advisory-only, Gmail token/creds gitignored. Those are all carried correctly.
- **Repo facts verified:** claude-sonnet-4-6 (dashboard/api/extract.js:52, prompts.js:7) and
  claude-haiku-4-5 (prompts.js:8) both exist. job columns company+title read by matcher exist.
  Browser reads via anon key + read-only RLS (dashboard/src/supabase.js). pyproject.toml deps
  (anthropic>=0.111.0, pydantic>=2.13.4, supabase>=2.31.0, python-dotenv>=1.2.2) all real & matched;
  google-api-python-client / google-auth-oauthlib correctly flagged NEW. Vercel api/ has 8 deployed
  functions under the 12 cap (AGENTS.md:414) — the new page adds NO serverless function (browser
  read), so the cap is not bumped (correct).

## Per-axis verdicts

AXIS | ambiguity                                   | FAIL
AXIS | testability                                 | PASS
AXIS | edge & error paths                          | FAIL
AXIS | hidden assumptions / pre-mortem             | FAIL
AXIS | scope discipline                            | PASS
AXIS | ML/data risk                                | PASS
AXIS | cross-artifact traceability                 | PASS
AXIS | constitution / MUST invariants              | PASS
AXIS | behaviour-orientation of acceptance criteria| PASS
AXIS | format / token discipline                   | PASS
AXIS | pinned versions present and real            | PASS
AXIS | BDD scenarios for every user-facing flow    | PASS

## Findings

FINDING | HIGH | §9 ApplicationsPage.jsx + §"Repo layout"(line 78) | Spec says "Modify ... the dashboard's router/nav to mount the new page" and "Mount behind a nav link; touch no existing dashboard logic." The dashboard has NO router — no react-router in dashboard/package.json, main.jsx mounts a single <App/>, App.jsx is one monolithic component. There is nothing to "modify" and no nav to hang a link on. Mounting a second page requires EITHER adding a routing dependency + wrapping App (restructures main.jsx) OR adding view-toggle state inside App.jsx — both contradict "touch no existing dashboard logic." DECIDE: how a second page is mounted in a routerless single-component app, and reconcile the self-contradiction.

FINDING | HIGH | §5 source.py + §"Error handling" | HTML-only email body has undefined behavior. GmailSource maps "body = decoded text/plain" (line 202) with no fallback. Job-search mail (recruiter/LinkedIn/interview-invite) is very commonly text/html with NO text/plain part → body is empty. RawEmail.body is a required str; empty body silently feeds the classifier/extractor → everything degrades to category=other with null fields, invisibly. The Error-handling table has NO row for "no text/plain part." DECIDE the EARS behavior: fall back to stripped text/html, or define the empty-body path explicitly.

FINDING | MEDIUM | §5 source.py fetch | Gmail list pagination is unhandled. users.messages.list returns ≤100 ids/page with a nextPageToken; the spec loops "for each id" over a single list call. A job-search label that has accumulated >100 messages (typical on first run over an established label) is silently truncated — messages past page 1 are never ingested. Add nextPageToken paging or state the cap and its consequence.

FINDING | MEDIUM | §"Error handling" (lines 293 & 296) | Two dueling rules for the same event. "duplicate gmail_message_id: DB UNIQUE conflict -> skip, not raise" vs "supabase write failure: surface the error." A UNIQUE-violation IS a write failure; both are supabase errors. Spec doesn't say how to distinguish them (e.g. Postgres code 23505 = skip; anything else = surface). DECIDE the discriminator so the pipeline doesn't either swallow real write errors or crash on the race it claims to tolerate.

FINDING | MEDIUM | §8 pipeline.py run() | Partial-write semantics undefined. Rows are inserted one-per-email in a loop; if email #k's insert fails, #1..#k-1 are already committed. "no partial silent loss" (line 296) is satisfied only for silence, not for partiality — and it's unstated whether a failed insert ABORTS the run or is logged-and-skipped so the loop continues (RunReport{inserted,...} implies continue). DECIDE abort-vs-continue on write failure.

FINDING | MEDIUM | §"Verification steps"(dashboard) | "drive headless against seeded application rows and screenshot" references seeded application rows, but no seeding path exists — seed.py loads job/skill only (AGENTS.md:363), and the pipeline needs live Gmail+LLM. Define how application rows are seeded for the dashboard screenshot test (fixture insert helper / manual SQL) or the acceptance step isn't buildable as written.

FINDING | LOW | §8 pipeline.py / §3 models | RunReport is referenced (run() -> RunReport{fetched,skipped,inserted,linked,unlinked}) but is not in the models.py Pydantic list (§3 names only RawEmail/ExtractedFields/Application + Category/KeyDate) and its home/shape is unspecified.

FINDING | LOW | §3 models KeyDate.type | KeyDate.type is a bare `str  # one of: ...` (comment-only), not an enforced enum, unlike Category. Named-decision #3 pins the enum but nothing validates it or coerces an off-value; either enforce it or note it's advisory like the classifier coercion.

FINDING | LOW | §6 classify.py | "off-enum → coerce to other" tests a path a forced tool with an enum input schema makes unreachable server-side; fine as defensive code but note the redundancy so it isn't read as a real model failure mode.

FINDING | LOW | §9 ApplicationsPage + supabase.js | dashboard/src/supabase.js stubClient + App.jsx fall back to /jobs.json when Supabase is unconfigured/fails; the new page has no analogous static fallback, so a missing-env deploy white-lists the jobs view but leaves the applications view empty/erroring. Decide whether the new page needs a fallback or renders an explicit empty state.

## Notes
- The two plan-grill gating clusters (matcher predicate; data-model naming) are genuinely preserved
  fixed — no regression. Cross-artifact naming (job/job_id/application, TEXT id), model pins, RLS
  public-read, service-role-only writes, LLM+Supabase mocked in tests, and scope (no sending / no
  canonicalization / session-logging parked) all hold.
- The runtime question resolves benignly: the pipeline is a hand-run LOCAL Python process (7-day
  Gmail re-login → manual reruns) and the dashboard page is pure browser frontend — so no Vercel
  serverless function is added and the 12-function Hobby cap is untouched. Spec should still STATE
  "pipeline runs locally, triggered by hand" explicitly (currently only inferable). LOW.
- Gate driver: two HIGH findings (routerless mount contradiction; HTML-only body undefined) → BLOCK.
  Everything else is MEDIUM/LOW hygiene.

VERDICT: BLOCK

---

## Round 2 — re-grill (griller ≠ author; round 1 was BLOCK / 2 HIGH)

Verified fixes are real, not reworded. Repo facts re-confirmed this round:
- main.jsx renders a single `<App/>`, no react-router anywhere → "routerless single App" is TRUE; a `useState` view-toggle inside App.jsx is a coherent minimal additive edit.
- App.jsx is one monolithic component with an early-return takeover pattern (`if (tailorJob) return <TailorScreen/>`, App.jsx:346) then the main jobs return — a `view` toggle wrapping the main return does NOT collide with the existing tailor flow. No contradiction introduced.
- Model ids real: `claude-sonnet-4-6` (dashboard/api/extract.js:52), `claude-haiku-4-5` (dashboard/api-lib/tailor/prompts.js:8). pyproject deps match; google-* correctly flagged NEW.
- AGENTS.md:414 = 12-function Hobby cap; :405-406 "Preview deploys share the *production* Supabase DB — test destructive actions with throwaway rows"; :349 RLS public-read; :164 always mock LLM. supabase.js confirms stubClient → jobs.json fallback for the browser.

### Round-1 finding resolution
- HIGH routerless mount contradiction (§9) — **RESOLVED.** View-state toggle in App.jsx is the single sanctioned edit; contradictory router/nav wording gone. Coherent vs the real routerless single-component app.
- HIGH HTML-only email body (§5) — **RESOLVED.** Priority fallback (text/plain → tag-stripped text/html → ""); error row + BDD + decision #7.
- MED Gmail list pagination — **RESOLVED.** nextPageToken until exhausted; error row + BDD.
- MED dueling error rules — **RESOLVED.** SQLSTATE 23505 → skip, any other → errors.
- MED partial-write abort-vs-continue — **RESOLVED.** Per-email log-and-continue, not whole-run abort; BDD.
- MED dashboard seeded-rows path — **RESOLVED.** scripts/seed_applications.py (throwaway rows via service-role, screenshot, delete), consistent with AGENTS.md:405-406; not a pytest test, so "tests never hit live services" is not violated.
- LOW RunReport in models — **RESOLVED.**
- LOW KeyDate.type enforced enum — **RESOLVED** (KeyDateType, off-value → other).
- LOW off-enum coerce redundancy noted — **RESOLVED.**
- LOW new-page fallback / empty state — **RESOLVED.**
- (LOW r1 note) "state pipeline runs locally, hand-triggered" — **RESOLVED** (runtime block).

### Per-axis verdicts
AXIS | ambiguity                                    | PASS (was FAIL)
AXIS | testability                                  | PASS
AXIS | edge & error paths                           | PASS (was FAIL)
AXIS | hidden assumptions / pre-mortem              | PASS (was FAIL)
AXIS | scope discipline                             | PASS
AXIS | ML/data risk                                 | PASS
AXIS | cross-artifact traceability                  | PASS
AXIS | constitution / MUST invariants               | PASS
AXIS | behaviour-orientation of acceptance criteria | PASS
AXIS | format / token discipline                    | PASS
AXIS | pinned versions present and real             | PASS
AXIS | BDD scenarios for every user-facing flow     | PASS

### New findings (fresh scan)
- LOW | §5 — HTML tag-strip method unspecified (no lib named).
- LOW | §9 — empty-state trigger doesn't explicitly name the live-query-error case.

No new CRITICAL/HIGH/MED. No regression of any resolved plan-grill flaw.

VERDICT: READY

---

## Post-READY cleanup (author, not a re-grade)

The two round-2 LOW findings were fixed in the spec before advancing:
1. §5 HTML strip pinned to stdlib `html.parser.HTMLParser` (no new dep).
2. §9 empty-state trigger now explicitly includes the live-query-error case (`stubClient` `{data:null,error}`).

Verdict unchanged (READY).
