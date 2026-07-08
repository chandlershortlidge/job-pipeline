# Decisions Log

A plain-English record of the meaningful calls we've made on this project: what we
decided, why, what we tried, and what **didn't** work. The point is so that a future
person — or a future AI agent — can read this and avoid re-treading dead ends or
undoing a decision without knowing the reason behind it.

**How to use this file**
- Newest entries first.
- Each entry: date + time, a short plain-English note, and (where relevant) the
  trade-off or the thing we tried that failed.
- Times are when the decision was committed to git (so they're accurate, not guessed).
- If you're an agent picking this project up: read this before changing extraction,
  normalization, or the deploy setup. Several things here were already tried.

---

## 2026-07-08 — 2026-07-07 "regressions" investigated: one real bug (fixed), one known scope limit, one not reproducible

Three core features reported broken on the live site on 07-07. Investigated read-only against
prod (Supabase REST via anon key, deployed function probes, deployed-bundle grep). Baseline
finding: **the last two 07-07 commits (the normalizeSkills DRY refactor + its tests) were never
pushed** — the deployed site runs pre-refactor code, so the refactor is ruled out as a cause.

1. **"New" badge missing after a drop-in — real bug, now fixed.** `api/extract.js` never
   returned `created_at`, and `isNewJob()` keys off it — so a freshly uploaded job showed no
   New badge until a reload (the reload reads Supabase, which has the column default). Fix:
   stamp `created_at` server-side so it's both persisted and returned. Locked by new handler
   tests (`api/extract.test.js`, Daytona mocked): fresh ISO timestamp, `live-` id,
   `screenshot_hash` stripped, skills normalized. **Committed but not yet pushed/deployed.**

2. **Duplicate not caught (ClickHouse uploaded twice) — v1 scope limit, not a code bug.** The
   first ClickHouse upload (07-07 08:10 UTC) landed *before* the dedup deploy went live — its
   row has a **null** `screenshot_hash`, so the 12:24 UTC re-upload had nothing to match and
   sailed through (the 12:24 row *did* get a hash, so a third upload would 409). This is the
   documented v1 limitation: hash-less legacy rows are invisible to dedup. Both ClickHouse
   rows are still in prod (`live-1783411808718` hashless, `live-1783427074891` hashed) —
   deleting one is a manual call, not done here.

3. **CV uploader — could not reproduce; deployed path verified healthy today.** Full
   end-to-end test against prod with a throwaway synthetic PDF: `POST /api/resume` → HTTP 200
   in ~7s, correct profile (incl. the inferred-LLMs rule), persisted as cv id 12, then deleted
   via `/api/cv` (only the 2 original CVs remain). Frontend wiring (`handleResume`) reads
   correct. Whatever failed on 07-07 was transient (Daytona/Anthropic hiccup?) or a symptom
   not yet described — if it recurs, capture the exact on-screen error and check the Vercel
   function logs before touching code.

---

## 2026-07-07 — normalize.py made genuinely deterministic (+ pure-function refactor)

**Refactor:** Split the normalization logic out of `normalize.main()` into pure, testable
functions (`build_display`, `resolve`, `clean_variants`, `normalize_jobs`, `build_canon_map`)
per AGENTS.md's layout rule; `main()` is now a thin read→normalize→write wrapper.
Behavior-preserving, guarded by a golden characterization test.

**Bug the golden test caught:** `normalize.py`'s docstring claimed "same input, same output,
every run" — but it wasn't true. `clean_variants` sorted the "merged from" variants by
length only; for two variants of equal length and same lowercase (e.g. `"Tool Use"` vs
`"tool use"`), which spelling survived depended on Python's per-process **set-iteration order**
(hash-randomized), so `jobs.json`'s `skill_variants` varied run to run. It only looked stable
because the tie is rare — the golden test failed in a fresh pytest process while the CLI runs
happened to agree.

**Fix:** deterministic tiebreak — `sorted(raws, key=lambda r: (len(r), r))` instead of
`key=len`. Equal-length variants now break alphabetically. Output is unchanged vs the committed
`jobs.json` (which already had the alphabetically-winning spelling) — the fix just guarantees it
every run. Locked by unit tests + a golden fixture; verified green across repeated fresh processes.

---

## 2026-07-07 — Delete job listings

**Feature:** Delete a job from the dashboard. In the expanded job row, a red-outlined
**Delete** button reveals a two-step inline confirm ("Delete this job? Delete / Cancel") —
deliberately gated behind expand + confirm since it's a permanent Supabase delete.

**How:** New server route `api/job.js` (`DELETE ?id=`, service-role key — browser has
read-only RLS) deletes the `skill` rows (FK `job_id`) then the `job` row. Front-end
`deleteJob()` is optimistic: drops it from `data.jobs` immediately, rolls back + shows an
error line if the request fails, and clears any dangling reference (upload card / dup
banner) to the deleted id. Same pattern as the saved-résumé delete.

**Verified:** `vite build` green; the exact delete ops (insert job+skills → delete skills →
delete job → no orphans) run against the real schema via a throwaway row; screenshotted
both the button and the confirm state (only clicked the first Delete, no real deletion).

## 2026-07-07 — Duplicate-screenshot detection by file hash (v1)

**Feature:** Block re-uploading the same JD screenshot. `api/extract.js` computes a
SHA-256 of the screenshot bytes **before** the Daytona parse and looks it up in
`job.screenshot_hash`; an exact match returns HTTP 409 with the existing job's
`{id, company, title}` and **no sandbox is created** (no wasted parse). No match →
parse, then persist the job with its hash. The dashboard shows a **persistent amber
banner** under the upload button — "⚠ Already added — {company · title}" (fallback "a job
already in your list" when both null) — that stays until dismissed or the next upload.
It does **not** auto-scroll; only clicking the banner's link expands + scrolls to +
pulses the existing row.

**Storage:** No interim store needed — persistence already shipped. Added `screenshot_hash
text` to the `job` table with a **UNIQUE** index (`job_screenshot_hash_key`) to close the
pre-check→insert race; the loser of a race re-queries and also returns 409. Nullable +
Postgres NULL-distinct, so the 22 hash-less legacy rows don't collide. Migration run by
hand in the Supabase SQL editor (no POSTGRES_URL locally for DDL).

**Scope (v1):** exact file hash only. A different screenshot of the same posting (different
crop/scroll/compression) has a different hash and is NOT caught — no fuzzy
company/title/seniority matching. Legacy rows have null hashes so only post-ship uploads
are deduped.

**Verified:** `vite build` green; SHA-256 determinism unit-tested. Full upload→409→reveal
needs the live Daytona parse — tested on the preview after the migration.

## 2026-07-06 — Per-row résumé compare (reveal on expand)

**Feature (additive):** Expanding **any** job row now shows how the selected résumé
compares to that job ("Your résumé — N%" + have/missing chips) at the top of the detail,
above the existing summary/skill list. No upload needed; works on every job in the list.
Chosen affordance: reveal-on-expand (no per-row button clutter, reuses the existing click).

**How:** Extracted the have/missing chips into a shared `<MatchChips>` component used by
both the post-upload card and the row; hoisted the résumé skill-set to one `resumeSet`
passed into each `JobRow`, which runs the existing `matchJob()`. Upload card behavior
unchanged. Only shows when a résumé is loaded.

**Verified:** `vite build` green; drove the real app headless — expanded a row with the
auto-loaded saved résumé and captured the match (14%, Python matched, rest missing).

## 2026-07-06 — Instant résumé-vs-uploaded-job comparison

**Feature:** After a JD screenshot drop-in, an inline comparison card appears at the top
("Your résumé vs {company} — {N}%") with green "have" chips and dashed "missing" chips
for the job's REQUIRED skills, so you see your fit immediately. Dismissible; if no résumé
is loaded it prompts to upload one.

**How:** Extracted the per-job match math (required skills the résumé has vs lacks + a
coverage %) into a reusable `matchJob(job, resumeSet)` helper and DRY'd the existing
résumé-ranking `useMemo` to use it. `handleUpload` stashes the parsed job in
`lastUploadedJob`; the card reuses the same `.chip.have/.miss` styles as the résumé
section. Purely client-side — no new API surface.

**Verified:** `vite build` green; unit-tested `matchJob` (75% on 3/4 required, nice-to-have
excluded, empty-required → no chips); card visual rendered with the real CSS. The full
upload→card flow (live Daytona parse) is best confirmed on a preview.

---

## 2026-07-06 — Jobs list: "New" (last 7 days) + progressive disclosure

**Feature:** Renamed the meaningless **Live** badge (it keyed off an `id` prefix) to
**New**, defined as `created_at` within the last 7 days. The Jobs list now shows **only
New jobs by default**; a "Show all N jobs" / header chevron reveals the rest, paginated
`JOBS_PAGE = 20` at a time ("See more" appears only when there are >20 *older* jobs — New
jobs are pinned on top and excluded from pagination so recent adds never get buried).
Header gained a subtle "N new" hint. Replaces the earlier full-collapse behavior.

**Data change (applied, not code):** the 20 seeded `job-*` rows all had `created_at` ≈
2026-07-01 (when `seed.py` ran) — a load-time artifact, not a posting date — so *every*
job counted as "New" and the feature was degenerate. Per approval, backdated each seed
row by −20 days (→ 2026-06-11) via service-role PATCH, **preserving relative order**.
Now only the two real drop-ins (eduBITES, Enpal) are New. Live drop-ins keep their real
`created_at`. If the corpus is ever re-seeded, seed.py will re-stamp today's date — either
re-run this backdate or set a sensible `created_at` in the seed itself.

**Verified:** `vite build` green; headless-Chrome screenshots of both states against real
data (default = 2 New + "Show all 22 jobs"; expanded = 22 with New pinned + "Show less").

---

## 2026-07-04 — Saved résumés: rename + delete, and name-by-filename

**Feature:** The saved-résumé chips can now be **renamed** (✎ → inline input, Enter/blur
saves, Esc cancels) and **deleted** (×). New uploads are named after the **uploaded file**
(extension stripped) instead of the old `title — date`.

**How:** The browser has read-only RLS on `cv`, so writes go through a new server route
`dashboard/api/cv.js` (`PATCH {id,name}` rename, `DELETE ?id=` remove) using the
service-role key — same "writes are server-side only" pattern as extract.js/resume.js.
`resume.js` now takes the filename from the client and derives the name. Front-end
rename/delete are optimistic with rollback; deleting the active résumé falls back to the
next saved one. Existing rows keep their old names (only new uploads use the filename).

**Verified:** `vite build` green; the exact DB ops (insert → update name → delete) run
against the real `cv` table via a throwaway row (id integer, not UUID). Tested on a
Vercel **preview** deploy before prod.

**Gotcha (important):** `vercel env add <NAME> <env>` non-interactively stores an **empty
value** in this environment — both piped (`printf | ...`) and file-redirect (`... < f`)
forms report "✓ Added" but the value is `""`. This bit us on the VITE_ vars too
(2026-07-03). Reliable paths: the Vercel **dashboard**, or the **REST API**
(`POST /v10/projects/{id}/env?teamId=...` with `{key,value,type:'encrypted',target:[...]}`
using the token in `~/Library/Application Support/com.vercel.cli/auth.json`). **Always
verify with `vercel env pull` afterward.** Preview env needed `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` added (they were Production-only).

---

## 2026-07-03 13:12 — Deployed frontend was blank: missing VITE_ env vars on Vercel

**Symptom:** Live site (`job-pipeline-opal.vercel.app`) served HTTP 200 but rendered a
blank page. This is the Part 1.5 "pending deployed verify" resolving.

**Root cause:** The Supabase integration on Vercel auto-added a pile of env vars
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_SUPABASE_*`) — but the dashboard
is a **Vite** app, and Vite only exposes vars prefixed with `VITE_` to the browser.
`dashboard/src/supabase.js` reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, neither
of which existed. So `createClient(undefined, undefined)` threw at module load, before
React rendered → white screen. Confirmed by grepping the built bundle: no `supabase.co`
URL was in it.

**Fix:** Added `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Production) with the
values from local `dashboard/.env`, then **redeployed** (Vite inlines env at *build*
time, so setting them without a rebuild does nothing). Verified end-to-end: new bundle
contains the URL + publishable key, Supabase REST returns HTTP 200, and `content-range:
0-19/20` confirms all 20 seeded jobs reach the anon browser client.

**Gotchas for future-you:**
- Adding env vars requires a **redeploy** to take effect for Vite/Vercel.
- `npx vercel env add NAME production` fed from a pipe **silently stored empty values**
  (reported "✓ Added" but the value was `""`). Setting these via the Vercel **dashboard**
  UI is the reliable path; if scripting, verify with `vercel env pull` afterward.
- The local anon key is the new short `sb_publishable_…` format, not the long legacy JWT
  that the integration stored under `SUPABASE_ANON_KEY` — both are valid for the project.
- Same Supabase project either way (host `mnfqhklvzeorvwjwrzro`), so the seeded data was
  never in doubt — only the frontend's ability to reach it.
- **Latent risk:** `supabase.js` calls `createClient` with no guard, so a missing env var
  white-screens the whole app instead of falling back to `jobs.json`. Worth a guard.

---

## 2026-07-02 08:10 — Part 1.5 (Supabase persistence) code-complete; PENDING deployed verify

**⏸ Resume point.** All 6 Part 1.5 steps are built, committed, and pushed (schema + RLS, `seed.py`,
React reads jobs from Supabase, persist JD drop-in in `extract.js`, persist résumé in `resume.js`,
CV toggle in `App.jsx`). Each verified **locally**: read path via the publishable key, write path via
the secret key, `npm run build` green. Local dev reads from Supabase; the **deployed** site is still
on the `jobs.json` fallback because the Vercel env vars aren't set yet.

**To finish (do this on return):**
1. Add 4 env vars in Vercel (all environments): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. (`VITE_` = build-time; the others = function runtime.)
2. Redeploy (env vars only take effect on a new deploy).
3. Verify the deployed loop: (a) dashboard reads jobs from Supabase (bundle contains the Supabase URL),
   (b) a live drop-in job survives a hard refresh, (c) a résumé saves and the toggle switches between
   saved CVs.

Nothing else is half-done; safe to pause here.

---

## 2026-07-01 15:09 — Supabase (Postgres) chosen as the persistent store

Adding persistence under the two live features (JD drop-in, résumé match) — results currently live
in React state and die on refresh. **Supabase (Postgres)** chosen to hold jobs, skills, résumé
profiles, and (future) applications.

**Over the alternatives:**
- **Vercel KV** — key-value, wrong data model (ours is relational).
- **Turso** — weaker Python client story for the extraction side.
- **SQLite** — Vercel's filesystem is ephemeral; serverless functions can't persist writes to it.

Both `supabase-py` (Python) and `@supabase/supabase-js` (React) are first-class. The existing
`job`/`skill`/`application` schema drops into Postgres unchanged; part 2's email parser writes
`application` rows joined on `job_id` — one query gives the full picture. **No new host** — Supabase
is called from the existing Vercel functions and the React app. The Daytona extraction pipeline is
**unchanged**; only a write-to-Supabase call is appended after the sandbox returns.

---

## 2026-06-26 15:27 — Daytona disk-limit leak fixed (sandboxes now ephemeral)

**Symptom:** live uploads started failing with "Total disk limit exceeded. Maximum allowed: 30GiB."
mid-event.

**Cleared the backlog:** 10 leaked sandboxes deleted via `daytona.list()` + `daytona.delete()`.
(Gotcha: `list()` is an **async iterable** — must use `for await (const s of daytona.list())`, not
a plain for-of; it looks like an empty object otherwise.)

**Root cause:** Daytona's `autoDeleteInterval` **defaults to disabled**, and `autoStopInterval`
defaults to 15 min. Our functions delete the sandbox in a `finally`, but any invocation that didn't
reach it (Vercel timeout, error, or overlapping requests during the demo) left a stopped-but-not-
deleted sandbox holding disk → they piled up to the 30 GiB cap.

**Fix:** create sandboxes with `{ ephemeral: true, autoStopInterval: 2 }` in both `extract.js` and
`resume.js` — a leaked sandbox auto-stops after 2 min idle and then auto-deletes itself. Explicit
`delete()` kept for the fast happy path. Lesson: with on-demand sandboxes, never rely on explicit
cleanup alone — set an auto-delete TTL as the safety net.

---

## 2026-06-26 14:06 — Resume-match stretch: backend built & proven (Steps 1–2)

New additive stretch: upload your own resume (PDF) → see which jobs you match, ranked, with
matched/missing skills. Plan in `resume-match-plan.md`. Gated like the JD drop-in — the
deployed product never depends on it.

**Input = PDF (verified the right call).** The Messages API reads PDFs **natively** via a
`document` content block (no PDF-parsing code, no beta header; 32MB/600-page limits, our
sonnet-4-6 is 1M-context). Earlier I'd rated PDF "high risk" assuming a parsing step — that
assumption was wrong; PDF is nearly identical effort to the proven image path.

**De-risked on a real CV (Step 1, `scratch/resume_probe.mjs`):** PDF base64 (~109KB) embeds
into the Daytona sandbox code string fine; the `document` block works through the sandbox's
stdlib-urllib call; resume prompt returns sane technical skills, no soft-skill noise.

**Backend built & proven (Step 2, `dashboard/api/resume.js`):** SEPARATE file from
`extract.js` so the working drop-in can't regress. Reuses `canonicalMap.js` + the same
normalize logic. Run locally through the real handler on the CV → HTTP 200 + normalized
profile whose canonicals (RAG, AWS, Evaluation, APIs, Vector Databases) match the job
vocabulary. Simulated match: 13 of ~25 resume skills hit a REQUIRED job skill.

**Contract:** `POST /api/resume {pdf, media_type}` → `{profile:{title,
years_experience, skills:[{canonical, raw_text}]}}`. (Route is `/api/resume` — Vercel routes
by filename; the plan's earlier `/api/match-resume` name was wrong.) Match runs client-side
against jobs.json.

**Decisions:** score = % of a job's REQUIRED skills the candidate has (extra skills never
hurt the score); resume skills matching no job shown as an honest "extra skills" line.

**Step 3 done — deployed path verified:** deployed `POST /api/resume` → HTTP 200 + profile
(~11s). Same pass confirmed the existing `POST /api/extract` is also healthy deployed
(Netconomy job, 200, ~17s) — resolves the prior "ANTHROPIC_API_KEY deployed path untested"
note from the 12:37 entry.

**Step 4 done — front-end built & match logic verified:** PDF upload section + client-side
ranking (score = matched/required, top 6) + matched/missing chips + "extra skills" line, all
appended below the existing dashboard (touches nothing above). Match logic verified on real
data: top match "AI Application Engineer" 75%, ranking degrades sensibly, all 20 jobs ranked.

**"LLMs" inference — RESOLVED (deterministic code rule).** Problem: "LLMs" rarely appears
literally on a résumé even when the candidate clearly does LLM work, so it showed as *missing*
on ~19/20 jobs. Chose the **code rule over a prompt nudge** — the project's normalize-in-code
principle (09:26) distrusts prompt-based inference because it's nondeterministic; the same
"infer from other skills" goal done in code is consistent every run. `addInferredLLMs()` in
`resume.js`: if the résumé carries a strong LLM-signal skill (RAG, LangChain, LangGraph,
LangSmith, LlamaIndex, Prompt engineering, Fine-tuning, Tool calling, Agents, OpenAI API), add
"LLMs". Verified on the real CV: top match 75%→88%, "AI Engineer (LLM)" +25, all lifts sensible.

---

## 2026-06-26 13:04 — Live Daytona drop-in COMPLETE (UI + backend, verified in browser)

The full sponsor showcase works on the deployed URL: upload a screenshot → "Parsing in a Daytona
sandbox…" → the parsed job prepends to the list (green "live" badge) and the chart updates. Built
the upload control on top of the seniority-view `App.jsx` (base64 → `POST /api/extract` → prepend to
state → reactive re-derive). Verified end-to-end in the browser by the user.

**Project is feature-complete** by ~13:00 (well ahead of the 16:00 stretch window): corpus dashboard
+ seniority compare-by-level + live drop-in, all on one Vercel URL. Remaining time → rehearsal,
the 90-sec backup recording, and polish.

Also switched to **single-agent** ownership mid-afternoon after multi-agent collisions on `main`.

---

## 2026-06-26 12:37 — Daytona live drop-in backend built & proven

`dashboard/api/extract.js` now runs the **real extraction inside a Daytona sandbox** and is proven
end-to-end locally on a real screenshot (Netconomy → parsed job in ~15s).

**Key resolved open question:** the sandbox runs Python **stdlib `urllib`** to call the Anthropic API
directly — **no pip install**, so the sandbox needs nothing pre-baked and boots fast. (Confirmed the
sandbox has outbound internet.) Image base64 (~320 KB) embeds fine in the code string via
double-JSON-encoding.

**Live-job normalization:** the function applies the same map (`canonicalMap.js`, emitted by
`normalize.py`) + a parenthetical-strip + a few synonym aliases (RAG / Agents / Gen AI variants), so an
upload increments the *right* bars. Novel long-tail skills stay count-1 (hidden below the ≥2 threshold) —
acceptable; perfect normalization of an unseen job is the same unbounded problem.

**Contract:** `POST {image, media_type}` → `{job}` (jobs.json shape). Front-end builds the upload UI to this.

**REMAINING:** add **`ANTHROPIC_API_KEY` to Vercel env vars** for the *deployed* endpoint (DAYTONA_API_KEY
already set). Proven locally; deployed path untested until that key is added.

---

## 2026-06-26 12:20 — Seniority reworked: a chart "compare by level" view, not a job-list filter

**Decision:** Moved the seniority buttons from below the chart to **above it**, and changed what
they do. They're now a color-coded view selector — All (blue/global), Junior (green), Mid (amber),
Senior (red) — that **re-scopes the skills chart** to the selected level's jobs (recomputing
document frequency over just that subset) and recolors the bars to match. The job list below still
filters to the selected level too (that behavior was kept).

