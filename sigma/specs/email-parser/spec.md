# Spec — Email → Application Parser (part 2)

Implements `PLAN-email-parser.md` (grilled READY 2026-07-22, round 2). Source of
truth for the build; where this file and the plan disagree, **this file wins**.
Self-contained: a fresh agent can implement from this alone.

Prior-stage contract reused verbatim (do not rename): `jd-aggregator-sprint-plan.md`
§"Shared Data Model" + DECISIONS.md 2026-07-01 — the ads entity is the **`job`**
table (id **TEXT**), part 2 writes an **`application`** table (singular), the link
column is **`job_id`** (nullable FK → `job.id`).

---

## Goal

Turn job-search emails into `application` rows, link each to its saved `job` ad
via `job_id` when the match is unambiguous, and surface them on a new dashboard
page — so the corpus can answer "do jobs that reply want different skills than
jobs that go quiet?"

## Why behind the what

- **Match in code, never by prompt.** Linking email→ad is the load-bearing step
  and a wrong link is invisible by eye. The project already ruled (DECISIONS
  2026-06-24 09:26) that cross-record reconciliation is deterministic code, not
  an LLM guess. So the matcher is pure, fully enumerated, and never picks between
  two plausible ads — it returns NULL instead.
- **Raw strings, no canonicalization.** The extractor emits `company_raw` /
  `role_raw` unmodified; canonicalization is explicitly out of scope (same
  under-merge-is-safe principle as part 1). The matcher's only normalization is
  case/whitespace, applied symmetrically to both sides.
- **Idempotent by construction.** Gmail testing-mode login expires every 7 days,
  so the pipeline is re-run by hand repeatedly. A UNIQUE `gmail_message_id` is
  what stops duplicate rows — same lesson as part 1's `screenshot_hash`
  (DECISIONS 2026-07-07).
- **Never touch the ads table.** Applications live in their own table so a bad
  parse can't corrupt the shipped dashboard's ad data.

## Scope

In: Gmail **reading** (one curated label); a classifier + extractor (Anthropic
API); the pure matcher; an `application` table with `job_id`; one read-only
dashboard page.

Out of scope (do not build): sending email; guessing between ≥2 candidate ads
(→ NULL); canonicalizing company/role names; the session-logging experiment
(parked); backfilling `job.company`/`title` from emails (future).

## Repo layout / files

Python package dir is **`email_parser/`** (underscore — the plan's `email-parser/`
is not an importable Python package name; hyphen dirs break `import`). Files to
create:

```
email_parser/__init__.py
email_parser/config.py            # constants: model ids, fetch query, token paths
email_parser/normalize.py         # pure NULL-safe normalize()
email_parser/matcher.py           # pure match(record, jobs) -> job_id | None
email_parser/models.py            # Pydantic: RawEmail, ExtractedFields, Application
email_parser/source.py            # EmailSource, FixtureSource, GmailSource
email_parser/classify.py          # classifier (Anthropic, forced tool)
email_parser/extract_fields.py    # extractor (Anthropic, forced tool)
email_parser/pipeline.py          # read->classify->extract->match->store entrypoint
tests/test_email_normalize.py
tests/test_matcher.py
tests/test_email_models.py
tests/test_source.py
tests/test_classify.py             # LLM mocked
tests/test_extract_fields.py       # LLM mocked
tests/test_pipeline.py             # LLM + Supabase mocked
tests/fixtures/jobs_snapshot.json  # frozen copy of the job table for matcher tests
tests/fixtures/emails/*.json       # sample raw emails, one per category + edges
dashboard/src/ApplicationsPage.jsx # new read-only page
scripts/seed_applications.py       # throwaway application rows for the dashboard screenshot test
```

Modify: `pyproject.toml` (add Gmail deps), `.gitignore` (token/creds), and — the
one sanctioned dashboard edit — `dashboard/src/App.jsx` to add a view-toggle
that swaps between the existing jobs view and the new applications page (Step 6
only; see §9). The dashboard has **no router** (single `<App/>` in `main.jsx`),
so the second page is a view-state toggle inside `App.jsx`, not a route — no new
routing dependency.

