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