**Why:** The first version (a filter that only changed the job list) wasn't intuitive — the useful
question is "how do skill priorities differ by seniority," which is a *chart* comparison, not a
list filter. This makes the contrast visible: Junior → fundamentals (LLMs, Python, Vector DBs);
Senior → cloud/infra (AWS, GCP) climbs into the top.

**Threshold call:** Kept the existing required-only + freq≥2 chart filter for every level rather
than special-casing small subsets. Checked it against the real data first: at ≥2 the levels give
3 (Junior) / 16 (Mid) / 12 (Senior) bars — all non-empty and readable, so no special case needed.
Added an empty-state message as a guard for future data.

**Scope kept narrow:** stats bar stays global (corpus summary); only the chart + job list re-scope.

---

## 2026-06-26 11:56 — Seniority filter added to the job list

**Decision:** Added a Junior / Mid / Senior filter to the dashboard job list. Each button is a
toggle (click the active one, or "all", to clear). It reads `seniority` straight from the data —
no recompute — and the per-level counts shown on the buttons reflect the current skill filter.

**Scope note:** `frontend-spec.md` lists "faceted filtering by role/seniority" as *out of scope
for v0*. This was an explicit, post-v0 request, so it's a deliberate override of that cut, not
scope drift. Kept minimal and built on the existing toggle/clear/selection idiom — no redesign.

