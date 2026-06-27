# JD Skills Aggregator — 5-Hour Solo Sprint Plan

## Purpose
Answer one question, visually: **"What is the job market prioritizing?"**
Input: a corpus of ~15–20 job-description screenshots already on hand.
Output: a live URL showing a dashboard — stats, a job list, and a ranked skills chart, with click-to-filter — over skills normalized across all JDs.

## Definition of Done (v0)
A deployed, public URL where skills are extracted from the corpus, normalized to a canonical vocabulary (React = ReactJS = React.js), and shown as a dashboard with four panels:
- stats bar (N job descriptions, N unique skills, N companies),
- job list/table (company, title, seniority, summary),
- ranked skills bar chart (document frequency across N JDs),
- click-to-filter (job → its skills; skill → which jobs want it).

Panels are built in order and each one deploys, so the dashboard degrades gracefully: if the clock runs out, whatever panels exist still demo. The ranked chart + stats alone already tell a real story; the job list and filtering deepen it.

## Submission Requirements (gates to enroll / win) — from the event FAQ
These are hard gates from the event description, not nice-to-haves. Check them off the day of.
- [ ] **Live online URL at end of day** — the *minimum* for any prize. Already solved cold during prep (`job-pipeline-opal.vercel.app`). This is the single requirement, and it's done before the day starts.
- [x] **Open source** — repo is public on GitHub *and* carries an OSI license (MIT added). Both needed to enroll; both done.
- [ ] **Built at the event** — the product (extraction + dashboard) is created on the day. Prep was deploy setup + planning + a throwaway de-risk notebook only; "bringing a pre-built project" can't enroll, so the actual build happens 11:00–17:00.
- [ ] **Sponsor stack = Daytona** — *not* required to qualify, but using the sponsor's stack is the edge for **winning** (separate sponsor prize). See "Sponsor angle — Daytona" below.

## Does Add / Does Not Add

**Does add (this is v0 — the four-panel dashboard):**
- Extraction from the existing corpus
- Skill normalization to a canonical list  ← *load-bearing; the demo dies without it*
- Stats bar (N job descriptions, N unique skills, N companies)
- Job list/table (company, title, seniority, summary)
- Ranked skills bar chart across all JDs (document frequency)
- Click-to-filter: click a job → its skills; click a skill → which jobs want it
- Live deployed URL

**Does NOT add (stretch, only if v0 lands with time to spare):**
- Live drop-in of a *new* screenshot during the demo
- The cross-job chatbot
- Faceted filtering by role/seniority, multiple chart types, polish beyond legible

## The Load-Bearing Risk
Normalization is the whole ballgame. If "React," "ReactJS," and "React.js" land as three separate bars, the aggregate is noise. This is the reconciliation problem in a new domain — your home turf, but non-negotiable. Budget real time here, not at the end.

**Where normalization must live (proven by the probe):** do it as a **deterministic post-extraction step** — a plain piece of code that runs once over *all* the extracted skills together, after the AI is done. ("Deterministic" = the same input always gives the same output — unlike the model, which answers differently run to run.) Do **not** try to make the model do it: each screenshot is extracted on its own, so the model never sees the other jobs and can't be consistent across them. We tried a prompt-level "normalize case" rule, and the rerun proved it does nothing.

The code does three things, in this order:
1. **Split slash-lists** — break "A/B/C" chunks ("GCP/AWS/Azure", "n8n/Make/Zapier") into separate skills (split on `/`, `,`, " or ", "&"). Left alone, the model keeps only the first and silently drops the rest.
2. **Case-fold** — lowercase and trim stray spaces/punctuation before comparing, so "Vector Databases" and "vector databases" count as one skill, not two.
3. **Canonical alias map** — a hand-written lookup of "this spelling → that official name" (`large language models → LLMs`, `ReactJS → React`). Keep it conservative: only merge pairs you've eyeballed; when unsure, leave them separate. Under-merging is safe (two honest bars); over-merging is a visible error a judge will catch.