**Runtime:** the pipeline is a **local, hand-triggered Python process** (Gmail
testing-mode login expires every 7 days → the user re-runs it manually). It is
**not** a Vercel serverless function, so it does not count against the Hobby
12-function cap (AGENTS.md). The dashboard page is pure browser frontend and
adds no function either.

Layout rules (AGENTS.md): pure logic (`normalize`, `matcher`) has no I/O and is
imported by higher layers, never the reverse; every module gets a top docstring
with its "does NOT do" line.

---

## Component specs

### 1. `normalize.py` — `normalize(s: str | None) -> str`

NULL-safe text key. `normalize(None) == ""` and `normalize("") == ""` (never
throws). Otherwise: `unicodedata`-free — lowercase, strip surrounding
whitespace, collapse internal runs of whitespace to a single space. No
canonicalization (no synonym/legal-suffix folding). Pure; no I/O.

### 2. `matcher.py` — `match(record, jobs) -> str | None`

- `record`: an `ExtractedFields` (has `.company_raw`, `.role_raw`).
- `jobs`: `list[dict]` each with at least `id` (str), `company` (str|None),
  `title` (str|None) — the frozen `job`-table shape.
- Returns a `job.id` (str) or `None`. **Never raises on bad/None fields.**

Algorithm (build and test exactly this — order matters):

1. If `normalize(record.company_raw) == ""` → return `None`.
2. `candidates = [j for j in jobs if normalize(j["company"]) == normalize(record.company_raw) and normalize(j["company"]) != ""]`.
3. `len(candidates) == 0` → `None`.
4. `len(candidates) == 1` → `candidates[0]["id"]`.
5. `len(candidates) >= 2` (same company, multiple roles):
   a. If `normalize(record.role_raw) == ""` → `None` (nothing to disambiguate on; never guess).
   b. `role_tokens = set(normalize(record.role_raw).split())`.
   c. `survivors = [j for j in candidates if set(normalize(j["title"]).split()) & role_tokens]`
      (a NULL `title` → `""` → empty token set → never survives).
   d. `len(survivors) == 1` → `survivors[0]["id"]`; else → `None`.

### 3. `models.py` — Pydantic v2

```yaml
RawEmail:
  gmail_message_id: str        # Gmail message id — idempotency key
  subject: str
  sender: str                  # raw From header
  body: str                    # plain-text body
  received_at: datetime        # timezone-aware (UTC)

Category (enum, str):
  values: [recruiter_outreach, interview_invite, rejection, application_confirmation, other]

KeyDateType (enum, str):
  values: [interview, deadline, response_by, start_date, other]

KeyDate:
  type: KeyDateType            # ENFORCED enum; an off-value coerces to `other` (mirrors classifier)
  date: date | null            # parsed ISO date; null if unparseable
  raw_text: str                # verbatim source phrase — kept so bad date math is spottable

ExtractedFields:
  company_raw: str | null
  role_raw: str | null
  contact_name: str | null
  key_dates: list[KeyDate]     # default []
  action_required: bool        # default false
  action_description: str | null
  extraction_confidence: high | low   # advisory only, model-reported, NEVER a gate

Application:                   # the persisted row
  id: int                      # Supabase serial (DB-assigned)
  gmail_message_id: str        # UNIQUE
  subject, sender, body: str
  received_at: datetime
  category: Category | null    # null until classified
  company_raw, role_raw, contact_name, action_description: str | null
  key_dates: list[KeyDate]     # stored as jsonb
  action_required: bool
  extraction_confidence: high | low
  job_id: str | null           # TEXT FK -> job.id
  created_at: datetime         # DB default now()

RunReport:                     # returned by pipeline.run(); a Pydantic model in models.py
  fetched: int                 # emails returned by the source
  skipped: int                 # already-present gmail_message_ids (idempotent skips)
  inserted: int                # new application rows written
  linked: int                  # of inserted, those with a non-null job_id
  unlinked: int                # of inserted, those with job_id null
  errors: list[str]            # per-email failure notes (see §8 partial-write policy)
```

