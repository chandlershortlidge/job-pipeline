# Grill: build plan (`PLAN-email-parser.md`) — round 1

- **Target:** `PLAN-email-parser.md` (Email → Application Parser — part 2 of job-pipeline)
- **Tier:** blueprint/plan (design-level: boundaries, coupling, risks, missing components) — plus testability, since the plan commits to a Definition of Done.
- **Prior-stage context chained back:** `jd-aggregator-sprint-plan.md` §"Shared Data Model" (the part-2 insurance), DECISIONS.md 2026-07-01 (Supabase chosen; `job`/`skill`/`application` schema, part 2 joins on `job_id`), AGENTS.md (build loop, honesty rules, layout rules), `dashboard/api/extract.js` (the `job` row shape the matcher consumes).
- **Griller ≠ author.**

---

## Per-axis verdicts

```
AXIS | cross-artifact traceability (naming vs recorded data model) | FAIL
AXIS | dangling references (cited context exists in repo)          | FAIL
AXIS | ambiguity / testability (matcher "unambiguous match")       | FAIL
AXIS | edge & error paths (idempotency, null/multi-match, filter)  | FAIL
AXIS | hidden assumptions / pre-mortem (Gmail runtime auth)        | FAIL
AXIS | ML/data risk (LLM self-confidence, model pinning)           | FAIL
AXIS | scope discipline                                            | PASS
AXIS | behaviour-orientation of DoD                                | PASS
```

## Findings

```
FINDING | CRITICAL | Steps §1 + DoD | "single unambiguous match" is the load-bearing, notebook-mandated logic and is undefined. Match on which fields? company_raw vs job.company? role_raw vs job.title? Exact / case-insensitive / trimmed? job.company is nullable+non-canonical (logo-only/cropped -> null per extract.js) and the extractor is spec'd to emit raw, uncanonicalized strings — so both sides of the comparison are messy. Decide the exact match predicate and what "unambiguous" means (exactly one candidate?) before Step 1. No acceptance example given.
FINDING | HIGH | §"Data model" jd_id + Steps §2 + DoD | Naming silently contradicts the recorded shared data model. jd-aggregator-sprint-plan.md §Shared Data Model and DECISIONS 2026-07-01 define: the ads entity IS the `job` table, part 2 writes an `application` table (singular), join column `job_id` (FK -> job). This plan invents `jd_id`, "the JD ads table", "applications table" (plural). The sprint plan's entire "plugs in without a rewrite" insurance depended on reusing those names. AGENTS.md: contradicting a recorded decision must be stated plainly, not overridden silently. Decide: adopt `job`/`job_id`/`application`, or record a new DECISIONS entry justifying the rename.
FINDING | HIGH | §"Data model" line 99 | Dangling reference: "nullable link to the JD ads table (see DECISIONS entry)". No DECISIONS.md entry defines `jd_id` or this link. The only matching entries (07-01, line 910) specify `job_id`, i.e. they contradict the citation. A cold agent following the pointer lands on the opposite name.
FINDING | HIGH | §"Data model" line 86 + Steps §1 line 70 | Dangling references to off-repo artifacts. The data model "carries over" from "the experiment spec" — no such file in the repo. The matcher is "already drafted with Claude in chat — drop that in here" — that draft is not in the repo either. AGENTS.md: intent not written down does not exist to the next agent. Land both in the repo (or restate inline) before a cold agent can build Step 1.
FINDING | HIGH | §Steps §5 (Wire the pipeline) | No idempotency / dedup key. read->classify->extract->match->store, re-triggered manually (Gmail re-login every 7 days implies repeated runs), re-inserts the same emails as duplicate application rows. The main project already paid for this lesson (screenshot_hash UNIQUE, DECISIONS 07-07). Pin a uniqueness key (Gmail message-id) + upsert semantics.
FINDING | HIGH | §Steps §3 + DoD "read from the real Gmail inbox" | Runtime Gmail auth for the Python pipeline is unspecified and conflated with agent tooling. A Gmail tool being available to THIS agent in-session (MCP) is not the same as `GmailSource` (Python in email-parser/) authenticating at pipeline runtime. Name the actual mechanism (OAuth client + token store? which API?) — Step 0 q2 only checks agent-side availability, not the pipeline's path.
FINDING | MEDIUM | §Steps §4 (subagents) | "classifier + extractor subagents" — mechanism undefined. LLM calls? Which model (repo pins sonnet for extract, Haiku for judge)? Direct API or Daytona-sandboxed like extract.js? No per-email cost/latency budget. Pin model + call path.
FINDING | MEDIUM | §Steps §5 / §Purpose | No inbox filter / entry criteria. Which fetched emails enter the pipeline? Without a filter, spam/newsletters/threads all become rows (mostly category=other). Define what is fetched and what is dropped before classification.
FINDING | MEDIUM | §"Data model" extraction_confidence | "high"|"low" is model self-reported. DECISIONS 2026-06-26 09:26 established this project distrusts LLM self-assessment as nondeterministic and prefers code rules. DoD leans on the flag ("prefer a low flag over a confident wrong guess") without defining what triggers "low". Either define a code-side trigger or record that the advisory flag is deliberately soft.
FINDING | LOW | §Steps §2 (jd_id type) | job.id is TEXT (`job-N` / `live-<ts>`, AGENTS pitfalls), not int. Pin jd_id as TEXT nullable FK when the table name resolves, so the FK type matches.
```