So: the LLM extracts the raw skill text (`raw_text`); this code turns it into the clean name (`canonical`). Treat the model's own `canonical` guess as a hint, not the source of truth.

Both failure modes here are real, not hypothetical — the probe produced the "Vector databases" double-bar and the "GCP/AWS/Azure → GCP" collapse, and did it inconsistently between runs. That's the proof normalization can't live in the prompt.

## Normalization — contingency plan
Normalization is the make-or-break block (13:00–14:15 on the clock). It will **not** be
perfect; the bar is "sane enough that the top of the chart tells a true story." Below are
the problems we'll likely hit and the move for each — pick the move, don't agonize.

**Likely problems → the move:**
- **Same skill, different spelling/case** ("Vector databases" vs "Vector Databases", "CI/CD"
  vs "CICD"). → First pass is mechanical: lowercase + strip punctuation/extra spaces, then
  compare. Catches most of these for free. Do this before anything clever.
- **Slash / "or" lists** ("n8n/Make/Zapier", "GCP/AWS/Azure"). → Split on `/`, `,`, " or ",
  "&" into separate skills *before* mapping. Then decide per group: keep separate when the
  distinction is signal (GCP vs AWS vs Azure), bucket when it isn't.
- **Real synonyms that don't look alike** ("large language models" → "LLMs",
  "retrieval-augmented generation" → "RAG"). → Only the hand-written alias map catches these
  (seed list is in the Extraction Spec). Extend it from what you actually see in the corpus.
  This is the part that takes the time — budget it.
- **Wrongly merging two different skills** ("Java" ≠ "JavaScript"; "Generative AI" shouldn't
  swallow everything "AI"). → Keep the alias map **explicit and conservative**: only merge
  pairs you've eyeballed. When unsure, leave them separate. Under-merging is safe (two honest
  bars); over-merging is a visible error a judge will catch.
- **One-skill-or-two judgment calls** ("embeddings" vs "vector databases"; pandas/NumPy/
  scikit-learn as three or one "Python data stack"). → Make a fast call, log it, move on.
  Default: keep recognizable standalone tools separate; only bucket clearly-interchangeable ones.
- **Still a messy long tail after mapping.** → Expected, and already handled: the chart
  defaults to frequency ≥2 + required-only, so singletons fall off the default view. If still
  noisy, raise the threshold to ≥3 or show only the top-N.

**If at 14:15 the top of the chart still looks like noise — escalation ladder (in order):**
1. **Switch from "normalize everything" to a curated allowlist.** 
   hand-pick ~15–25 canonical skills you care about and chart only skills that map into that
   set. Everything else stays in the data and on click-through, just off the chart. This turns
   an open-ended reconciliation problem into a closed-set lookup: fast and demo-safe. **This is
   the strongest fallback — reach for it early, not last.**
2. **Hand-fix the top 20.** With ~15–20 jobs the skill list is small and finite. Manually clean
   the alias map (or the output) for the top ~20 skills by document frequency; ignore the tail.
   Brute force, but bounded and reliable.
3. **Raise the threshold.** Show only ≥3-job skills — fewer bars, far less chance of a dirty one.
4. **Last resort: ship raw + threshold.** If normalization is actively breaking and the clock is
   at hour 4, show raw skills with the ≥2 threshold and get the URL live. A deployed honest-but-
   rough chart beats a perfect normalizer that never ships. (The plan already blesses this.)

**Two guardrails:**
- **Don't reach for a live LLM normalization pass.** Per-job prompting is already proven
  inconsistent (see `DECISIONS.md`). If you use an LLM at all, use it *once* over the list of
  unique skill strings to *propose* a map you then eyeball and freeze into code — never as a
  live step in the pipeline.
- **The time box is hard: stop at 14:15.** If it's only "sane enough," freeze it and go build
  the chart — the 15:00 deployed-chart milestone is sacred. A curated top-15 that's live beats a
  perfect map that isn't.

