# job-pipeline — Architecture Map

## Purpose
"See what AI employers want." Drop in ~20 real AI-Engineer **job-description screenshots**, a vision model extracts structured skills, deterministic Python reconciles the messy skill names ("React" = "ReactJS" = "React.js"), and a React dashboard ranks skills by **document frequency** — how many jobs ask for each. Optional résumé upload matches your skills against every job. Built solo in a one-day hackathon; live at `job-pipeline-opal.vercel.app`.

## The core idea (where AI ends and code begins)
- **AI = the messy step**: reads each screenshot on its own; smart but *not* repeatable run-to-run, *not* consistent across the set.
- **Code = the consistent step**: deterministic normalization + counting. Same input → same output every run.
- This split is the whole design thesis (README "Where's the AI vs. the plain code?", and `DECISIONS.md`).

## Two-phase offline pipeline (Python)
```
scratch/screenshots/*.png
   │  extract.py   (vision model, structured tool-call output, per-image)
   ▼
data/extracted.json          raw per-job skills (raw_text + model's canonical GUESS)
   │  normalize.py  (deterministic: split slash-lists → case-fold → alias map)
   ▼
dashboard/public/jobs.json   normalized dataset + "merged from" variants
dashboard/public/canonical_map.json  +  dashboard/api/canonicalMap.js  (map for the live path)
   │  seed.py  (one-off)
   ▼
Supabase  (job + skill tables)  ← the dashboard's live source of truth
```

- **`extract.py`** — loops screenshots, calls Claude Sonnet (`extract_anthropic`) or OpenAI (`extract_openai`); provider chosen by the `PROVIDER` constant. Pydantic `JobExtraction` schema is the extraction target. Writes `data/extracted.json`. The model's `canonical` field is *only a hint*.
- **`normalize.py`** — the load-bearing deterministic step. Three ordered passes: `SPLITS` (only `gcp/aws/azure`, `n8n/make/zapier`, `bigquery/snowflake` split; `CI/CD`, `A/B Testing` stay intact) → case-fold (display spelling = most common seen) → conservative hand-written `ALIASES` map. Emits `jobs.json`, plus `canonical_map.json` and `api/canonicalMap.js` so the *live* upload path normalizes a new job the exact same way. Prints the ranked chart for eyeball verification.
- **`seed.py`** — one-off load of `jobs.json` into Supabase; guards against double-seeding. Seed rows get `source: "corpus"`; live drop-ins get `source: "screenshot"`.
- **`test_key.py`** — API-key smoke test.

## Frontend (Vite + React 19, `dashboard/`)
- **`src/App.jsx`** — the entire dashboard in one component (~840 lines). On mount, reads jobs+skills from **Supabase** (`.from('job').select('*, skill(*)')`) and the `skill_variants` reveal-map from static `/jobs.json`; falls back to static `jobs.json` if Supabase is unreachable.
  - `derived` (useMemo): computes stats, document-frequency `chart` (distinct jobs per canonical, scoped to selected seniority, required-only + ≥2 by default).
  - `matchJob` / `resumeMatch` / `MatchChips`: résumé-vs-job scoring (share of a job's *required* skills the candidate has).
  - `JobRow`: expandable job card with reveal/flash on duplicate-upload.
  - Chart is **hand-rolled CSS bars** — no chart library.
- **`src/supabase.js`** — browser client (anon key, read-only via RLS). Ships a `stubClient` so missing `VITE_*` env vars fall back to static `jobs.json` instead of white-screening (see DECISIONS 2026-07-03).

## Live drop-in (Vercel serverless + Daytona)
Serverless functions in `dashboard/api/` (Node handlers). Uploads run extraction **inside an ephemeral Daytona sandbox** (stdlib `urllib`, no pip) so no model SDK ships in the function bundle. All DB writes use the Supabase **service-role** key server-side.
- **`api/extract.js`** — POST base64 screenshot → sha256 dedup pre-check → Daytona parse → `normalizeSkills` (same map) → persist to Supabase → `{ job }`. 409 on duplicate hash.
- **`api/resume.js`** — POST base64 PDF (document block) → parse skills → normalize → `addInferredLLMs` (adds "LLMs" when strong LLM-signal skills present) → persist to `cv` table → `{ profile }`. Client does the matching.
- **`api/job.js`** — DELETE a job + its skills.
- **`api/cv.js`** — PATCH (rename) / DELETE saved résumés.

## Data model
`job` (id, company, title, seniority, seniority_signal, seniority_basis, summary, source, created_at, screenshot_hash) ⟶ `skill` (job_id FK, raw_text, canonical, requirement). `cv` (id, name, skills, raw_profile). Same `job` shape flows through every layer: extraction → jobs.json → Supabase → React.

## Conventions
- Provider-agnostic extraction; the *deterministic* layer owns canonicalization — never the prompt (DECISIONS "normalize-in-code").
- Serverless writes use the service-role key; the browser is read-only (RLS). Never write from the client.
- Best-effort persistence: Supabase/DB failures degrade gracefully, the user still gets their result.
- `DECISIONS.md` is kept current silently (see `AGENTS.md`); verification is by running on real inputs, not reading code line-by-line.
- No test suite this sprint; if a test is written, the LLM call must be mocked, never live.

## Where a newcomer should start
1. `README.md` — the pitch + the pipeline diagram.
2. `extract.py` (`SYSTEM_PROMPT`, `JobExtraction`) → `normalize.py` (`SPLITS`, `ALIASES`, `main`) — the offline heart.
3. `dashboard/src/App.jsx` — the `load()` effect and the `derived` useMemo for the chart.
4. `dashboard/api/extract.js` — how the live path reuses the exact normalization.
5. `DECISIONS.md` + `jd-aggregator-sprint-plan.md` — why the calls were made and the data contract.