**How it composes:** skill filter narrows first, seniority narrows within that (both apply to the
shown jobs). Seniority filter only touches the job list; the skills chart is unchanged. Jobs with
a null `seniority` (allowed by the contract) simply don't match any level and drop out when a
level is selected.

---

## 2026-06-26 11:56 — Alias map extended to consolidate scattered skills

After eyeballing the real chart, extended the deterministic alias map (`normalize.py`):
- **Generative AI → LLMs** (domain call: gen AI in these AI-Engineer JDs = LLM-based).
- **Evaluation** — the model scattered it across `AI Evaluation`, `Model Evaluation`,
  `AI output evaluation`, `evaluation frameworks`, etc. → consolidated to "Evaluation"
  (now a real bar at 5 jobs, was invisible before).
- **Observability** — same scatter (`Monitoring`, `Model monitoring`, `AI observability`...)
  → "Observability" (4).
- **Fine-tuning** — `LLM fine-tuning` → "Fine-tuning".

Then, per review, also bucketed generic **APIs / Testing / Cloud / Data pipelines** (keeping
specific tools — FastAPI, A/B Testing, GCP/AWS/Azure, Airflow/Prefect/dbt — as their own bars).
APIs jumped to a top-7 bar (7). Principle held throughout: under-merge is safe, over-merge is the
error a judge catches — so only generic terms were bucketed, never distinct tools.