## Notes

- **Scope is genuinely tight** (parks session-logging, excludes sending / canonicalization / multi-ad guessing) — scope axis passes cleanly. The failures are about *precision and traceability*, not over-reach.
- **Step 0 partly redundant with the record.** Q1 ("what is the ads table called, what columns") is largely answered by DECISIONS + `extract.js`: table `job`, columns id/company/title/seniority/summary/screenshot_hash/created_at/… The plan should reconcile with that record rather than re-discover it — and, critically, not pre-commit the data model to `jd_id` before Step 0 "resolves the name."
- **The two CRITICAL/HIGH clusters that gate this:** (1) the matcher's undefined match predicate — the one piece the repo's own rules force through a notebook because a wrong result is invisible by eye; (2) the data-model naming diverging from the recorded shared model the whole part-2 plan exists to reuse.

VERDICT: BLOCK

---

## Round 2

- **Target:** `PLAN-email-parser.md` — re-grilled after round-1 `VERDICT: BLOCK`.
- **What changed since round 1:** the plan was substantially rewritten. It now (a) uses the recorded names `job` / `job_id` / `application` verbatim and adds a "Reuses the recorded shared data model" section, (b) fully specifies the matcher's "unambiguous match" predicate with enumerated test branches, (c) declares itself self-contained (drops the off-repo "experiment spec" / "chat draft" pointers), (d) adds `gmail_message_id TEXT NOT NULL UNIQUE` + idempotency in Step 5, (e) splits Gmail auth into agent-side vs pipeline-runtime and names the mechanism, (f) pins classifier=Haiku / extractor=Sonnet, direct Anthropic API, mocked in tests, and (g) records `extraction_confidence` as advisory-only, never a gate.

### Per-axis verdicts (round 2)

```
AXIS | cross-artifact traceability (job/job_id/application, job.id TEXT) | PASS
AXIS | dangling references (cited files/sections/dates exist)            | PASS
AXIS | ambiguity / testability (matcher predicate + branch completeness) | PASS
AXIS | edge & error paths (idempotency, null/multi, tiebreak edges)      | PASS
AXIS | hidden assumptions / pre-mortem (Gmail runtime auth, fetch query) | PASS
AXIS | ML/data risk (models pinned, LLM mocked, confidence advisory)     | PASS
AXIS | scope discipline                                                  | PASS
AXIS | behaviour-orientation of DoD                                      | PASS
```

### Round-1 finding resolution

```
R1 CRITICAL (matcher predicate undefined)      | RESOLVED — Step §1 now defines normalize (lowercase / strip surrounding ws / collapse internal ws, no canonicalization), candidates = non-NULL job.company == normalized company_raw, 0->None / 1->id / >=2 -> role whitespace-token tiebreak (exactly 1 survives -> id else None), NULL/empty company_raw -> None. Branches enumerated for the notebook. Testable.
R1 HIGH (naming vs shared model: jd_id)        | RESOLVED — uses job / job_id / application verbatim; jd_id / "ads table" / "applications" explicitly dropped; §"Reuses the recorded shared data model" added and matches sprint-plan §Shared Data Model (line 131) + DECISIONS 2026-07-01 15:09 (line 442).
R1 HIGH (dangling ref: jd_id / DECISIONS)      | RESOLVED — data-model line 173 now cites §"Reuses..." with job_id TEXT FK -> job.id; no phantom DECISIONS pointer.
R1 HIGH (off-repo artifacts: experiment spec)  | RESOLVED — plan states it is self-contained (lines 14-16); matcher stated inline; no chat draft / experiment spec pointers remain.
R1 HIGH (no idempotency key)                   | RESOLVED — gmail_message_id TEXT NOT NULL UNIQUE (Step §2 / data model); Step §5 skips seen ids + upsert; pitfalls tie it to the screenshot_hash lesson (DECISIONS 2026-07-07, line 279).
R1 HIGH (Gmail runtime auth conflated)         | RESOLVED — Step 0 q2 splits agent-side vs pipeline-side; names google-api-python-client + OAuth2 desktop creds + locally-cached token + 7-day expiry, and gates the "real inbox" DoD on Step 0 confirmation.
R1 MEDIUM (subagent mechanism undefined)       | RESOLVED — Step §4: direct Anthropic API (not Daytona), classifier=Haiku, extractor=Sonnet, 2 calls/email, mocked in every test.
R1 MEDIUM (no inbox filter)                     | PARTIAL — a fetch-query filter now exists structurally, but the exact value is still undecided: line 133 says "Fetch query pinned" yet line 136 says "default: a dedicated label or `newer_than:30d in:inbox` — decide the exact query here and record it." The two options differ materially (label = curated; newer_than:30d = everything recent -> application table fills with category=other newsletters). See R2-1.
R1 MEDIUM (extraction_confidence self-report)  | RESOLVED — recorded as deliberately soft: "advisory only, model-reported, not a gate ... never blocks a write" (data model lines 168-172), satisfying R1's "record that the advisory flag is deliberately soft" option. (Citation date is wrong — see R2-2.)
R1 LOW (jd_id type should be TEXT)              | RESOLVED — job_id is nullable TEXT FK -> job.id (Step §2 line 126, data model line 173); consistent with AGENTS.md pitfall "job ids are text (job-N, live-<ts>)" (line 409).
```

