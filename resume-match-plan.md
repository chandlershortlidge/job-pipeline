# Resume Match — Build Plan (Phase 4 stretch, additive)

The feature: a judge uploads **their own resume (PDF)** on the live site → it's parsed
**on demand in a Daytona sandbox** → the dashboard shows **which jobs they match**, ranked,
with the skills they have and the skills they're missing per job.

This is **purely additive** and **gated** the same way the live drop-in is: the deployed
dashboard + the existing JD drop-in are the prize floor and must never depend on this. If
resume-match breaks, we cut it and nothing else is touched.

**Why it's feasible by day-end:** the hard parts already exist. Extraction-in-a-sandbox is
proven (`extract.js`), normalization is proven (`canonicalMap.js`), and the Anthropic API
**reads PDFs natively** — no PDF-parsing code, just a `document` content block in place of the
`image` block. The match itself is set intersection in ~30 lines of client JS.

---

## The contract (front-end ⇄ backend) — build to this

**New endpoint** `POST /api/match-resume` (a *new* file — we do **not** touch the working
`extract.js`).

**Request:**
```json
{ "pdf": "<base64 string, no data: prefix>", "media_type": "application/pdf" }
```

**Response (success):**
```json
{ "profile": {
    "title": "ML Engineer",            // nullable — candidate's target/most-recent role
    "years_experience": 4,             // nullable
    "skills": [                        // already normalized to the chart's canonicals
      { "canonical": "Python", "raw_text": "Python 3" },
      { "canonical": "RAG",    "raw_text": "retrieval-augmented generation" }
    ]
} }
```
**Response (failure):** `{ "error": "couldn't parse the resume" }` with HTTP 500.

**Front-end behaviour:** on upload → POST → on success compute the match **client-side**
against the in-memory `jobs` array and render a ranked results panel; on error show a small
note and leave everything intact. Stateless — no DB.

---

## Verified facts this rests on (checked, not assumed)

- **PDF is native to the Messages API.** Content block:
  `{"type":"document","source":{"type":"base64","media_type":"application/pdf","data":"<b64>"}}`,
  placed before the text block. **No beta header.** Limits: 32 MB / 600 pages per request
  (our model `claude-sonnet-4-6` is a 1M-context model → 600-page tier). A resume is 1–3 pages.
  Base64 must have **no newlines**.
- **`jobs.json` shape:** `{ jobs:[...], skill_variants:{...} }`. Each job has
  `skills:[{canonical, raw_text, requirement}]`. The default chart counts `requirement==="required"`.
- **App.jsx already has** `fileToBase64(file)`, an `uploading`/`uploadError` state pattern, and
  the upload `<section>` — the resume UI mirrors these.

---

## Steps to execute (in order; each has a done-when checkpoint)

### Step 1 — De-risk: PDF extraction in a sandbox, in isolation  ⟵ LOAD-BEARING
A throwaway local script (in `scratch/`) that runs the stdlib-`urllib` extraction **with a
`document` block** over **one real resume PDF**, and prints the extracted skills JSON.
This proves three first-time things at once before any wiring: (a) a PDF's base64 embeds into
the Daytona sandbox code string the way the ~320 KB image did, (b) the `document` block works
through the sandbox's raw `urllib` call, (c) the resume prompt returns sane skills.

- **Done-when:** a real resume → a printed list of skills that, eyeballed, matches what's
  actually on the resume. I explain the output in plain English; you check output vs.
  expectation vs. explanation (the AGENTS.md three-way check).
- **If it fails here (cheap fallback, decide now not later):** fall back to **resume-as-image**
  (the image path is already proven in `extract.js`) or **pasted text**. Either keeps the
  feature alive without the PDF risk. We only spend more if Step 1 is green.