Note: extraction was re-run (new `data/extracted.json`, 09:11), so unrelated counts also shifted.

---

## 2026-06-25 08:02 — Demo script drafted (2-min pitch, degrades with the build)

**Artifact:** `demo-script.md` — a ~2-min live pitch with three beats (problem→question; chart +
"merged from" normalization reveal; live Daytona drop-in), plus a 20-sec elevator version, a
degraded-demo fallback, and delivery/safety tips.

**Key calls:**
- Lead the "proud moment" on the **normalization reveal** — show the tech, not polish.
- **Name-drop Daytona explicitly** in the climax (the live drop-in) for the sponsor prize.
- Structure the pitch to **degrade exactly as the build does** — drop the drop-in, then the
  click-through, then everything but chart + stats — so there's always a coherent demo.
- **End on the part-2 vision** (the shared-job-model join), not on a feature.

**Safety:** record a 90-sec backup screen capture at ~16:30 (after the freeze); have a fresh,
non-corpus screenshot ready for the live drop-in; URL open in a tab before presenting.

---

## 2026-06-25 07:58 — Make normalization visible ("merged from" reveal)

**Decision:** Added a hover tooltip on each skill bar showing **"merged from: \<raw variants\>"**
(the distinct `raw_text` values that mapped to that canonical skill), in `frontend-spec.md`.

