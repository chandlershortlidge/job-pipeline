# Proposals: Tailored-Résumé Feature

Synthesized from `research.md` (2026-07-13, deep). Upstream plan: `tailored-resume-plan.md` —
the section-by-section approve/revise UX, skill-gap pills, and claim checklist are fixed
requirements from that plan; these proposals decide the *architecture* underneath them:
how honesty is enforced, how the LLM layer is wired, and how the .docx gets made.

## Recommendation: Approach B — Provenance Pipeline

Research's central finding: every commercial tool fabricates, none ship provenance, and
prompt-only "don't invent" constraints empirically fail (research theme 1). The claim
checklist is already in the plan; making its guarantee *machine-checkable* costs one schema
field, one regex, and one cheap judge call per section on top of Approach A's skeleton —
small marginal effort for the one property that distinguishes this feature from every tool
on the market. A is the fallback if B's verification layer stalls; C spends its extra
effort on layout fidelity, which research rates a known-hard problem with no off-the-shelf
solution and which the plan explicitly deprioritized ("only content changes").

---

## Approach A — Lean Human-Gate

**One line:** closed-world prompting + the human approval loop as the only verification;
ship the thinnest honest slice.

**How it works**
- One dispatcher route `POST /api/tailor` (`action: split | generate | revise | rescore`) —
  one Vercel function slot (cap is 12, repo at ~8).
- Raw `@anthropic-ai/sdk`, native structured outputs (`output_config.format`), one stable
  schema across the loop (schema changes invalidate prompt cache).
- Split = verbatim-quote labeling (LangExtract pattern): LLM returns heading quotes,
  offsets computed locally; body text never regenerated. `join(sections) ≈ source`
  asserted deterministically.
- Generation prompt receives ONLY: JD skills + user-confirmed claims + section original
  text, in a prompt-cached prefix. Honesty rests on the closed evidence set plus the human
  reading each section before approval ("the human is the entailment checker").
- Export: client-side `docx` (dolanmiu) build from a single house template — zero function
  slots, no layout reuse.
- Re-score via existing `matchJob()`; delta displayed as directional, never fed back into
  generation (Goodhart guard).

**Trade-offs**
- Pros: smallest surface; fewest LLM calls (1 split + 1 per section + revisions); fastest
  to notebook-verify; every piece reused by B later.
- Cons: fabrication guard is procedural, not mechanical — a tired click-through user
  approves whatever's plausible (research: category-wide failure mode is *plausible*
  invented metrics); no audit trail of claim→sentence mapping; output layout is the house
  template, not the user's résumé.

**Does NOT do:** machine verification of any kind, claim→bullet provenance, layout
preservation, streaming section cards, cover letters.

**Cost / risk / effort:** LLM cost trivial with caching (~$0.05–0.15/résumé at Sonnet-tier
generation). Risk low — all components verified in research. Effort: **S–M** (≈ the UI is
most of the work).

**Domains:** `llm-engineering` (prompting, caching, structured output), light
`ai-agent-engineering`.

---

## Approach B — Provenance Pipeline ★ recommended

**One line:** Approach A's skeleton + machine-checkable honesty — every generated sentence
carries claim IDs, deterministic guards and a cheap entailment judge gate display.

**How it works** — everything in A, plus:
- Output schema requires `claim_ids: []` per generated bullet/sentence; a bullet citing no
  claim, or a nonexistent claim ID, is rejected before render (code assertion, no LLM).
- **Digit-diff guard:** any number in output absent from the input claims → automatic flag
  (regex; catches the dominant documented failure, invented metrics, for free).
- **Entailment judge:** one Haiku-tier call per section — binary "is every fact in X
  entailed by claims Y?" (binary pass/fail per eval research; NLI models like MiniCheck are
  Python-only, so LLM-judge is the in-request option). Fail → auto-regenerate once with the
  judge's objection appended after the cached prefix; fail again → surface to user marked
  unverified.
- Revision notes appended after the cached prefix (never interpolated in), scoped to the
  section's regenerate call only — phrasing-only constraint enforced by the same claim-ID
  validation on the revised output.