### Step 2 — Backend function `dashboard/api/resume.js`
Clone the structure of `extract.js`, with these changes:
- **Resume system prompt** ("extract the candidate's technical skills; be honest about
  absence") + a small schema: `{ skills:[{raw_text, canonical}], title, years_experience }`.
- **Sandbox code**: same Anthropic `urllib` POST, but the user content is a `document` block
  (PDF) instead of an `image` block.
- **Normalize**: reuse the existing `canonicalMap.js` + the `normalizeSkills` logic so resume
  skills land on the same canonical names as the chart (so "ReactJS" on a resume matches
  "React" in a job). Copy the ~15-line normalize into `resume.js` (don't edit `extract.js`).
- **Secrets**: same `DAYTONA_API_KEY` + `ANTHROPIC_API_KEY` env vars already set in Vercel.
- **Done-when:** invoked locally with a mock request carrying a base64 PDF, it returns a valid
  `{ profile }` with normalized skills. Printed and eyeballed.

### Step 3 — Deploy + verify the endpoint
`git push`, then `curl -X POST .../api/match-resume` with a base64 PDF.
- **Done-when:** HTTP 200 + a `profile` from the **deployed** endpoint (not just local).

### Step 4 — Front-end: upload + matching + results
In `App.jsx` (mirrors the existing drop-in upload):
- A **"Match your resume (PDF)"** `<section>` with a file input (`accept="application/pdf"`),
  reusing `fileToBase64` and an `uploading`/`error` state pair.
- On success, **compute the match client-side** against `data.jobs`:
  - `requiredSet(job)` = its `required` canonical skills.
  - `matched` = resume skills ∩ requiredSet; `missing` = requiredSet − resume skills.
  - `score` = `matched.size / requiredSet.size` (% of a job's required skills you have);
    rank jobs by score, tie-break by absolute `matched` count.
  - Extra resume skills (not required by a job) **never affect the score** — knowing more
    than a job asks for shouldn't penalize the match.
- Render a **ranked list of job cards**: company · title · match % · matched chips (solid) ·
  missing chips (outlined). Reuse the existing chip styles.
- **Extra skills line** (decided): below the ranked list, show the candidate's skills that
  match **no** job in the corpus — e.g. *"You also have: Chroma, Ollama, RoBERTa, … — not
  asked for in these roles."* Honest (shows the full extraction, not just keyword hits) and
  ~2 lines of JSX. Computed as `resumeSkills − (all canonical skills across all jobs)`.
- **Done-when:** in a fresh browser, uploading a real resume against the **live** endpoint
  shows a sensible ranking (e.g. a Python/LLM-heavy resume ranks the Python/LLM jobs top, and
  the "missing" lists look right). Sanity-printed once to confirm the math.

### Step 5 — Freeze, verify, log
- Re-deploy from clean `main`; click through the live URL in a fresh incognito window as a
  stranger. Fix only show-stoppers.
- Add the `DECISIONS.md` entry (folded into the relevant commit, silently).
- Add a one-line demo beat to `demo-script.md`: "and you can drop in *your own* resume and see
  where you fit" — still name-drops Daytona (the parse runs in the sandbox).

---

## Decisions already made (so we don't re-litigate on the clock)

- **Input = PDF.** Native to the API; no parsing code. (Image / paste-text are the Step-1
  fallbacks only.)
- **New endpoint `api/resume.js`**, not an extension of `extract.js` — isolates the new code so
  the proven JD drop-in can't regress.
- **Match runs client-side** — the front end already holds `jobs.json`; no second source of truth.
- **Score = % of a job's *required* skills the candidate has** (consistent with the chart's
  required-only default). Nice-to-haves can be shown as a bonus later if time allows.

## Guardrails

- **Gated stretch.** Build only on top of the already-deployed product. If it breaks, cut it.
- **Don't touch** `extract.js`, `jobs.json`, or `normalize.py` outputs — additive files only.
- **Cut line ~16:00.** If resume-match isn't landing by then, drop it; record the existing
  90-sec backup regardless.
- **Verify the load-bearing step (Step 1) on a real resume before building UI on top of it** —
  same discipline as the JD drop-in.

## Open question for you (not blocking the plan)

- Confirm the **deployed `/api/extract`** drop-in still works end-to-end after the
  `ANTHROPIC_API_KEY` add? (The curl test you interrupted.) Worth doing before Step 3 so we
  know the deployed Daytona path is healthy before adding a second endpoint to it. Your call.