**Why:** The front end showed the clean *output* but hid the *hard part* — extraction +
normalization. A judge seeing tidy bars might think "they just counted words." Surfacing the
raw→canonical merge turns the load-bearing technical work into something visible and rewardable.
Cheap to build (`raw_text` is already in the data); it's the front-end's "show the seams" moment,
the chart-level twin of the seniority-signal-on-hover. Hover = reveal; click stays = filter jobs.

---

## 2026-06-24 13:47 — Front-end layout locked: single-column stacked

**Decision:** The dashboard is one centered column — stats bar, skills bar chart (the hero),
job list — stacked vertically. Chosen over a two-column (chart | jobs) and a chart-hero/
click-to-reveal variant, because single-column needs the least layout fiddling, reads well on a
projector, and degrades gracefully (drop the list, the chart still stands).

**Interactions:** click a skill bar → job list filters to jobs wanting it; click a job row →
inline expand of its skills (required solid, nice-to-have outlined) + summary + seniority with
its signal on hover. Default chart view = required-only + freq ≥ 2; "show all" lifts both.

**Data contract call:** `jobs.json` is just the array of jobs (matching the extraction schema);
the frontend derives document-frequency, stats, and the skill→jobs index in memory (only ~20
jobs, so no second source of truth to keep in sync).

