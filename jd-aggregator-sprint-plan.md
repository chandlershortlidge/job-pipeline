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

**Where normalization must live (proven by the probe):** make it a **deterministic post-extraction step over the aggregate** — a canonical alias map + case-fold + slash-list split, run once in code — **not** a prompt instruction. Each screenshot is extracted independently, so the model never sees the other jobs and *cannot* be globally consistent; a prompt-level "normalize case" rule was added and the rerun proved it does nothing. Two failure modes the probe surfaced that only code can fix:
- **Case/spacing duplicates:** "Vector databases" and "Vector Databases" landed as two separate bars in the same run.
- **Slash-list collapse:** a JD's "n8n/Make/Zapier" became just `n8n`, and "GCP/AWS/Azure" became just `GCP` — the model keeps the first alternative and silently drops the rest, inconsistently between runs (so it defeats the "keep GCP/AWS/Azure separate" rule too).

So: the LLM extracts `raw_text`; deterministic code maps `raw_text -> canonical` (and splits slash-lists into separate raw skills first). Treat the model's own `canonical` as a hint, not the source of truth.

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
Wire the React app to read `jobs.json`, then add panels in this order so every step is demoable:
- 3a — ranked skills bar chart (document frequency; **default view: freq ≥ 2 and required-only**, with the full long tail + nice-to-haves still in the data and on click-through). **Deploy. You now have a complete demo.**
- 3b — stats bar (N jobs, N skills, N companies). Cheap, makes it feel like a tool.
- 3c — job list/table (company, title, seniority, summary).
- 3d — click-to-filter: job → its skills, skill → its jobs.
Drop from the bottom (3d first) if time runs short, never from the top.

**Phase 4 — Stretch (only if Phase 3 deployed with time to spare)**
Live drop-in of a new screenshot, then — distant third — the chatbot.

## Sprint AGENTS.md Posture (lightweight variant)
Keep: tight scope, explicit definition of done, English-explanation sanity checks before moving on.
Drop: full planning docs, promotion-to-module ceremony, comprehensive test coverage.
Solo, the scope discipline is doing the job a teammate would — it's your conscience in a file.

## One Reminder
Stay open to the 10:20 matching session. Prepared to fly solo, open to a pairing. You lose nothing by keeping the door open, and a frontend/pitch partner could ship the stretch goals you'd otherwise skip.