### New / carried findings (round 2)

```
FINDING | MEDIUM | Steps §3 (fetch query) | "Fetch query pinned" (line 133) is not actually pinned — line 136 defers the value ("decide the exact query here and record it") and offers two materially different defaults. Decide the concrete query now: a dedicated Gmail label (curated, low `other` noise) vs `newer_than:30d in:inbox` (broad, fills `application` with newsletters as category=other). DoD line 77-78 ("only emails matching the fetch query enter the pipeline") is only as precise as this value. Non-blocking: the decision point is explicitly located in Step 3.
FINDING | MEDIUM | §Data model line 170 (+ any 09:26 cite) | Dangling date: plan cites "DECISIONS 2026-06-26 09:26" but the 09:26 entry is dated 2026-06-24 ("Skill normalization must be done in code after extraction, not by the prompt"); no 09:26 entry exists on 2026-06-26. Content is correctly summarized, so this is a citation typo, not a wrong claim — fix the date so a cold agent's pointer resolves.
FINDING | MEDIUM | Steps §1 (tiebreak edges) | The role-token tiebreak's enumerated branches (0 / 1 / 2-same-company / null-company / null-company_raw / role-tiebreak-resolves / role-tiebreak-fails) omit two reachable inputs: (a) a candidate job whose `title` is NULL (job.title is nullable per extract.js) — normalizing NULL is undefined and could throw instead of yielding a clean None; (b) empty/NULL `role_raw` in the >=2 case (zero tokens -> no survivor -> None, but not tested). Add both branches and define normalize() behavior on NULL. Non-blocking but load-bearing.
FINDING | LOW | Steps §4 / §Data model | Models pinned only by family ("Claude Sonnet" / "Claude Haiku"). extract.js pins the exact id `claude-sonnet-4-6` (line 52). Pin exact model ids for reproducibility and to match the shipped extractor.
FINDING | LOW | Steps §0 q2b / §3 (token storage) | "Locally-cached token" names the mechanism but not where the OAuth token file lives or that it must be gitignored / never committed. State the token path + that it is excluded from VCS (secret-hygiene), since the repo already commits build plans alongside code.
```

### Notes

- The two round-1 gating clusters (undefined matcher predicate; data-model naming divergence) are both genuinely fixed in substance, not merely reworded — verified against `jd-aggregator-sprint-plan.md` §Shared Data Model (line 131), DECISIONS 2026-07-01 15:09 / 2026-07-07 / 2026-06-24 09:26, `dashboard/api/extract.js` (job columns id/company/title/seniority/seniority_signal/seniority_basis/summary/source/screenshot_hash/screenshot_path/created_at all present; matcher reads company+title, both exist), and AGENTS.md (build loop, notebook mandate, mock-LLM-in-tests, job.id TEXT).
- Remaining findings are all MEDIUM/LOW: one deferred decision (fetch query), one citation-date typo, one set of untested tiebreak edges, and two hygiene items. None is CRITICAL or HIGH.

VERDICT: READY

---

## Post-READY cleanup (author, not a re-grade)

The five non-blocking round-2 findings were fixed in `PLAN-email-parser.md` before advancing:
1. Fetch query pinned to `label:job-search` (was deferred).
2. Citation date corrected to DECISIONS 2026-06-24 09:26.
3. Matcher: NULL-safe `normalize`, explicit empty-`role_raw` → None, null-`title` handling; test list now enumerates all 8 branches.
4. Models pinned to exact ids `claude-haiku-4-5` / `claude-sonnet-4-6` (match `api-lib/tailor/prompts.js`).
5. Gmail token + creds paths named and gitignored.

Verdict unchanged (READY). These were MEDIUM/LOW hygiene, not gate conditions.
