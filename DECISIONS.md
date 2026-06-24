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