**Why:** Full spec in `frontend-spec.md`. Locking layout + data shape + visual style now means the
day is wiring, not designing — the place a solo builder most easily burns time.

---

## 2026-06-24 13:21 — Daytona backend round-trip is LIVE (de-risk Parts 2–3 passed)

**What worked:** The Vercel serverless function (`dashboard/api/extract.js`) is deployed and
live at `/api/extract`, returning `{"output":"hi from daytona\n","exitCode":0}`. This confirms,
on the real platform:
- Vercel **auto-detects `dashboard/api/`** for the Vite project — no `vercel.json` needed.
- `DAYTONA_API_KEY` is wired via **Vercel env vars** (Settings → Environment Variables).
- The function creates a Daytona sandbox, runs Python, and returns JSON.

**So:** the whole backend round-trip for the live drop-in is proven (browser → Vercel function →
Daytona sandbox → output). The sponsor showcase is no longer a risky unknown.

**Day-of work for the showcase** is now just: swap the trivial script for the real extraction
(vision call + schema) running in the sandbox, and accept an uploaded image in the request. The
two still-open questions (how the extraction deps get into the sandbox, how the model key reaches
code inside it) get answered when wiring that real extraction.

---

## 2026-06-24 11:55 — Daytona round-trip verified (de-risk Part 1 passed)

**What worked:** The Daytona hello-world round-trip runs green with a real key
(`scratch/daytona_hello.mjs`). Confirmed SDK shape for the build: package `@daytona/sdk`,
`new Daytona({ apiKey })`, `daytona.create({ language: 'python' })`,
`sandbox.process.codeRun('<code>')` → `response.result` (stdout) / `response.exitCode`,
`sandbox.delete()`. Create → run Python → read output → delete all work as drafted.

**So:** the riskiest piece of the sponsor showcase (Daytona wiring) is de-risked. Remaining
de-risk steps are Vercel-function plumbing (Parts 2–4), not Daytona itself.

