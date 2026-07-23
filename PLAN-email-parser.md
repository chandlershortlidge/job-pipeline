# Build Plan — Email → Application Parser

For a cold agent picking this up: read AGENTS.md, README.md, and DECISIONS.md
first, then this. This feature lives in `email-parser/` inside the existing
job-pipeline repo — it is an extension of this project, not a separate build.
It shares the repo's Supabase and its React dashboard. Do not touch the live
dashboard code until Step 6.

Follow the repo's normal build loop: plan → check in a notebook → move into
the codebase with a test → commit. Do not skip the notebook step on the
matcher or the extractor — a wrong result there is exactly the kind that's
hard to spot by eye.

**This plan is self-contained.** Everything needed to build Step 1 (the
matcher) is stated inline below — no off-repo chat draft or "experiment spec"
is required. Where it reuses a prior decision, it cites the file and section.

---

## Reuses the recorded shared data model (do not rename it)

`jd-aggregator-sprint-plan.md` §"Shared Data Model" and DECISIONS.md
2026-07-01 already fixed the part-2 contract, and part 1 shipped against it:

- The ads entity is the **`job`** table (id is **TEXT** — `job-N` / `live-<ts>`,
  see AGENTS.md pitfalls). It is what Step 0 q1 resolves; the columns are the
  ones `dashboard/api/extract.js` inserts (id, company, title, seniority,
  summary, screenshot_hash, created_at, …).
- Part 2 writes an **`application`** table (singular).
- The link column is **`job_id`** (nullable FK → `job.id`, TEXT).

This plan uses those names verbatim. The earlier draft's `jd_id` / "ads table"
/ "applications" names are dropped — reusing the recorded names is the whole
reason part 1 built the `job` insurance, and a rename re-opens the rewrite it
was designed to prevent. If a future reader wants to rename, that needs its own
DECISIONS entry first.

---

## Step 0 — Look before building (report back, change nothing)

Most of this is already answered by the record; confirm against the live repo
and report deltas, do not re-discover from scratch.

1. **`job` table** — confirm the live column list matches `extract.js`'s insert
   (id, company, title, seniority, seniority_signal, seniority_basis, summary,
   source, screenshot_hash, screenshot_path, created_at). Report any column the
   matcher will read (`company`, `title`) that is missing or differently named.
2. **Gmail — two distinct questions, answer both:**
   a. Agent-side: is a Gmail tool available to *this* session (`@` / MCP)? Used
      only to hand-build fixtures in Step 0, never by the pipeline.
   b. Pipeline-side: how will `GmailSource` (Python in `email-parser/`)
      authenticate at *runtime*? Confirm the intended path below is viable —
      Gmail API via `google-api-python-client`, OAuth2 desktop credentials, a
      locally-cached token (testing mode → 7-day expiry, already noted). If that
      is not available, report it: the "real inbox" DoD is blocked until it is.
3. Where the live React dashboard reads ad data today (file + query) — the new
   page sits beside it.
4. Repo layout: where Python lives vs. the React app, so `email-parser/` lands
   right.

Report all four. Then stop for review.

---

## Purpose

Turn job-search emails into `application` records, link each back to its saved
`job` ad via `job_id` when the match is unambiguous, and show the result on a
new dashboard page. Answers a question the current dashboard can't: do the jobs
that reply want different skills than the jobs that go quiet?

## Definition of done

- Emails are read from the real Gmail inbox through a source interface
  (`EmailSource`) that lets tests run on fixtures instead of the live inbox.
- Only emails matching the **fetch query** (Step 3) enter the pipeline; each is
  classified into one of five categories and its fields extracted — by two
  subagents (classifier, extractor).
- Each record links back to a `job` ad via `job_id` when the matcher (Step 1,
  below) returns exactly one match; otherwise `job_id` stays NULL.
- Re-running the pipeline over the same inbox does **not** create duplicate
  rows (idempotent on `gmail_message_id`).
- Records are written to a new `application` table in the same Supabase project
  the dashboard already uses — never mixed into the `job` table.
- A new dashboard page shows the applications and their status.

## Adds / does not add

- **Adds:** Gmail reading (not sending); classifier + extractor subagents;
  the matcher; an `application` table with a `job_id` column; one dashboard
  page.
- **Does not add:** sending email; guessing between several plausible ads (≥2
  candidates → NULL, never a coin-flip); canonicalizing company/role names; the
  session-logging experiment (parked).

## Steps (easiest-to-check first)

1. **The matcher** — pure logic, no live services. Signature:
   `match(record, jobs) -> job_id | None`. Definition of "unambiguous match"
   (build and test exactly this):
   - Normalize both sides with one shared helper that is **NULL-safe**:
     `normalize(None)` and `normalize("")` both return `""` (never throw).
     Otherwise lowercase, strip surrounding whitespace, collapse internal
     whitespace. **No canonicalization** beyond that (no synonym/legal-suffix
     folding — that's explicitly out of scope).
   - **Empty/NULL `company_raw`** (`normalize(company_raw) == ""`) → `None`
     immediately.
   - **Candidates** = jobs with a non-NULL `company` whose normalized `company`
     equals the record's normalized `company_raw`. (A NULL-company job
     normalizes to `""`, which can never equal a non-empty `company_raw`, so it
     is never a candidate.)
   - **0 candidates** → `None` (correct for agency recruiters emailing under the
     agency name, and for any company not in the corpus).
   - **exactly 1 candidate** → that job's `id`.
   - **≥2 candidates** (same company, multiple roles) → disambiguate by role:
     - If `normalize(role_raw) == ""` (no role to match on) → `None` (can't
       disambiguate; never guess).
     - Otherwise keep candidates whose normalized `title` shares ≥1
       whitespace-token with the normalized `role_raw`. A candidate with a NULL
       `title` normalizes to `""` (no tokens), so it never survives the overlap.
       If **exactly 1** survives → its `id`; otherwise → `None`.

   Build in a notebook against a **fixture copy** of the `job` table; test every
   enumerated branch with a sample row: 0-candidates / exactly-1 /
   2-same-company-role-resolves / 2-same-company-role-fails /
   2-same-company-empty-role_raw / candidate-with-null-title / null-company job
   present / null-or-empty-company_raw. This is the load-bearing logic — a wrong
   link is invisible by eye, so the notebook step is mandatory (AGENTS.md).