- UI gains a provenance affordance: tap a bullet → highlights the claims it cites (the
  Grammarly-Authorship-style differentiator; data is already there from `claim_ids`).
- Offline eval (later, not v1-blocking): golden set of (résumé, JD, claims) triples;
  code assertions first, judge metric second — Hamel playbook.

**Trade-offs**
- Pros: the honesty guarantee is the product (research takeaway 1) and nothing on the
  market has it; guards are mostly deterministic code, cheap and testable; judge adds
  ~$0.01/section; audit trail falls out for free; A→B is additive, so a partial retreat
  still ships A.
- Cons: more moving parts to test (validator, judge loop, regeneration path); judge is
  itself an LLM — calibration needed (start permissive, tighten on real failures);
  sentence↔claim granularity needs one design decision (per-bullet is the pragmatic unit).

**Does NOT do:** layout preservation (house template, same as A), NLI-model verification
in-request (Python-only — offline eval when it matters), streaming structured objects,
cover letters, auto-approval of anything.

**Cost / risk / effort:** LLM cost ≈ A + one Haiku call per section (negligible). Risk
medium-low — the layered stack is assembled from individually-sourced components, not a
copied proven system (research gap, flagged). Effort: **M** (A + ~validator module + judge
prompt + one retry path).

**Domains:** `llm-engineering` (grounding, judge, evals) + `ai-agent-engineering`
(multi-step orchestration, gate design).

---

## Approach C — Layout-Faithful Template Build

**One line:** spend the effort on output fidelity — convert the user's base résumé into a
placeholder .docx template once, fill it per generation; verification stays at A's level.

**How it works**
- Same dispatcher + split + closed-world generation as A.
- One-time guided conversion: user's base résumé is reconstructed as a real .docx template
  with `{{placeholders}}` (docxtemplater loops for repeated bullets/sections). Requires a
  .docx source — the stored base résumé is a **PDF**, so this means a manual or assisted
  re-authoring step in Word first.
- Per generation: server (or client) fills the template with approved section content —
  output keeps the user's own fonts, spacing, layout exactly.
- Alternative middle path if the template proves brittle: `docx`'s `patchDocument` with
  `keepOriginalStyles` on the pre-tokenized file.

**Trade-offs**
- Pros: output *looks like the user's actual résumé* — highest perceived quality per
  research on recruiter reaction to template-mangled output; template editable in Word by
  a human; docxtemplater is 8+ years maintained.
- Cons: research verdict is that arbitrary layout preservation is a known-hard problem —
  the one-time conversion is manual, brittle across résumé revisions, and blocks on a
  .docx that doesn't exist yet (PDF source); honesty layer stays procedural (A-level);
  the plan explicitly scoped formatting out ("reuse existing formatting as-is; only
  content changes" was aspiration, not architecture); docxtemplater image/HTML modules are
  paid if ever needed; user-uploaded templates carry a documented injection risk if the
  template mechanism is ever exposed server-side (docx-templates class of issue).
- YAGNI verdict: fidelity is real value but it's *presentation* value — deliverable is
  "editable .docx", which A/B's house template already satisfies. Defer.

**Does NOT do:** machine-checkable provenance, PDF-source handling (needs manual Word
re-authoring), multi-style themes, cover letters.

**Cost / risk / effort:** LLM cost = A. Risk medium-high (conversion brittleness, PDF
source gap). Effort: **M–L**, with the L concentrated in template conversion edge cases.

**Domains:** `llm-engineering` (same as A) + document-tooling work outside sigma's
configured domains.

---

## Decision points the human owns

1. **Pick A, B, or C** (recommendation: B).
2. If B: per-bullet vs per-sentence claim granularity (recommendation: per-bullet for v1).
3. Judge failure UX: block render vs render-with-unverified-badge after one auto-retry
   (recommendation: badge — fail-visible beats fail-closed for a single-user tool).
4. House template look: derive one clean single-column template from the current résumé's
   content (single-column also parses best in ATS — 88–96% vs 46–71% two-column).

## Next

→ `/blueprint` once an approach is picked.