**Still open (for Part 2+):** how the real extraction code + its Python deps get into the
sandbox, and how the model API key reaches code running inside the sandbox.

---

## 2026-06-24 10:35 — Committed to the Daytona live drop-in as the gated sponsor stretch

**Decision:** Pursue the live "drop in a screenshot → parse it in a Daytona sandbox" feature as
the Phase 4 stretch and the sponsor-prize play. Architecture: a **Vercel serverless function**
(`dashboard/api/extract.*`, same repo, no separate host) calls the Daytona SDK to run the Python
extraction in a sandbox; React updates statelessly (no database).

**Trade-off:** This deviates from the "no backend" rule — but only for this one feature, and it's
**gated behind the deployed static dashboard**, so the prize floor (live URL) is never at risk.

**Hard condition:** de-risk the round-trip during the week (`daytona-prep-checklist.md`) — prove a
hello-world Browser → Vercel function → Daytona sandbox → output round-trip. If that isn't working
by the end of prep, drop the showcase. Lighter fallback: run the offline batch extraction through a
sandbox for a weaker-but-genuine sponsor story.

**Why feasible solo:** the "backend" is just a Vercel function in the same repo (not a second host),
it's stateless (no DB), and the scary part (Daytona wiring) gets proven *before* the day, leaving
only a script-swap for the day itself.

---

## 2026-06-24 10:22 — Enrollment requirements pinned; MIT license added

