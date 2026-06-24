# Front-End Spec — the dashboard you build on the day

Locked during prep so the day is **wiring, not designing.** Layout chosen: **single column,
stacked.** Build the panels top-to-bottom in the Phase 3 order; each one deploys.

## Layout
```
┌──────────────────────────────────────┐
│ JD Skills Aggregator                 │
│ 20 jobs · 34 skills · 12 companies   │   ← stats bar (3b)
├──────────────────────────────────────┤
│ [ + add a screenshot ]   (Daytona)   │   ← live drop-in, stretch (Phase 4)
├──────────────────────────────────────┤
│ Most-wanted skills (≥2 jobs)         │
│ Python  ███████████████ 18           │   ← ranked bar chart, the hero (3a)
│ LLMs    █████████████   16           │
│ RAG     ████████        9            │
│ [ required only ▾ ]  [ show all ]    │
├──────────────────────────────────────┤
│ Jobs — click a row to see its skills │   ← job list (3c)
│ Acme AI   ML Engineer      Senior    │
│ ZDF       Data Scientist   Junior ~  │
│ …                                    │
└──────────────────────────────────────┘
```
One centered column, ~720px max width, vertical scroll. Reads on a projector; degrades
gracefully (drop the list or the drop-in and the chart still stands).

## Build order (each deploys — same as Phase 3)
1. **3a — SkillsChart** (the hero). Ship first → you have a complete demo.
2. **3b — StatsBar** (N jobs / N skills / N companies).
3. **3c — JobList** (company, title, seniority, summary).
4. **3d — click-to-filter** (skill → jobs; job → its skills).
Drop from the bottom if behind, never the chart.

## Data contract — `dashboard/public/jobs.json`
Extraction writes this; React fetches it at `/jobs.json`. **One source of truth: the jobs.**
The frontend derives stats + chart in memory (only ~20 jobs, so it's trivial and avoids a
second thing to keep in sync).
```json
{
  "generated_at": "2026-06-28T11:30:00Z",
  "jobs": [
    {
      "id": "job-1",
      "company": "Acme AI",          // nullable
      "title": "ML Engineer",         // nullable
      "seniority": "Senior",          // "Junior" | "Mid" | "Senior" | null
      "seniority_signal": "production ML at scale, 5+ yrs",
      "seniority_basis": "inferred",  // "stated" | "inferred"
      "summary": "Owns the RAG pipeline and agent tooling.",
      "source": "screenshot",
      "skills": [
        { "canonical": "RAG", "raw_text": "retrieval-augmented generation", "requirement": "required" },
        { "canonical": "Python", "raw_text": "Python", "requirement": "required" }
      ]
    }
  ]
}
```
**Frontend derives:**
- **Stats:** `jobs.length`; count of distinct `canonical` across all skills; count of distinct non-null `company`.
- **Chart (document frequency):** for each `canonical`, count the number of *jobs* that contain it (distinct per job). Default view keeps only skills with **count ≥ 2 AND at least one `required` mention**. "Show all" lifts both filters.
- **Skill → jobs index:** map each `canonical` to the jobs that list it (powers click-to-filter).

## Components (one per panel)
- `App` — fetches `jobs.json` once; holds `jobs`, `selectedSkill`, `showAll`; derives the rest.
- `StatsBar` — three numbers from derived stats.
- `SkillsChart` — horizontal ranked bars; respects `showAll`; a bar is clickable → sets `selectedSkill`.
- `JobList` — rows of jobs; if `selectedSkill` set, filtered to jobs with that skill; row click expands detail.
- `JobDetail` (inline expand) — the job's skills as chips (required = solid, nice-to-have = outlined), the summary, and seniority with its signal on hover.

## Interactions (precise)
- **Filter toggle:** default = required-only + freq ≥ 2. "Show all" lifts both. Document frequency is always the bar metric.
- **Click a skill bar →** Jobs list filters to jobs wanting that skill; the bar shows selected; a "clear" chip appears. Click again / clear → unfilter.
- **Click a job row →** expands inline to its skills (chips) + summary; the seniority label shows, and if `seniority_basis` is `inferred` it's marked (a trailing `~` or an "inferred" tag) with `seniority_signal` on hover. (The plan's "show the reasoning, don't just assert.")
- **Nulls:** missing company/title render as a muted "—", never blank or guessed.

## Visual style (decided — don't fiddle)
- System font stack; centered column ~720px; generous vertical spacing.
- One accent color for bars + selection (a blue/indigo); neutral grays for text/borders; white background.
- Bars labeled on the left, value on the right; sorted descending.
- Chart lib: **Recharts** (as planned). Contingency: if Recharts fights the clock, a horizontal bar
  is just a `<div>` with `width: {pct}%` — swap to CSS bars and keep moving; the data shape is identical.
- No theme system, no dark mode, no animation beyond defaults.

## Where the Daytona live drop-in sits (Phase 4 stretch)
An **"+ add a screenshot"** control near the top. On select → POST the image to `/api/extract`
→ the returned job is **prepended to `jobs` in state** → stats, chart, and list update reactively
(no refresh, no DB). On error, show a small "couldn't parse" note and leave everything else intact.

## Out of scope (do NOT build)
Routing, auth, pagination, responsive/mobile polish beyond "legible on a projector," loading
skeletons beyond a simple "Loading…", multiple chart types, faceted filters. v0 is these four
panels in one column.