## Tech Stack & Architecture
**One program, one deploy, one host.** The key decision: extraction does NOT run live. The corpus is fixed (~20 screenshots known ahead of time), so extraction runs once as a script on the laptop and writes a static `jobs.json`. The React app reads that file. No backend = no second service, no CORS, no two-host sync, nothing to debug in the gap between services at 16:45.

- **Extraction:** Python script, model SDK in **structured-output / JSON mode** (NOT LangChain — no chains/agents/orchestration here, raw SDK call is simpler and more inspectable). Pydantic schema enforces the nullable fields. Writes `jobs.json`.
- **Frontend:** **Vite + React** (not Next.js — no SSR/routing machinery needed for a single-page dashboard reading static JSON).
- **Charts:** Recharts.
- **Storage:** flat `jobs.json` today. SQLite (the part-2 shared DB) is a later, mechanical conversion — don't build it now.
- **Deploy:** **Vercel.** Built for static React frontends, best-documented for the Vite+React combo (most search hits for your exact setup when stuck cold/solo). Push-to-deploy, one screen.

Why a live backend was rejected: it only earns its place if the app extracts *new* data while someone uses it. Yours doesn't — the only feature needing that is the "drop in a new screenshot live" stretch goal, which stays optional. GCP/Railway were also rejected: they're built for running backends/databases, the exact thing this architecture deletes — pure setup tax for zero benefit here. (Real GCP fluency, if wanted for the CV, is its own deliberate project, not bolted onto a sprint.)

## Deploy Path — SOLVE COLD DURING THE WEEK
Before any feature code, before the day:
- Blank repo, Vite+React configured, deps installed
- `git push` → live Vercel URL, verified working with a hello-world (do this end-to-end at least once)
- Model-provider API keys loaded and **tested now**, not at 11am

Solo, deployment is your only bottleneck that a teammate would otherwise absorb. Remove it before the clock starts. The bar isn't "understand Vercel deeply" — it's "one full push→URL round trip already done."

## De-Risk During the Week (legitimate prep — testing approach, not pre-building)
In a notebook, over a handful of your real screenshots:
- Run the extraction approach; eyeball whether it holds
- Find where it breaks: multi-column layouts, skills-in-prose, inconsistent phrasing
- Sketch the canonical-skill mapping from what you actually see in the data

This is notebook-first verification done ahead of time, so the sprint itself is execution.

## Shared Data Model (part-2 insurance)
This is a two-part project (part 1: JD aggregator, today; part 2: email parser, later) sharing one repo (`job-pipeline`) and one database. The two halves only become one product if they join on a shared `job` entity. Model that today so part 2 plugs in without a rewrite.

```
job
  id
  company         -- nullable today; email parser fills/confirms later
  title           -- role name
  seniority       -- extracted from JD (part 1)
  source          -- 'screenshot' now, 'email' later
  created_at

skill
  id
  job_id          -- FK -> job
  raw_text        -- "ReactJS" as it appeared
  canonical       -- "React" after normalization  <- load-bearing field

-- part 2 ONLY; do not build today, just don't make it impossible
application
  id
  job_id          -- FK -> job   <- the join that makes it one product
  status          -- applied / no-reply / interview / rejected
  applied_at
  last_email_at
```

The whole insurance is one line: a `job` table with an `id` that skills hang off of. Each screenshot becomes a `job` row; skills point at `job_id`; aggregate by counting `canonical` across jobs. Barely more work than a flat table today, and it's the entire difference between "plugs in later" and "rewrite."

- Do NOT build `application` today. Just don't design a schema with no place for it — the `job` table is that place.
- `company`/`title` nullable today; part 2's emails are the better source and can backfill via the join.
- Fallback: if you're fighting the clock at hour 4, collapsing to a flat skills table to get the URL live is legitimate. Ship-the-demo beats perfect-schema.

## Extraction Spec (derived from a real 6-JD sample)
The corpus is **partial screenshots, not whole JDs** — they start/end mid-section, titles and companies are sometimes out of frame or logo-only. The extractor must be honest about absence, not fill gaps with guesses.