**Context:** The event is open-format (no rules on when code is written, so all our prep is
fine). The only hard gates: a live URL at end of day, the repo open source, and the project
built at the event (can't bring a pre-built one).

**Decisions:**
- Added an **MIT license** so the public repo is formally open source (a named enrollment
  requirement). MIT chosen as the permissive hackathon default.
- Pinned the gates as a "Submission Requirements" checklist in the plan. The live-URL gate —
  the only thing required for *any* prize — is already solved cold via the deploy prep.
- **Sponsor is Daytona.** Using the sponsor stack is a *winning* edge, not a qualifying gate.
  How (and whether) to integrate it is evaluated separately — it trades against the
  no-backend architecture, so it's a real call, not a freebie.

---

## 2026-06-24 10:04 — Normalization contingency plan + primary fallback

**Decision:** Added a "Normalization — contingency plan" section to the sprint plan: the
likely failure modes (case dups, slash-lists, non-obvious synonyms, over-merging, one-vs-two
calls) and the move for each, plus an escalation ladder if the chart still looks like noise.

**Key calls:**
- **Primary fallback = a curated allowlist** of ~15–25 hand-picked canonical skills; chart
  only those, everything else stays in data/click-through. Reach for it early, not last —
  it turns open-ended reconciliation into a closed-set lookup.
- **No live LLM normalization** in the pipeline (reinforces the 09:26 entry). At most, use an
  LLM once to *propose* a map, then freeze it into code.
- **Hard time box at 14:15:** freeze whatever's "sane enough" and go build the chart; the
  15:00 deployed-chart milestone wins over a perfect map.

---

## 2026-06-24 10:00 — Keep DECISIONS.md; log silently and proactively

**Decision:** Reversed an earlier sprint call. `AGENTS.md` originally listed DECISIONS.md
as deliberately dropped for this sprint; we now keep a lightweight version. Added a
"Decision log" section to `AGENTS.md` defining when to add entries.

**The rule:** over-share rather than under-share (when in doubt, log it), but do it
**silently** — write the entry, fold it into the same commit as the change, and do **not**
narrate "I added to DECISIONS, here's why" in chat. Reading that mid-event wastes time;
the log is read when the person chooses, not in the reply.

**Why:** During the timed event there's no room to discuss record-keeping. Making it an
automatic, invisible habit means the context gets captured without costing live minutes.

---

## 2026-06-24 09:52 — Sprint day runs on a clock, planned backwards from the 5pm demo

**Decision:** Added a timed schedule to the sprint plan (see "Timeline (Day Of)"). Fixed
points are hack-start 11:00, lunch 12:00–13:00, demo 17:00 — so 5 hours of build time.
The schedule is built **backwards from the demo**, not forwards from the start.

**Key calls:**
- **Hard stop at 16:30** (30 min before demo): stop building entirely, redeploy from a
  clean `main`, and test the live URL in a fresh incognito window as a stranger would.
  Reasoning: a dead demo from a last-minute deploy is the worst-case outcome for a solo
  builder, and 30 minutes is cheap insurance against it.
- **Protect the 15:00 milestone:** a deployed ranked chart + sane skill counts. If behind
  at any point, cut panels upward from the bottom (3d → 3c → 3b), never the chart or the
  normalization under it.

**Trade-off:** The clock is deliberately conservative (a real 30-min freeze, a real lunch).
Better to ship fewer panels calmly than to be mid-edit when judging starts.

---

## 2026-06-24 09:26 — Skill normalization must be done in code after extraction, not by the prompt

**Decision:** Collapsing different spellings of the same skill into one name (e.g.
"Vector databases" and "Vector Databases" → one entry) will be done by a deterministic
**post-processing step in code**, run once over all the extracted skills together —
**not** by asking the LLM to do it in the extraction prompt.

**What we tried that failed:** We added a rule to the extraction prompt telling the
model to normalize case. We re-ran the probe. It did nothing — the same skill still
came out as two separate bars. (That prompt line has since been removed.)

**Why it can't work in the prompt:** Each screenshot is sent to the model on its own,
so the model never sees the other jobs. It has no way to be consistent across the whole
batch. Consistency across all jobs can only come from one piece of code that looks at
everything at once.

**Also found (same root cause):** When a job listed tools as a slash-list, the model
kept only the first and silently dropped the rest — "n8n/Make/Zapier" became just
"n8n", and "GCP/AWS/Azure" became just "GCP". It did this inconsistently between runs.
So the code step also needs to split slash-lists into separate skills before mapping.

**Status:** Plan updated (see "The Load-Bearing Risk" in `jd-aggregator-sprint-plan.md`).
The code step itself is **not built yet** — it's a sprint-day task. The model still
returns a `canonical` guess; treat it as a hint, not the truth.

---

## 2026-06-23 14:31 — Chart shows the signal, dataset keeps everything

**Decision:** The skills chart defaults to showing only skills that (a) appear in **2 or
more** jobs and (b) are marked **required** (not nice-to-have). One-off skills and
nice-to-haves are still extracted and stored — they just don't clutter the default
chart, and stay reachable by clicking into a job.

**Why:** Running the probe on real screenshots produced a long tail of skills that only
showed up once. On a bar chart that's noise and buries the real market signal.

**Trade-off:** These thresholds are **view filters only** — we never drop data during
extraction. A "show all" toggle can lift them. Nothing is lost; it's just hidden by
default.

**What this required:** A new per-skill field, `requirement` (required vs nice_to_have).
We confirmed the model does assign both labels (26 required / 19 nice-to-have across 3
jobs). We have **not** yet checked whether those labels are actually correct against the
job text — that's still worth eyeballing.

---

## 2026-06-23 11:27 — De-risk extraction in a notebook, before the sprint

**Decision:** Built `scratch/extraction_probe.ipynb` to test the extraction approach on
a few real screenshots during the week, so sprint day is execution, not discovery.

**Key calls:**
- **Provider-agnostic:** one flag switches between OpenAI and Anthropic, because we
  don't yet know which one the hackathon will give credits for.
- **Structured output via a Pydantic schema** (raw SDK call, no LangChain) — simpler and
  easier to inspect.
- **Screenshots are git-ignored** — kept on the laptop, off GitHub.
- Added `ipykernel` so the notebook runs in the project's `.venv`.

**Verified (actually ran it):** Both providers work end-to-end — Anthropic accepts the
Pydantic schema as a tool input, and OpenAI's `chat.completions.parse` works on the
installed version. (A `beta` fallback in the code is dead on this version but harmless.)

---

## 2026-06-23 11:16 — Test both API keys ahead of time

**Decision:** Wrote `test_key.py`, which makes one tiny call to **both** OpenAI and
Anthropic and reports each separately. Both passed.

**Why:** The hackathon supplies credits but we don't know the provider. Confirming both
keys work now means no surprise on the day. Used the cheapest models (gpt-4o-mini,
claude-haiku) so the test costs ~nothing. The key lives in a git-ignored `.env` and is
never committed.

---

## 2026-06-23 10:27–11:12 — Deploy path fixed and proven

**What went wrong:** The first Vercel setup quietly created a **separate** GitHub repo
(`job-pipeline-dashboard`) from a template and deployed *that*, instead of our real repo
(`job-pipeline`). So our `git push`es went to one repo while Vercel watched another —
the live site stayed frozen on an unrelated "Initial commit" no matter what we pushed.

**Fix:** Deleted that Vercel project and the stray repo, then re-imported the **real**
`job-pipeline` repo with **Root Directory = `dashboard`**. After that, we changed a line,
pushed, and watched the live site update on its own — the deploy loop is proven.

**Lessons for future-you / future agents:**
- When importing to Vercel, import the **existing** repo. Don't accept a new
  template-generated repo.
- The React app lives in `dashboard/`; Vercel's Root Directory must be set to it.
- To check whether a deploy worked, look at the **JS bundle** or the browser — a plain
  `curl` of `/` only returns an empty HTML shell for a Vite/React app, so it always
  looks "empty" even when the deploy is fine.
- Live URL: `https://job-pipeline-opal.vercel.app`

---

## Earlier — Architecture decisions (pre-dates this log)

The big structural calls — why there's **no backend**, why extraction runs once on the
laptop and writes a static `jobs.json`, why **Vite + React** and **Vercel**, and the
shared `job` / `skill` data model that lets part 2 (the email parser) plug in later —
are written up in `jd-aggregator-sprint-plan.md` under "Tech Stack & Architecture" and
"Shared Data Model". Read those there rather than duplicating here.