### 4. `application` table — SQL migration (run by hand in Supabase SQL editor)

No local DDL creds (repo pattern). Prepare this text for review; a person runs
it. RLS mirrors `job`: **public read only**, all writes via the service-role key.

```sql
create table application (
  id                    bigserial primary key,
  gmail_message_id      text not null unique,
  subject               text,
  sender                text,
  body                  text,
  received_at           timestamptz,
  category              text,
  company_raw           text,
  role_raw              text,
  contact_name          text,
  key_dates             jsonb not null default '[]'::jsonb,
  action_required       boolean not null default false,
  action_description    text,
  extraction_confidence text,
  job_id                text references job(id),   -- nullable, TEXT
  created_at            timestamptz not null default now()
);
alter table application enable row level security;
create policy "public read application" on application for select using (true);
-- no insert/update/delete policy: writes only via service-role key
```

### 5. `source.py` — `EmailSource` interface + two implementations

```yaml
EmailSource (abstract):
  fetch() -> list[RawEmail]        # the only method the pipeline calls

FixtureSource(dir):
  fetch: reads tests/fixtures/emails/*.json -> RawEmail list. Tests use this.
  no network, deterministic.

GmailSource:
  auth: Gmail API via google-api-python-client, OAuth2 desktop flow (google-auth-oauthlib).
  credentials file: email_parser/.gmail_credentials.json   (OAuth client secret)
  token cache:      email_parser/.gmail_token.json          (refreshable token)
  both gitignored — secrets, same rule as .env. Never commit.
  fetch query (config.GMAIL_QUERY): "label:job-search"  -- curated; NOT a time window
  fetch: users.messages.list(q=GMAIL_QUERY) -> PAGINATE through nextPageToken until
         exhausted (list returns <=100 ids/page; a first run over an established
         label commonly exceeds one page — never truncate to page 1). For each id,
         users.messages.get -> map to RawEmail.
  body extraction (in priority order, first non-empty wins):
    1. the text/plain MIME part, base64url-decoded.
    2. else the text/html part, base64url-decoded then tag-stripped to text via
       the **stdlib `html.parser.HTMLParser`** (collect data nodes, drop
       script/style, collapse whitespace) — no new HTML dependency. Many
       recruiter / LinkedIn / interview-invite mails are HTML-only.
    3. else "" (empty) — the email is still classified/extracted; an empty body
       will typically land category=other with null fields, which is acceptable
       and visible, not a silent drop.
  gmail_message_id = message id; received_at = internalDate as UTC-aware datetime.
  on expired/invalid token: raise a clear GmailAuthError telling the user to re-run
         the OAuth flow (testing-mode tokens expire every 7 days).
```

Nothing outside `source.py` imports Gmail. The pipeline depends only on
`EmailSource`.

### 6. `classify.py` — classifier subagent

- Model **`claude-haiku-4-5`**, temperature 0, forced tool `classify` whose input
  schema is `{category: enum[the five]}`. One call per email.
- `classify(email: RawEmail, *, api_key, client=None) -> Category`. `client` is
  injectable so tests pass a mock (never a live call — AGENTS.md).
- Prompt gets subject + sender + body. Returns exactly one of the five; if the
  model returns anything off-enum, coerce to `other`. (The forced-tool enum makes
  an off-enum value unreachable server-side; the coercion is defensive belt — its
  test documents intent, not a real observed model failure mode.)

### 7. `extract_fields.py` — extractor subagent

- Model **`claude-sonnet-4-6`**, temperature 0, forced tool `extract` whose input
  schema matches `ExtractedFields`. One call per email.
- `extract(email: RawEmail, category: Category, *, api_key, client=None) -> ExtractedFields`.
  Category conditions the prompt (a rejection has no action; an interview_invite
  likely has `key_dates`). Extraction stays dumb: raw strings, no
  canonicalization. Missing fields → null / `[]` / false.
