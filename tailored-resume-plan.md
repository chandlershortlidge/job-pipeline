# Plan: Tailored Résumé Generation

## Purpose

Given a specific job already in job-pipeline, generate a tailored résumé
(and eventually cover letter) that maximizes measured skill-match score
against that job — without fabricating or inflating any capability. The
existing `matchJob()` scorer is both the optimization target and the
acceptance test.

This is downstream of two things that must exist first:
1. **Project templates** — a synthesized, per-project "ground truth" record
   (see companion plan: project-template-synthesis), broken into atomic,
   verifiable claims (e.g. "built X using Y," "chose A over B because C").
2. The existing skills-match infrastructure (`matchJob()`, canonical skill
   normalization) already shipped in job-pipeline.

## Definition of done

- Trigger: from the same expand-on-row UI already used for résumé compare,
  a "Create a résumé" action opens a new screen for that job.
- Screen layout: side-by-side view — the original JD screenshot on the
  left (stays visible throughout, as the source-of-truth anchor), the
  résumé being built on the right.
- The résumé is split into sections (About me, Skills, Projects, Education,
  etc.) via LLM-based splitting, with the original full text kept alongside
  for reference in case the split needs correction.
- Sections are processed and approved **one at a time**, in order:
  - Each section shows a "Currently rewriting {section}…" state, then the
    generated result.
  - The person can **approve**, or **send a text-box note** requesting a
    specific revision (e.g. "make this sound less junior"), which
    regenerates just that section — never introducing new unverified
    claims, only rephrasing within what's already established as true.
  - For **Skills**: if the JD lists skills not found on the base résumé or
    project templates, the person is asked directly via pills (e.g.
    "Docker", "Codex") whether they actually have them — an explicit
    human confirmation gate, not an LLM guess.
  - For **Projects**: the claim-checklist step happens here — selected
    atomic claims from the project template shown per project, person can
    uncheck any before prose is generated for that project's description.
- The person can stop early ("ready, print my résumé") at any point.
  Any section not yet reviewed carries over **unchanged from the original
  résumé** — never dropped, never silently rewritten without approval.
- Final output is a downloadable, editable **.docx** file.
- Before/after match score (via `matchJob()`) is shown next to the
  download action, so the improvement is visible, not just assumed.

## Adds / does not add

**Adds:**
- New per-job screen: side-by-side screenshot + résumé-in-progress view.
- LLM-based résumé section splitter, with original text retained for
  reference.
- Section-by-section generate → review → approve/revise loop, including a
  free-text revision box per section.
- Skill-gap confirmation step (pills, human-confirmed, not inferred).
- Project claim-selection checklist (from prior plan), now placed inside
  this per-section flow rather than as a separate pre-generation step.
- Early-exit ("print my résumé") with unchanged-carryover for skipped
  sections.
- Docx export.
- Before/after `matchJob()` score display.

**Does not add (explicitly cut for this pass):**
- Cover letter generation — same architecture will likely apply later, but
  scoped separately once résumé generation is proven.
- Automatic detection of doc/template changes — project templates are
  synthesized and updated manually, on demand.
- Any live connection to chat history, GitHub, or other external sources —
  input is strictly the project templates and existing résumé, both
  already-materialized files.
- Multiple résumé "styles" or formatting themes — reuse existing résumé
  formatting/layout as-is for v1; only content changes.
- Regex-based section splitting — LLM-split chosen over regex since résumé
  formats vary; flagged here as a decision, not something to silently
  pick differently later without saying so.
- Reopening claim *selection* via the free-text revision box — revision
  notes can only affect phrasing/emphasis of already-selected claims for
  that section, not add new unverified claims. Adding back a previously
  unchecked claim should be an explicit checkbox action, not something a
  chat-style note can trigger implicitly.

## Steps

1. **Confirm project templates exist and are structured as atomic claims.**
   Blocked on the companion synthesis feature — do not start section
   generation until at least one project template is available in the
   agreed claim format.
2. **Build the trigger + screen shell.** "Create a résumé" action on an
   expanded job row opens the side-by-side screenshot/résumé screen.
3. **Section splitter.** LLM splits the base résumé into named sections;
   keep the original full text retrievable for reference/debugging.
4. **Section loop — Skills.** Cross-reference JD required skills against
   base résumé + project-template skills. Truthful matches surface
   directly; anything present in the JD but not confirmed anywhere is
   raised as a pill-confirmation prompt. Only human-confirmed skills make
   it into the final skills section.
5. **Section loop — Projects.** For each relevant project: show the claim
   checklist (pre-selected by relevance, human can uncheck), then generate
   prose from only the confirmed claims. Show for approval; free-text
   revision box regenerates prose only, never claim selection.
6. **Section loop — remaining sections** (About me, Education, etc.),
   same generate → approve/revise pattern.
7. **Early-exit handling.** "Ready, print my résumé" at any point carries
   forward unreviewed sections unchanged from the original.
8. **Assemble final .docx** from approved/carried-over sections.
9. **Re-score.** Run `matchJob()` on the final résumé for this job; show
   before/after score next to the download button.
10. **Notebook-verify before promotion**, per the standard build loop: run
    end-to-end on one real job + one real project template, showing the
    section loop, a skill-gap pill prompt, a claim checklist, and the
    final before/after score, before this ships.

## Pitfalls

- **Claim selection is the actual safety boundary — don't let revision
  notes reopen it.** The free-text box must be scoped to phrasing only, or
  the traceability guarantee (every sentence ties to a confirmed claim)
  breaks silently.
- **A rising score is not proof of honesty.** The re-score check catches
  "did it help," not "did it lie." Skill-pill confirmation + claim
  traceability are the actual hallucination guards; the score is a
  secondary sanity check.
- **Section-split errors compound downstream.** If the LLM splitter
  mis-segments a résumé (e.g. merges Skills into About me), every
  downstream step inherits the error. Keep the original text visible/
  correctable rather than trusting the split blindly.
- **Project templates that are too thin.** If a template has few atomic
  claims, the checklist step will have nothing good to offer regardless of
  ranking quality. That's a signal to improve the template, not to loosen
  the claim constraint.
- **Docx generation is a separate risk surface from content generation.**
  Don't let layout/formatting complexity creep into the section-generation
  logic — keep assembly (step 8) as its own concern.

## Budget

- Files touched: new screen/route, section splitter module, skill-gap
  confirmation component, claim-checklist component (extends prior plan),
  per-section generation + revision logic, docx assembly, re-score
  integration.
- Sample inputs: at minimum 1 real job + 1 real base résumé + 1 real
  project template for the first notebook pass; expand once the shape is
  confirmed.
- LLM calls: 1 for section split, 1 per section for generation, plus 1 per
  revision request. Confirm actual count once real section counts are
  known.
- Deferred: cover letter generation, template auto-refresh, multi-style
  résumé output, regex-based splitting — all explicitly out of scope
  above.
