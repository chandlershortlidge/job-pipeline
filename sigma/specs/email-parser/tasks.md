# Tasks — Email → Application Parser (part 2)

Decomposed from `sigma/specs/email-parser/spec.md` (grilled READY 2026-07-22,
round 2). One commit per task (AGENTS.md); commit only when asked. Follow the
build loop: notebook-check the matcher and extractor before moving them in
(a wrong result there is invisible by eye). BDD scenario names below refer to
the spec's "Acceptance criteria" — each named scenario is a test target.

**The spec is the single source of truth** — where this file and `spec.md`
disagree, `spec.md` wins.

Domains: `data-engineering` (pure logic, Supabase I/O, pipeline wiring),
`llm-engineering` (classifier/extractor), `frontend` (dashboard — non-ML, no
sigma context-engine; use the repo's existing React idioms).

---

## Ordering / parallelism at a glance

```
T0 (recon, no code)
   └─ T1 (scaffold)
        ├─ T2 normalize ─┐
        ├─ T3 models ────┼─────────────┐
        │                └─ T4 matcher  │   (T4 needs T2)
        │                               ├─ T5 table SQL      (needs T3)
        │                               ├─ T6 source         (needs T3, T1/config)  ┐
        │                               ├─ T7 classify       (needs T3, T1/config)  ├ parallel
        │                               └─ T8 extract_fields (needs T3, T1/config)  ┘
        └─ T9 pipeline   (needs T4, T3, T6, T7, T8)
             ├─ T10 seed_applications (needs T5 table live)
             └─ T11 dashboard page    (needs T5 table live; T10 for screenshot)
```

Parallel sets: **{T2, T3}** after T1; **{T5, T6, T7, T8}** after T3; **{T10, T11}**
after the table is live. T4 waits on T2; T9 waits on T4/T6/T7/T8.

---

## T0 — Recon & confirm (report only, change nothing)

- [ ] **Domain:** data-engineering
- **Context:** `dashboard/api/extract.js` (job row shape), `dashboard/src/App.jsx`
  + `main.jsx` (routerless single component), `dashboard/src/supabase.js` (browser
  read path), repo root layout.
- **Do:** confirm against the live repo and report deltas — (1) `job` columns the
  matcher reads (`company`, `title`) exist as named; (2) the pipeline-side Gmail
  runtime-auth path (google-api-python-client + OAuth2 desktop, local token) is
  viable in this environment; (3) dashboard reads `job` via the anon browser
  client; (4) where `email_parser/` lands. **No code.** Stop for review.
- **Acceptance:** all four answered against the real repo; any mismatch with the
  spec surfaced before scaffolding.
- **Deps:** none.

## T1 — Scaffold package, deps, gitignore, config

- [ ] **Domain:** data-engineering
- **Context:** new `email_parser/` (underscore), `pyproject.toml`, `.gitignore`.
- **Do:** create `email_parser/__init__.py` + `email_parser/config.py` (constants:
  `MODEL_CLASSIFIER='claude-haiku-4-5'`, `MODEL_EXTRACTOR='claude-sonnet-4-6'`,
  `GMAIL_QUERY='label:job-search'`, `GMAIL_CREDENTIALS_FILE`, `GMAIL_TOKEN_FILE`).
  `uv add google-api-python-client>=2.149.0 google-auth-oauthlib>=1.2.1`. Add
  `email_parser/.gmail_token.json`, `email_parser/.gmail_credentials.json`,
  `*.gmail_token.json` to `.gitignore`.
- **Acceptance:** `uv sync` green; the two new deps resolve; `import email_parser.config`
  works; token/creds globs are gitignored (`git check-ignore` passes). Module has
  the top docstring (what it does / does NOT do).
- **Deps:** T0.

## T2 — `normalize.py` (pure, NULL-safe)

- [ ] **Domain:** data-engineering
- **Context:** `email_parser/normalize.py`, `tests/test_email_normalize.py`.
- **Do:** `normalize(s: str | None) -> str` — `None`/`""` → `""` (never throws);
  else lowercase, strip, collapse internal whitespace. Pure, no I/O. Top docstring.
- **Acceptance:** unit tests for None → "", "" → "", "  Acme  Corp " → "acme corp",
  case-fold; run in a fresh process (determinism, per AGENTS.md).
- **Deps:** T1. **Parallel with T3.**

## T3 — `models.py` (Pydantic v2)

- [ ] **Domain:** data-engineering
- **Context:** `email_parser/models.py`, `tests/test_email_models.py`.
- **Do:** `RawEmail`, `Category` enum, `KeyDateType` enum (off-value → `other`),
  `KeyDate`, `ExtractedFields` (defaults: `key_dates=[]`, `action_required=False`),
  `Application`, `RunReport` (fetched/skipped/inserted/linked/unlinked/errors).
  Per spec §3.
- **Acceptance:** validation tests — enum bounds, `KeyDateType` off-value coerces
  to `other`, defaults applied, `key_dates` typed shape round-trips.
- **Deps:** T1. **Parallel with T2.**

## T4 — `matcher.py` (pure, fully enumerated)

- [ ] **Domain:** data-engineering
- **Context:** `email_parser/matcher.py`, `tests/test_matcher.py`,
  `tests/fixtures/jobs_snapshot.json`.
- **Do:** `match(record, jobs) -> str | None` exactly per spec §2 (empty company_raw
  → None; company candidates; 0 → None; 1 → id; ≥2 → role-token tiebreak; null title
  never survives). **Notebook-check first** (build-loop step 2), then move in with
  tests. Create `jobs_snapshot.json` (≥2 same-company, ≥1 null-company, ≥1 null-title).
- **Acceptance:** the 8 matcher BDD scenarios — *unambiguous single match links*,
  *no candidate stays unlinked*, *empty company_raw stays unlinked*, *two roles
  resolved by role token*, *no role text stays unlinked*, *non-overlapping role
  stays unlinked*, *null title never wins*, *never raises on null fields*. Fresh
  process.
- **Deps:** T2 (normalize), T3 (ExtractedFields shape). **Blocks T9.**

## T5 — `application` table SQL migration (prepare; human runs)

- [ ] **Domain:** data-engineering
- **Context:** spec §4 SQL block.
- **Do:** prepare the migration text verbatim from spec §4 (bigserial id,
  `gmail_message_id TEXT NOT NULL UNIQUE`, `job_id TEXT references job(id)`,
  `key_dates jsonb`, RLS enabled + public-read select policy, no write policy).
  A person runs it in the Supabase SQL editor (no local DDL creds). Report the
  exact SQL for review; do not attempt to run it.
- **Acceptance:** SQL matches spec §4; RLS public-read only; `job_id` is TEXT FK;
  `gmail_message_id` UNIQUE. Confirmed applied by the person before T9's live run /
  T10 / T11.
- **Deps:** T3 (column shape). **Parallel with T6/T7/T8.**

## T6 — `source.py` (EmailSource + FixtureSource + GmailSource)

- [ ] **Domain:** data-engineering
- **Context:** `email_parser/source.py`, `tests/test_source.py`,
  `tests/fixtures/emails/*.json`.
- **Do:** `EmailSource.fetch() -> list[RawEmail]`; `FixtureSource` (reads fixtures);
  `GmailSource` (OAuth2 desktop, local token; **paginate nextPageToken**; body =
  text/plain → stdlib `html.parser` stripped text/html → ""; `GmailAuthError` on
  expired token; `received_at` = internalDate UTC-aware). Fetch query = `config.GMAIL_QUERY`.
  Build fixtures incl. one per category + edges (empty company, multi-role company,
  agency-recruiter, **HTML-only body**).
- **Acceptance:** BDD *only labelled mail is ingested* (query constant asserted),
  *HTML-only email still yields a body*, *label with more than one page is fully
  ingested* (mock two-page list), *expired Gmail token aborts before any write*.
  Gmail API mocked — no live call.
- **Deps:** T3, T1 (config). **Parallel with T5/T7/T8.**

## T7 — `classify.py` (Haiku classifier)

- [ ] **Domain:** llm-engineering
- **Context:** `email_parser/classify.py`, `tests/test_classify.py`.
- **Do:** `classify(email, *, api_key, client=None) -> Category`. Model
  `claude-haiku-4-5`, temp 0, forced tool `classify` (enum input). Off-enum →
  coerce `other` (defensive). `client` injectable for mocking.
- **Acceptance:** BDD *classification assigns one of five categories*, *off-enum
  classifier output coerces to other*. LLM **mocked** to the forced-tool contract —
  a real call is a test bug (AGENTS.md).
- **Deps:** T3, T1 (config). **Parallel with T5/T6/T8.**

## T8 — `extract_fields.py` (Sonnet extractor)

- [ ] **Domain:** llm-engineering
- **Context:** `email_parser/extract_fields.py`, `tests/test_extract_fields.py`.
- **Do:** `extract(email, category, *, api_key, client=None) -> ExtractedFields`.
  Model `claude-sonnet-4-6`, temp 0, forced tool `extract` (schema = ExtractedFields).
  Category conditions the prompt. Raw strings, no canonicalization; missing →
  null/[]/false. **Notebook-check on a real email first**, then move in mocked.
- **Acceptance:** BDD *extractor keeps raw strings and flags low confidence*
  (verbatim company_raw/role_raw; `extraction_confidence` never blocks the write).
  LLM mocked.
- **Deps:** T3, T1 (config). **Parallel with T5/T6/T7.**

## T9 — `pipeline.py` (wire it)

- [ ] **Domain:** data-engineering
- **Context:** `email_parser/pipeline.py`, `tests/test_pipeline.py`.
- **Do:** `run(source, supabase, jobs, *, api_key) -> RunReport` per spec §8 —
  pre-filter existing `gmail_message_id`; per email classify → extract → match →
  insert; idempotent skip; **SQLSTATE 23505 → skipped**, other write error →
  `RunReport.errors` + continue (no whole-run abort); writes target `application`
  only. Thin `load_jobs(supabase)` helper (matcher stays pure).
- **Acceptance:** BDD *pipeline is idempotent on re-run*, *unique-violation on
  insert is a tolerated skip*, *a non-unique write error does not abort the batch*,
  *a bad row never lands in the job table*, *expired Gmail token aborts before any
  write*. Supabase + LLM **mocked**; assert RunReport counts.
- **Deps:** T4, T3, T6, T7, T8.

## T10 — `scripts/seed_applications.py` (dashboard fixture)

- [ ] **Domain:** data-engineering
- **Context:** `scripts/seed_applications.py`.
- **Do:** insert 2–3 throwaway `application` rows via the **service-role** key
  (one linked via `job_id`, one unlinked, one `action_required`), for the dashboard
  screenshot; provide a matching delete/cleanup. Not a pytest test. Preview shares
  prod Supabase — throwaway rows only, clean up after (AGENTS.md).
- **Acceptance:** running it inserts the rows; cleanup removes them; no `job` row
  touched.
- **Deps:** T5 (table live). **Parallel with T11 build; T11 screenshot uses it.**

## T11 — Applications dashboard page + view-toggle

- [ ] **Domain:** frontend (non-ML; repo React idioms)
- **Context:** `dashboard/src/ApplicationsPage.jsx`, `dashboard/src/App.jsx`
  (the one sanctioned edit), `dashboard/src/supabase.js`.
- **Do:** `ApplicationsPage.jsx` — read-only over `application` via the anon browser
  client (columns: company_raw, role_raw, category, received_at, action_required
  badge, low-confidence flag, linked `job` when `job_id` set). Add a `view` toggle
  (`useState('jobs')`, Jobs | Applications nav) in `App.jsx` — additive, no router,
  no new dep, no restructure of the jobs view. Empty state on unconfigured / query
  error / empty result.
- **Acceptance:** BDD *dashboard page is read-only over applications*,
  *applications view shows an empty state when there are no rows*. `cd dashboard &&
  npm run build` green; headless screenshot both empty and populated (T10 rows).
- **Deps:** T5 (table live), T10 (populated screenshot).

---

## Notes

- **LLM tasks (T7, T8) never make live calls in tests** — inject a mock client
  (AGENTS.md). Notebook-checks (T4, T8) may use real inputs/creds but are not
  shipped code.
- **T5 is a human gate:** the table must be created (and confirmed) before T9's
  live run, T10, and T11 can touch real data. Unit tests for T6–T9 mock Supabase,
  so they don't wait on T5.
- **Commit discipline:** one task = one commit, only when asked; do not bundle.
- **Next:** `/sigma:implement-task T1` (or `T2`) · or `/sigma:loop` for autonomous
  test-first execution over the ordered list.