- `client` injectable for mocking.

### 8. `pipeline.py` — one entry point

```yaml
run(source: EmailSource, supabase, jobs, *, api_key) -> RunReport:
  1. existing = set of gmail_message_id already in application (one select).
  2. for email in source.fetch():
       if email.gmail_message_id in existing: skip (idempotent).
       category = classify(email, api_key=...)
       fields   = extract(email, category, api_key=...)
       job_id   = match(fields, jobs)
       insert one application row (category, fields, job_id).
  3. return RunReport{fetched, skipped, inserted, linked, unlinked, errors}.
```

Idempotency is belt-and-suspenders: the pre-filter skips known ids; the DB UNIQUE
constraint catches a race. **Distinguishing the two Supabase failure modes** (the
one rule the pipeline must get right): on insert, a Postgres **unique-violation
(SQLSTATE `23505`)** on `gmail_message_id` is the tolerated race → count it as a
`skipped`, do not raise. **Any other** write error is real → append a note to
`RunReport.errors` and continue to the next email (**per-email log-and-continue,
not whole-run abort** — one bad row must not drop the rest of the batch; nothing
is silently lost because every failure is recorded in `errors`). A non-empty
`errors` list means the caller reviews it after the run.

`jobs` is fetched once from Supabase by the caller (or a thin `load_jobs(supabase)`
helper) — the matcher itself stays pure.

### 9. `ApplicationsPage.jsx` — dashboard page (Step 6)

New read-only React component in the existing Vite app. Reads `application` via
the browser Supabase client (anon key, public-read RLS) — same pattern as the
jobs list. Columns: company_raw, role_raw, category, received_at, status
(action_required → badge), a `low`-confidence flag, and the linked `job` (via
`job_id`) when present. No writes from the browser.

**Mount (the one allowed `App.jsx` edit):** the dashboard is routerless, so add a
view-state toggle in `App.jsx` — `const [view, setView] = useState('jobs')` and a
nav with two buttons (Jobs | Applications); render the existing jobs view when
`view === 'jobs'`, else `<ApplicationsPage/>`. This is a minimal, additive edit;
it does not restructure the jobs view or `main.jsx`, and adds no dependency.

**Fallback:** `dashboard/src/supabase.js` falls back to `/jobs.json` when Supabase
is unconfigured, but there is **no** static applications fixture. So when the
client is unconfigured, the query **errors** (`stubClient` returns
`{data: null, error}`), or it returns an empty set, `ApplicationsPage` renders an
explicit empty state ("No applications yet — run the email parser") rather than
erroring or blank-screening.

---

## Config / versions (flat YAML)

```yaml
python: ">=3.13"
new_python_deps:                 # add via `uv add` (Gmail not yet in the project)
  google-api-python-client: ">=2.149.0"
  google-auth-oauthlib: ">=1.2.1"
existing_python_deps:
  anthropic: ">=0.111.0"
  pydantic: ">=2.13.4"
  supabase: ">=2.31.0"
  python-dotenv: ">=1.2.2"
models:
  classifier: claude-haiku-4-5
  extractor:  claude-sonnet-4-6
env_vars:                        # already present in the repo
  ANTHROPIC_API_KEY: extractor + classifier
  SUPABASE_URL: pipeline writes
  SUPABASE_SERVICE_ROLE_KEY: pipeline writes (service role; browser stays anon)
gmail:
  query: "label:job-search"
  credentials_file: email_parser/.gmail_credentials.json   # gitignored
  token_file: email_parser/.gmail_token.json               # gitignored
llm_budget: 2 calls per email (1 Haiku classify + 1 Sonnet extract)
```

## Error handling