**Per-job extraction target:**
```
job:
  company    -- nullable (may be logo-only or cropped out)
  title      -- nullable (some screenshots open mid-section, no title in frame)
  seniority        -- enum: Junior | Mid | Senior  (inferred when not stated)
  seniority_signal -- the phrase or years the label keyed off (e.g. "(Junior)", "production... at scale")
  seniority_basis  -- enum: stated | inferred
  summary    -- 1-2 sentences, "what this role wants"
  source     -- 'screenshot'
skills:       -- a SET of canonical skills, distinct per job
  raw_text + canonical
  requirement -- enum: required | nice_to_have  (the default chart shows required only)
```

**Rules that the sample forced:**
- **Every field nullable; "not stated" beats a guess.** Cropped JDs are common — an extractor that assumes all fields present will hallucinate. Verify the model returns clean nulls on the cropped ones (this is the one real unknown to test in the notebook).
- **Seniority: inferred, but auditable.** Only 1 of 6 stated it outright, so infer the rest — but return the *evidence* (`seniority_signal`) and whether it was `stated` vs `inferred` (`seniority_basis`) alongside the label. A bare label collapses when a judge reads the JD; an inferred label with its signal shown (e.g. on hover) demos the tool *reasoning* instead of asserting. If inference looks shaky across the corpus on the day, fall back to showing `stated` confidently and `inferred` with a visual caveat — no rebuild needed.
  - Years ladder (literal): `<2yr → Junior, 2–5 → Mid, 5+ → Senior`
  - Language ladder (explicit, don't let the model freelance): `lead/principal/architect/deep expertise → Senior; proven/production/ownership → Mid-to-Senior; eager to learn/initial experience/strong interest → Junior`
  - Calibration case: ZDF's "initial experience or a very strong interest" is textbook Junior — test the ladder against it.
  - Scope guard: get the ladder sane on the 6 sample JDs, ship it, log disagreements as a known limitation. Do NOT hand-tune against all 20 chasing perfect labels.
- **Company may need vision, not OCR** (logo-only names). Confirm the model reads logos; if not, expect null company on some — fine, part 2's emails backfill via the join.
- **Aggregate by document frequency, not raw mentions.** Count *jobs that mention a skill* ("5 of 6 jobs want Python"), not total mentions. More meaningful for "what's the market prioritizing," and it neutralizes duplicated text (one sample had its role paragraph repeated verbatim).
- **Capture required vs nice-to-have per skill.** The default chart shows required skills only, so the extractor must label each skill `required` or `nice_to_have`. JDs usually split these into "must have" / "nice to have" (or "bonus"/"a plus") sections — key off that. When a skill's section is ambiguous, default to `required` and move on. Nice-to-haves are still extracted and stored; they're just hidden from the default chart view.
- **Discard UI chrome.** Vision will otherwise pick up apply buttons, German UI words (Vollzeit), model-name corner labels (gpt4), verified checkmarks, bookmark/share icons.

**Canonical map, seeded from the sample (extend on the day):**
- LLMs ← large language models, LLM, LLM APIs, LLM orchestration
- RAG ← retrieval-augmented generation
- Vector databases ← vector databases, embeddings (decide: one skill or two)
- Agents ← LLM agents, agentic workflows, multi-agent, agent components
- Prompt engineering ← prompt engineering / design / optimization
- Tool calling ← tool use, function calling, tool/function calling
- CI/CD ← CI/CD, CI/CD automation
- Cloud ← keep GCP / AWS / Azure separate for market signal; bucket smaller ones
- Clean/low-risk as-is: LangChain, LlamaIndex, Python, SQL, Docker
- **Long tail is real — extract it all, threshold the *chart* (decided, from running the probe).** The probe confirmed a long tail of one-off skills (MITRE ATT&CK, RDKit/cheminformatics, etc.) that would clutter a bar chart into noise. Policy: extract and store **everything**; the chart defaults to **document-frequency ≥ 2 _and_ required-only**. Singletons and nice-to-haves stay in `jobs.json` and remain reachable via click-through (click a job → all its skills, including the count-of-1 ones). The ≥2 threshold and the required-only default are *view* filters — never a data filter. Nothing is dropped from extraction; the dashboard can expose a "show all" toggle to lift both filters.

## Timeline (Day Of) — work backwards from the 5pm demo

Fixed points: **hack starts 11:00**, **lunch 12:00–13:00**, **demo + judging 17:00**.
That leaves **5 hours of actual build time**. This schedule is planned backwards from the
demo, not forwards from the start — the deadline is the anchor, everything else fits inside it.

| Time | Block | Done-when / checkpoint |
|---|---|---|
| 11:00–11:15 | **Phase 0 — confirm deploy** | Push a trivial change, watch the live URL update. Don't dwell — it's already solved during prep. |
| 11:15–12:00 | **Phase 1 — extraction** | Raw skills out of all ~15–20 screenshots. Kick off the full batch; it can keep running over lunch. |
| 12:00–13:00 | **Lunch** | Real break. (Let the extraction batch run while you eat.) |
| 13:00–14:15 | **Phase 2 — normalization** ⟵ make-or-break | The deterministic code step: alias map + case-fold + split slash-lists (see "Load-Bearing Risk"). Top of the skill list reads like signal, not noise. |
| 14:15–15:00 | **Phase 3a — ranked chart** ⟵ the milestone | Chart reads `jobs.json`, deployed. **You now have a complete, demoable product.** Protect this above everything below it. |
| 15:00–15:30 | **Phase 3b — stats bar** | N jobs / N skills / N companies. Deploy. |
| 15:30–16:15 | **Phase 3c — job list** | Company, title, seniority, summary. Deploy. |
| 16:15–16:30 | **Phase 3d — click-to-filter** | Job → its skills, skill → its jobs. Deploy. (First thing to cut if behind.) |
| **16:30** | **🛑 HARD STOP — stop building** | No new code or features past this line, no matter what. |
| 16:30–16:45 | **Freeze + stranger test** | Redeploy from a clean `main`. Open the live URL in a **fresh incognito window** and click through it **as a stranger would** — nothing cached, nothing assumed. Fix only show-stoppers. |
| 16:45–17:00 | **Demo prep + buffer** | Rehearse the 2-minute story, URL open in a tab. Buffer for Wi-Fi / nerves. |
| **17:00** | **Demo + judging** | |

**The rule that overrides the table:** if you're behind at any checkpoint, cut **upward
from the bottom** — drop 3d, then 3c, then 3b — but never touch the 3a chart or the
normalization beneath it. A deployed chart + sane counts is a real demo; half-built panels
are not. Same "degrade gracefully" logic as the panel order, now on a clock.

**Why the hard stop is 30 min out (16:30):** deployment is the thing that bites solo
builders at the buzzer. 30 minutes is the right size here *because each panel deploys as
you build it* — by 16:30 you'll have run push→deploy several times that afternoon, so the
final freeze is a re-verify of a well-worn path, not a risky first deploy. The 30 minutes
buys a clean redeploy plus testing the live URL as a stranger (a fresh incognito window,
not your laptop where it "works on my machine"). Move the line *earlier* (16:15) only if
something feels shaky; never later.

## Sprint Phases (Day Of)
*(The "when" for each phase is in the Timeline above; the "what" is here.)*


**Phase 0 — Setup (target: ~0 min into build)**
Deploy path already solved. Confirm the live URL still deploys. Don't burn time here.

**Phase 1 — Extraction (checkpoint: skills coming out of all ~15–20 screenshots)**
Get raw skills out of the full corpus. Don't normalize yet. Confirm you have *something* per JD.

**Phase 2 — Normalization (checkpoint: canonical list, sane counts)**
Collapse variants to canonical skills. Eyeball the top of the list — does it look like a real market signal or like noise? This is the make-or-break checkpoint.

**Phase 3 — Dashboard panels (build in order; each one deploys)**
Wire the React app to read `jobs.json`, then add panels in this order so every step is demoable.
**Layout, the `jobs.json` data contract, component breakdown, interactions, and visual style are
locked in `frontend-spec.md` — build against that, don't redesign on the clock.**
- 3a — ranked skills bar chart (document frequency; **default view: freq ≥ 2 and required-only**, with the full long tail + nice-to-haves still in the data and on click-through). **Deploy. You now have a complete demo.**
- 3b — stats bar (N jobs, N skills, N companies). Cheap, makes it feel like a tool.
- 3c — job list/table (company, title, seniority, summary).
- 3d — click-to-filter: job → its skills, skill → its jobs.
Drop from the bottom (3d first) if time runs short, never from the top.

**Phase 4 — Live Daytona features (built)**
Beyond the static dashboard: the **live JD drop-in** and the **résumé match**, both parsing fresh
input on demand in a Daytona sandbox. See "Live features (Daytona-powered)" below.

## Live features (Daytona-powered)
Two features run extraction on demand inside a **Daytona sandbox**, so the dashboard isn't just a
static read of `jobs.json` — it parses fresh input live. Both are served by Vercel serverless
functions in `dashboard/api/` (same repo, same `git push`, no separate backend) and share one
in-sandbox extraction approach.

**How the sandbox extraction works (shared by both):** a thin JS function creates an **ephemeral**
Daytona sandbox and runs Python in it that calls the model's HTTP API directly via the standard
library (`urllib`) — so the sandbox needs no `pip install` and boots fast. The function reads the
sandbox's stdout, normalizes the skills against the chart's vocabulary (`canonicalMap.js`, generated
by `normalize.py`), and returns JSON. Secrets (`DAYTONA_API_KEY`, `ANTHROPIC_API_KEY`) live in Vercel
env vars. Sandboxes are created `ephemeral` with a short auto-stop so they self-delete (see the
disk-leak fix in `DECISIONS.md`).

```
Browser (live site)
  → POST to /api/extract (screenshot) or /api/resume (PDF)   (Vercel serverless fn, holds secrets)
     → Daytona SDK: create ephemeral sandbox, run Python extraction in it (stdlib urllib), read JSON
  ← returns the parsed job / profile (skills normalized to the chart vocabulary)
React updates in memory — NO database
```

### Live JD drop-in
Upload a JD screenshot → it's parsed in a sandbox → the new job is **prepended to the dashboard**
(chart, stats, and list re-derive; a green "live" badge marks it). Stateless — React state only.
- **Contract:** `POST /api/extract` `{ image: <base64>, media_type }` → `{ job }` (same shape as a
  `jobs.json` job).

### Résumé match
Upload your résumé **PDF** → it's parsed in a sandbox (the model reads PDFs natively via a `document`
content block — no PDF-parsing code) → its skills are normalized to the chart's vocabulary → every
job is ranked **client-side** by how much of its *required* skills you already have, with matched and
missing skills shown per job. Extra skills you have that no job asks for never lower the score; they're
listed separately as an honest "you also have…" line.
- **Contract:** `POST /api/resume` `{ pdf, media_type }` → `{ profile: { title, years_experience,
  skills:[{canonical, raw_text}] } }`. Match runs against the in-memory `jobs`.
- **"LLMs" inference:** a résumé rarely says "LLMs" literally even when the candidate clearly does LLM
  work, so deterministic code (not a prompt) adds "LLMs" when the résumé carries a strong LLM-signal
  skill (RAG, LangChain, Agents, Prompt engineering, …). Same normalize-in-code principle as the corpus.

## Sprint AGENTS.md Posture (lightweight variant)
Keep: tight scope, explicit definition of done, English-explanation sanity checks before moving on.
Drop: full planning docs, promotion-to-module ceremony, comprehensive test coverage.
Solo, the scope discipline is doing the job a teammate would — it's your conscience in a file.

## One Reminder
Stay open to the 10:20 matching session. Prepared to fly solo, open to a pairing. You lose nothing by keeping the door open, and a frontend/pitch partner could ship the stretch goals you'd otherwise skip.
