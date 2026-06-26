# job-pipeline

**JD Skills Aggregator** — answer one question, visually: *what is the job market prioritizing?*

Feed it a corpus of job-description screenshots; it extracts the skills, normalizes the messy
variants into a canonical vocabulary, and shows the market as a ranked, clickable dashboard.

> Built solo at a one-day AI hackathon. Open source (MIT).
> **Live:** https://job-pipeline-opal.vercel.app

## The idea
Job descriptions are inconsistent and unstructured — "React", "ReactJS", and "React.js" are the
same skill written three ways, and the signal (what employers actually want) is buried. This tool
reads ~15–20 real JD screenshots with a vision model, reconciles the skill names, and aggregates by
**document frequency** (how many jobs mention a skill) to surface the real market signal.

## What it does (v0)
- **Ranked skills chart** — skills by how many jobs ask for them (the headline).
- **Stats bar** — N jobs · N unique skills · N companies.
- **Job list** — company, title, inferred seniority (with the evidence), summary.
- **Click-to-filter** — click a skill → the jobs that want it; click a job → its full skill set.
- **"Merged from" reveal** — hover a skill to see the raw variants that normalized into it (the extraction at work).
- **Live drop-in (stretch)** — upload a new screenshot and watch it parse on the spot, with extraction running in a **Daytona** sandbox.

## How it works
```
JD screenshots ──(Python + vision model, structured JSON)──▶ normalize ──▶ jobs.json
                                                                              │
                                                React dashboard reads /jobs.json
                                                                              │
                                                       deployed on Vercel (one URL)
```

**The pipeline, step by step:**
1. **Extract (per screenshot).** A Python script loops the ~20 screenshots; for each it calls a vision model and gets back structured data — company, title, seniority (+ the evidence), summary, and a list of skills, each as `raw_text` (as written) + a `canonical` guess + required/nice-to-have.
2. **Pool** the raw skills from every job into one list.
3. **Normalize — deterministically, once.** Plain Python over the whole pool: split slash-lists ("GCP/AWS/Azure" → 3 skills) → case-fold ("Vector Databases" = "vector databases") → apply a hand-written canonical alias map ("large language models" → "LLMs"). Same input, same output, every run.
4. **Aggregate.** Count how many jobs mention each canonical skill (document frequency) and build the skill↔job indexes.
5. **Write `jobs.json`** to `dashboard/public/`.
6. **Render.** The React app reads `/jobs.json` and draws the dashboard.

**Where's the AI vs. the plain code?** The AI reads the messy images; deterministic Python makes the results consistent and counts them. The model is the "smart but inconsistent" step; the code is the "consistent bookkeeping" step. Why the split: each screenshot is extracted on its own, so the model can't be consistent across the set (and isn't even repeatable run to run) — see `DECISIONS.md`.

**Notes:**
- No live backend for the core product — extraction runs offline and writes a static `jobs.json`.
- The **live drop-in** (stretch) adds one Vercel serverless function that runs the extraction in a **Daytona** sandbox — same repo, no separate host.
- Frontend: Vite + React, charts via Recharts.

## Tech stack
- **Extraction:** Python, `openai` / `anthropic` SDK (provider-agnostic), Pydantic, uv
- **Frontend:** Vite + React, Recharts
- **Sandbox runtime:** Daytona (`@daytona/sdk`) for on-demand extraction
- **Deploy:** Vercel (push-to-deploy)

## Repo layout
```
job-pipeline/
  extract.py              # extraction script (built on the day) → writes dashboard/public/jobs.json
  test_key.py             # one-call API-key smoke test (both providers)
  scratch/                # prep: de-risk notebook + Daytona hello-world
  dashboard/              # the React app (Vite)
    api/extract.js        # Vercel serverless fn → Daytona sandbox (live drop-in)
    public/jobs.json      # extraction output the app reads (generated)
  jd-aggregator-sprint-plan.md     # scope, build order, timeline, contingencies
  frontend-spec.md                 # dashboard layout + jobs.json data contract
  demo-script.md                   # the 2-minute pitch
  DECISIONS.md                     # why the calls were made (plain English)
  deploy-prep-checklist.md         # push→live-URL round trip (prep)
  daytona-prep-checklist.md        # Daytona sandbox round trip (prep)
```

## Status
Hackathon build. **Prep is complete** — the deploy pipeline is proven, both API keys are tested,
the extraction approach is de-risked on real screenshots, the normalization failure-modes are
mapped with a fallback plan, and the Daytona backend round-trip is verified live. The **extraction
pipeline and dashboard panels are built during the event**; the live URL currently serves a
placeholder plus a verified Daytona endpoint.

## Vision (two parts)
1. **JD aggregator** (this) — what the market wants.
2. **Email parser** (later) — parses your application emails to track where you've applied.

Both share one `job` data model, so they join into a single picture: what the market wants, and
where *you* stand in it.

## License
MIT — see [LICENSE](LICENSE).