```yaml
empty/None company_raw:      matcher returns None (unlinked). Not an error.
>=2 same-company candidates:  role tiebreak; unresolved -> None. Not an error.
email has no text/plain part: fall back to stripped text/html; if neither, body="".
                              Empty body is classified normally (usually -> other). Not an error.
gmail list > 100 messages:    paginate via nextPageToken; never truncate to page 1.
gmail token expired:          GmailSource raises GmailAuthError; run aborts before any write.
classifier off-enum output:   coerce to `other` (defensive; forced-tool makes it unreachable).
key_dates off-enum type:      coerce to `other`.
extractor null fields:        allowed; persisted as null/[]/false.
duplicate gmail_message_id:   pre-filter skip; on insert, SQLSTATE 23505 -> count as skipped, not raise.
other supabase write failure: append to RunReport.errors and continue to next email
                              (log-and-continue, not whole-run abort; nothing silently lost).
LLM call in tests:            never live — injected mock client; a real call is a test bug.
```

---

## Acceptance criteria (BDD)

```gherkin
Scenario: unambiguous single match links
  Given a job "job-3" with company "Acme" and one extracted email with company_raw "acme"
  When match(record, jobs) runs
  Then it returns "job-3"

Scenario: no candidate company stays unlinked
  Given no job has company matching the email's company_raw "Nonesuch"
  When match runs
  Then it returns None

Scenario: empty company_raw stays unlinked
  Given an extracted record whose company_raw is null or ""
  When match runs
  Then it returns None without inspecting jobs

Scenario: two roles same company resolved by role token
  Given jobs "job-1" (Acme, "Senior Backend Engineer") and "job-2" (Acme, "Data Scientist")
    And an email with company_raw "Acme" and role_raw "backend engineer"
  When match runs
  Then it returns "job-1"

Scenario: two roles same company with no role text stays unlinked
  Given two "Acme" jobs and an email with company_raw "Acme" and role_raw null
  When match runs
  Then it returns None

Scenario: two roles same company with non-overlapping role stays unlinked
  Given two "Acme" jobs titled "Data Scientist" and "ML Engineer"
    And an email with company_raw "Acme" and role_raw "Product Manager"
  When match runs
  Then it returns None

Scenario: null title candidate never wins the tiebreak
  Given two "Acme" jobs, one with title null and one titled "Backend Engineer"
    And an email with company_raw "Acme" and role_raw "backend"
  When match runs
  Then it returns the "Backend Engineer" job id

Scenario: matcher never raises on null fields
  Given a jobs list containing a job with company null and title null
  When match runs for any record
  Then it returns a value or None and raises no exception

Scenario: pipeline is idempotent on re-run
  Given an application row already exists for gmail_message_id "abc"
  When the pipeline runs over an inbox that still contains message "abc"
  Then no second row is inserted and the run reports it as skipped

Scenario: only labelled mail is ingested
  Given the Gmail mailbox contains messages with and without the "job-search" label
  When GmailSource.fetch runs
  Then only messages matching "label:job-search" are returned

Scenario: classification assigns one of five categories
  Given a rejection email
  When classify runs (mocked to the tool contract)
  Then category is one of the five enum values

Scenario: off-enum classifier output coerces to other
  Given a classifier response with a category outside the enum
  When classify runs
  Then it returns "other"

Scenario: extractor keeps raw strings and flags low confidence
  Given an ambiguous recruiter email
  When extract runs (mocked)
  Then company_raw/role_raw are returned verbatim and extraction_confidence may be "low", never blocking the write

Scenario: expired Gmail token aborts before any write
  Given the cached Gmail token is expired
  When the pipeline runs
  Then GmailSource raises GmailAuthError and no application row is written

Scenario: a bad row never lands in the job table
  Given the pipeline processes any email
  When it stores the result
  Then the write targets the application table only and job is untouched

Scenario: dashboard page is read-only over applications
  Given application rows exist
  When ApplicationsPage loads with the anon browser client
  Then rows render (with linked job when job_id is set) and the browser issues no write

Scenario: HTML-only email still yields a body
  Given a Gmail message with a text/html part and no text/plain part
  When GmailSource maps it to a RawEmail
  Then body is the tag-stripped HTML text (non-empty), not an empty string

Scenario: label with more than one page is fully ingested
  Given the "job-search" label holds 150 messages (two list pages)
  When GmailSource.fetch runs
  Then all 150 are returned (nextPageToken is followed), none truncated

Scenario: unique-violation on insert is a tolerated skip
  Given a concurrent run already inserted gmail_message_id "abc"
  When this run inserts "abc" and Postgres raises SQLSTATE 23505
  Then it is counted as skipped and the run does not raise

Scenario: a non-unique write error does not abort the batch
  Given three emails and the second email's insert fails with a non-23505 error
  When the pipeline runs
  Then emails 1 and 3 are inserted, the failure is recorded in RunReport.errors, and the run completes

Scenario: applications view shows an empty state when there are no rows
  Given the application table is empty (or Supabase is unconfigured)
  When the user toggles to the Applications view
  Then an explicit "No applications yet" empty state renders, not a blank screen or error
```

