# scratch/ — de-risk the extraction approach (during the week, not on the day)

Purpose (from the sprint plan): on a handful of your real screenshots, run the
extraction approach and find where it breaks **before** the 5-hour sprint, so the
day itself is execution, not discovery.

## Setup
1. Drop ~5–6 of your real JD screenshots into `scratch/screenshots/`
   (PNG/JPG/WebP). These are git-ignored — they won't be committed.
2. Open `extraction_probe.ipynb`. In VS Code, pick the `.venv` kernel
   (Python from this project). `ipykernel` is already installed.
3. In the config cell, set `PROVIDER` to `"anthropic"` or `"openai"` —
   whichever you have credits for. Both keys are already tested working.
4. Run top to bottom.

## What to look for (the real unknowns)
- **Clean nulls on cropped JDs** — does the model return `null` for company/title
  it can't see, or does it hallucinate? This is the one load-bearing thing to verify.
- **Logo-only company names** — can vision read the logo, or is `company` null?
- **Seniority inference** — does the ladder produce sane labels, and is the
  returned `seniority_signal` actually the right evidence? Test the ZDF-style
  "initial experience or a very strong interest" → Junior case.
- **Where it breaks** — multi-column layouts, skills-in-prose, repeated paragraphs,
  UI chrome leaking in as "skills".

Jot findings in the notebook's notes cells. Extend the canonical map from what you
actually see. None of this is production code — it's a probe.