2. **Data model + `application` table** — Pydantic model per the field list
   below; create the Supabase `application` table. `job_id` is a **nullable
   TEXT** FK → `job.id`. `gmail_message_id` is **TEXT NOT NULL UNIQUE** (the
   idempotency key). SQL run by hand in the Supabase SQL editor (repo pattern —
   no local DDL creds), migration text prepared here for review.

3. **Gmail as a swappable source** — an `EmailSource` interface with two
   implementations: `FixtureSource` (reads sample emails from
   `tests/fixtures/`) and `GmailSource` (Gmail API via
   `google-api-python-client`, OAuth2 desktop creds, locally-cached token — the
   path confirmed in Step 0 q2b). **Token + creds are secrets:** cache the token
   at `email-parser/.gmail_token.json` and keep the OAuth client secret at
   `email-parser/.gmail_credentials.json`; add both (and `*.gmail_token.json`)
   to `.gitignore` — never commit either, same rule as `.env`. **Fetch query
   pinned:** `GmailSource` fetches only messages matching the Gmail search query
   **`label:job-search`** — the user applies that label to job-search threads,
   so the pipeline ingests a curated set, not the whole mailbox and not a
   time-window guess (which would pull in unrelated mail as `category=other`).
   The query is a single named constant so it can change in one place. Each
   fetched message carries its Gmail `message_id`. Tests use `FixtureSource`;
   nothing else in the parser learns about Gmail.

4. **Classifier + extractor subagents** — both are **Anthropic API calls
   (direct, not Daytona-sandboxed** — Daytona was the part-1 live-drop showcase,
   not this offline pipeline). Pin exact model ids, matching the repo's existing
   pins (`dashboard/api-lib/tailor/prompts.js`): **classifier =
   `claude-haiku-4-5`** (cheap, 5-way label — same tier as the résumé judge),
   **extractor = `claude-sonnet-4-6`** (same id `extract.js` / `resume.js` use).
   Budget:
   **2 LLM calls per email**, mocked in every test (AGENTS.md: never live LLM in
   tests). Classifier assigns category from the fixed five; extractor pulls
   fields given email text + assigned category. Extraction stays dumb: raw
   strings, no canonicalization.

5. **Wire the pipeline** — read → classify → extract → match → store, one entry
   point. **Idempotency:** before classify/extract, skip any `gmail_message_id`
   already in `application` (upsert on the UNIQUE key); a second run over the
   same inbox is a no-op. Store `job_id` from the matcher (or NULL).

6. **Dashboard page** — new page in the existing React app reading the
   `application` table. Only now touch dashboard code.

## Data model

- `id`, `gmail_message_id` (TEXT NOT NULL UNIQUE — idempotency key), `subject`,
  `sender`, `body`, `received_at`
- `category` — nullable until classified; one of: recruiter_outreach,
  interview_invite, rejection, application_confirmation, other
- `company_raw`, `role_raw`, `contact_name` — raw extracted strings, not
  canonicalized
- `key_dates` — list of typed objects `[{"type","date","raw_text"}]`; keep
  raw_text beside the parsed date so bad relative-date math is spottable
- `action_required` (bool), `action_description` (str)
- `extraction_confidence` — "high" | "low"; **advisory only**, model-reported,
  **not a gate** (the project distrusts LLM self-assessment as a hard signal —
  DECISIONS 2026-06-24 09:26). Surfaced in the UI to flag rows worth a human
  glance; it never blocks a write. Prefer a low flag over a confident wrong
  guess.
- `job_id` — nullable **TEXT** FK → `job.id` (see §"Reuses the recorded shared
  data model")

## Pitfalls

- Copy the `job` table into a fixture once for the matcher's tests — don't lean
  on live Supabase in tests (repo rule: tests never hit live services).
- Writing into the same Supabase the dashboard reads means a bad row shows up in
  the real interface. Applications go in their own `application` table, never
  `job`.
- Gmail sign-in expires every 7 days in testing mode. Fine for a demo you
  trigger yourself; don't build anything assuming it stays logged in.
- Agency recruiters email under the agency name, not the employer — those land
  unlinked (`job_id` NULL), and that's correct behavior, not a bug.
- The pipeline is re-runnable by construction (Gmail re-login forces reruns) —
  the `gmail_message_id` UNIQUE key is what stops duplicate `application` rows.
  Same bug class as the part-1 `screenshot_hash` dedup (DECISIONS 2026-07-07);
  don't drop it.
- Multiple ads for the same company are expected — the matcher's role-token
  tiebreak handles them, and falls to NULL rather than guessing.

## Budget

- Step 1 (matcher) needs no credentials — pure logic, notebook + fixture only.
- Steps 2–6 need Claude Code with your Supabase and Gmail. 2 LLM calls per email
  (Haiku + Sonnet), mocked in tests. Each step stops for review before the next.
  Commit at each working checkpoint, not all at once — and only when explicitly
  asked.