## Verification steps per component

- **normalize / matcher:** `uv run pytest tests/test_email_normalize.py tests/test_matcher.py` — every BDD matcher scenario is a case; run in a fresh process (determinism).
- **models:** pydantic validation tests — enum bounds, defaults ([]/false), key_dates typed shape.
- **source:** `FixtureSource.fetch` returns the fixture set; `GmailSource` query string equals `config.GMAIL_QUERY` (assert the constant; the API call itself is mocked).
- **classify / extract_fields:** LLM mocked to the forced-tool contract; assert enum coercion and raw-string passthrough. No live call.
- **pipeline:** Supabase + LLM mocked; assert idempotent skip, insert count, linked/unlinked report, and that writes target `application`.
- **dashboard:** `cd dashboard && npm run build` green; render `ApplicationsPage`
  two ways — (a) the **empty state** with zero rows (no seeding needed), and (b)
  a **populated** view fed by a small seed helper `scripts/seed_applications.py`
  that inserts 2–3 throwaway `application` rows (one linked via `job_id`, one
  unlinked, one `action_required`) via the service-role key, screenshots, then
  deletes them. No live Gmail/LLM needed — the rows are hand-built fixtures, not
  parser output. (Preview deploys share prod Supabase — use throwaway rows and
  clean them up, per AGENTS.md.)

## Test plan / fixtures

- `tests/fixtures/jobs_snapshot.json` — a frozen copy of the `job` table (≥2
  rows sharing a company, ≥1 null-company row, ≥1 null-title row) so the matcher
  branches are all reachable. Copy once; never read live Supabase in tests.
- `tests/fixtures/emails/` — one raw email per category plus edge fixtures
  (empty company, multi-role company, agency-recruiter under agency name,
  **HTML-only body with no text/plain part**).
- All LLM calls mocked; all Supabase calls mocked. Tests fast + deterministic.

---

## Named decisions made here (surface for review; each can be vetoed)

1. Package dir `email_parser/` (underscore), not the plan's `email-parser/` —
   hyphen is not importable.
2. `application` table gets a **public-read RLS policy** (mirrors `job`) so the
   browser page can read it; writes stay service-role only.
3. `KeyDateType` is an **enforced** enum `{interview, deadline, response_by,
   start_date, other}`; off-value coerces to `other`.
4. Gmail deps pinned `google-api-python-client>=2.149.0`, `google-auth-oauthlib>=1.2.1`
   — **new** to the project; add with `uv add` (sanctioned by the accepted plan).
5. Classifier off-enum output coerces to `other` rather than raising (defensive).
6. **Dashboard mount = view-toggle in `App.jsx`** (routerless app; user-chosen
   over adding react-router). One additive `App.jsx` edit; no new dependency.
7. **HTML-only email body:** fall back to tag-stripped `text/html`; empty body if
   neither part exists (classified normally, not dropped).
8. **Write-failure policy:** SQLSTATE `23505` → tolerated skip; any other error →
   record in `RunReport.errors` and continue (per-email log-and-continue, no
   whole-run abort).
9. Pipeline is a **local, hand-triggered** process — not a Vercel function; the
   dashboard page adds no function (12-cap untouched).

## Next

→ `/sigma:grill --target spec` (grill this spec before decomposing) → `/sigma:tasks`.
