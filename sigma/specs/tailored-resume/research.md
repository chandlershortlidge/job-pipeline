# Research: Tailored-Résumé Feature (deep, web-grounded)

- **Date:** 2026-07-13
- **Depth:** deep (every researcher web-grounded, multiple searches per theme, cross-checked)
- **Researchers run:** claude-researcher (reasoning/code lens), gemini-researcher (breadth/freshness lens), gpt-researcher (structured-output/ecosystem lens) — all three returned findings; none came back empty.
- **Downstream of:** `tailored-resume-plan.md` (existing plan; this research pressure-tests and informs it before `/propose`)

## Executive summary

The plan's core design bet — **human-confirmed atomic claims as the only generation evidence** — is strongly validated: an independent 2026 test found *all six* major commercial AI résumé tools (Rezi, Teal, Jobscan, Kickresume, Resume.io, Enhancv) fabricate metrics when asked to "improve" bullets, and no surveyed product ships claim verification or provenance. Prompt-only "rephrase, don't invent" constraints demonstrably fail; the architecture that holds up is closed-world evidence + machine-checkable provenance (`claim_ids` per bullet) + cheap post-hoc entailment gating. Section splitting should be a *labeling* problem (verbatim quotes anchored by string match), never regeneration — then splitting cannot hallucinate. For the stack: one dispatcher route (`POST /api/tailor?action=…`) fits the near-full Vercel 12-function cap, per-section calls are the textbook prompt-caching case (one large stable prefix, ~90% input-cost reduction), and .docx export can run fully client-side (zero function slots). One plan-level caution: the before/after `matchJob()` score is a Goodhart target — keep it as a report, never in the generation loop; claim-grounding is itself the anti-stuffing guardrail. Regulatory pressure (EU AI Act, NYC LL144) lands on employer-side screening tools, not candidate-side tailoring; the honesty posture matches the emerging "human first draft + AI polish" employer norm (Anthropic's own candidate guidance).

## Themed findings

### 1. Fabrication is the category-wide defect — the atomic-claim design is the differentiator

- A 2026 six-tool test (fixed candidate profile) found **every** tested AI bullet generator injected fictional metrics — "reducing latency by 67%", invented team sizes, cloud providers — with no verification against any source. Found independently by two researchers; both fetched the source [atsverification.com](https://atsverification.com/blog/ai-resume-builders-tested-2026/). *Caveat: one unreplicated test; the fabrication direction is corroborated by Reddit/VisualCV sentiment ([visualcv.com](https://www.visualcv.com/blog/best-ai-resume-builders-reddit/)) and [Big Interview's own hallucination disclosure](https://support.biginterview.com/en/article/does-your-ai-ever-generate-inaccurate-or-misleading-content-ie-hallucinate-1sfui3z/).*
- Constrained decoding / JSON schema constrains **form, not truth** — "a confident lie wrapped in valid syntax" ([rotascale.com](https://rotascale.com/blog/structured-output-isnt-reliable-output/)). Required schema fields *elicit* fabrication; make splitter fields nullable so absence is expressible ([techsy.io](https://techsy.io/en/blog/llm-structured-outputs-guide)).
- The only commercial guardrail found is Kickresume-style **input restriction** (generate only from profile data) — same closed-world principle as the plan's claim checklist, but weaker: no provenance, no verification ([qwyse.com](https://www.qwyse.com/hub/compare/best-ai-resume-builders/) — single-source).
- The architecture the literature supports (synthesis, cross-researcher): (a) user-confirmed atomic claims are the *only* evidence in the generation prompt; (b) output schema requires `claim_ids: []` per bullet — provenance becomes machine-checkable; (c) post-hoc entailment gate — MiniCheck-class checker matches GPT-4 accuracy at ~1/400th cost ([arXiv 2404.10774](https://arxiv.org/abs/2404.10774)), or a cheap Claude (Haiku-tier) judge call per bullet; (d) regex digit-diff: any number in output absent from input claims = automatic flag. *No single source prescribes this stack end-to-end; components individually sourced.*
- **Runtime caveat** (gpt-researcher): the open-source NLI checkers (MiniCheck, Vectara HHEM-2.1, AlignScore, RAGAS, DeepEval) are all Python/PyTorch — not runnable in a Vercel Node function. In-request verification = LLM-judge call; NLI models = offline eval/CI only.
- Confidence: **high** on "prompt-only fails" and the fabrication failure mode (multi-source, empirical); **medium** on the layered stack as a whole (synthesis, nowhere benchmarked end-to-end).

### 2. Section splitting: label, don't regenerate

- Reference OSS parser [OpenResume](https://github.com/xitanggg/open-resume) is entirely heuristic (bold/uppercase heading detection, nearest-heading line assignment) — brittle, single-column-English-only. The steal-worthy frame: **section boundaries are a labeling problem over existing lines**; an LLM replaces the heading heuristic, the body text is never regenerated, so splitting cannot introduce hallucination. (claude + gemini researchers, independently.)
- LLMs cannot reliably emit character offsets. Working pattern (Google [LangExtract](https://github.com/google/langextract), found by two researchers): LLM returns **verbatim quotes** (heading line + first line per section) → offsets computed locally by exact match, fuzzy fallback ~0.85 ([shanechang.com](https://shanechang.com/p/demystifying-text-anchoring-langextract/), [arXiv span-labeling](https://arxiv.org/pdf/2601.16946)). Deterministic validation: `sections.join() ≈ source`.
- Anthropic structured outputs (GA, `output_config.format`, grammar-constrained): no recursive schemas, no min/max, `additionalProperties: false` mandatory; SDKs `messages.parse()` + `zodOutputFormat()`; schema-guarantee bypasses to handle explicitly: `stop_reason: "refusal"` and `"max_tokens"` (truncated JSON) ([platform.claude.com structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)). **Cache interaction:** changing `output_config.format` invalidates the prompt cache — use ONE stable schema across the section loop, not per-section schemas (gpt-researcher; single-source but from official docs).
- Accuracy landscape: rule-based parsers ~65–70% field accuracy; LLM-era vendor claims 92–95% F1, real-world lower ([thehirehub.ai](https://www.thehirehub.ai/blog/ai-resume-parsing-in-2026-how-it-works-how-accurate-it-actually-is-and-what-breaks-it) — single-source numbers). Peer-reviewed anchor: layout normalization *before* LLM extraction is the accuracy lever; the extractor LLM can be tiny (0.6B, deployed at Alibaba) ([arXiv 2510.09722](https://arxiv.org/abs/2510.09722)). No public résumé-section-splitting benchmark exists (absence-of-evidence, two researchers).
- Confidence: **high** on quote-then-anchor technique and structured-output mechanics; **medium** on accuracy percentages.

### 3. Match score: useful report, dangerous target

- ATS auto-rejection is mostly myth: survey of 25 US recruiters — 92% say their ATS does NOT auto-reject on content; knockout questions are the only true auto-reject; the real killer is **parse failure** (a badly parsed résumé never surfaces in recruiter search) ([enhancv.com](https://enhancv.com/blog/does-ats-reject-resumes/)). The viral "75% rejected by ATS" stat traces to a 2012 sales pitch by a company defunct since 2013 ([resumeadapter.com](https://www.resumeadapter.com/ats-statistics)).
- Keyword stuffing is counterproductive on two levels: recruiters spot it immediately (76% warn against it, same survey); Jobscan's own guidance is ~75–80% match target, not 100% ([jobscan.co](https://www.jobscan.co/blog/resume-keyword-stuffing/)). Single-column layouts parse 88–96% vs 46–71% for two-column/design-first (atsverification — single-source percentages, flagged).
- Optimizing generation against the fixed `matchJob()` scorer is classic **Goodhart/reward-hacking**; documented mitigation is keeping the metric out of the generation loop — report, not target ([Lilian Weng, reward hacking](https://lilianweng.github.io/posts/2024-11-28-reward-hacking/), [arXiv 2506.19248](https://arxiv.org/pdf/2506.19248)). Claim-grounding is itself the strongest anti-stuffing guard: the score can only improve via skills/claims the user actually confirmed (gpt-researcher inference, consistent with plan pitfall "a rising score is not proof of honesty").
- Skill taxonomies if ever needed beyond the existing canonical map: ESCO (~13k skills, fully open), Lightcast Open Skills (~33k, registration required) ([lightcast.io](https://lightcast.io/open-skills/faqs)); ESCO-linking remains an open research problem ([arXiv 2307.03539](https://arxiv.org/abs/2307.03539)).
- Confidence: **high** on the no-auto-reject + anti-stuffing consensus; **low** on any individual 2026 adoption/detection percentage (SEO stat-farm provenance, trend reliable, figures not).

### 4. Stack architecture: one dispatcher route, prompt caching, client-side docx

- **Function cap:** Hobby = 12 functions, every `api/*.js` file counts (repo already at ~8/12, already hit this once — commit 3ec84ab). Verified consolidation pattern: **one dispatcher** — `POST /api/tailor` with `action: split | generate | revise | rescore` — costs one slot ([Vercel community](https://community.vercel.com/t/error-no-more-than-12-serverless-functions-can-be-added-to-a-deployment-on-the-hobby-plan-create-a-team-pro-plan-to-deploy-more-learn-more-https-vercel-link-function-count-limit/410), [limits docs](https://vercel.com/docs/functions/limitations)). (claude + gpt researchers, independently.)
- **Duration:** with Fluid Compute, Hobby max duration 300s; awaiting-LLM I/O doesn't count as active CPU; stream responses ([vercel.com/docs/functions/limitations](https://vercel.com/docs/functions/limitations), fetched 2026-07). One researcher flagged conflicting 60s figures — those are pre-Fluid; **verify Fluid is enabled** on this project since it predates the default.
- **Prompt caching** — the section loop is the textbook case: stable prefix (base résumé + JD + confirmed claims, breakpoint) + per-section instruction after it. Reads ~0.1× input price; 5-min TTL means a >5-min human think-pause between sections = cold rewrite (1-hr TTL costs 2× write but survives a review session). Silent invalidators: timestamps/UUIDs in prefix, unsorted JSON, revision notes interpolated *into* the prefix instead of appended after ([platform.claude.com prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
- **No durable orchestration needed** (gpt-researcher inference, sound): the approve/revise UI *is* the orchestrator — each step is a short human-triggered request; state lives in Supabase. Workflow DevKit / Inngest are available if that changes ([vercel.com/blog/introducing-workflow](https://vercel.com/blog/introducing-workflow)) — whether WDK consumes Hobby function slots is **unverified**.
- **Streaming structured UI:** Vercel AI SDK `streamObject` + `useObject` streams schema-shaped partials into React ([vercel.com/blog/vercel-ai-sdk-3-3](https://vercel.com/blog/vercel-ai-sdk-3-3)); simpler alternative that fits the approval gate: one plain streamed call per section. **Unverified:** whether AI SDK's Anthropic provider uses native `output_config` constrained decoding or tool-based extraction — check before choosing AI SDK vs raw SDK.
- **Model tiers** (pricing from official docs, 2026-06): Haiku 4.5 $1/$5 per MTok, Sonnet 4.6/5 $3/$15, Opus 4.8 $5/$25. Fit: split = runs once, mid-tier fine; generate/revise = quality-critical user-facing, top tier; entailment judge = Haiku-tier with strict schema. Batch API (50% off, stacks with cache reads) is async up to 24h — offline eval only, not the interactive loop.
- Confidence: **high** (official docs + primary sources throughout).

### 5. Docx export

Maintenance status verified against npm registry directly (gemini-researcher, July 2026):

| Library | Version / published | Status | Fit |
|---|---|---|---|
| `docx` (dolanmiu) | 9.7.1, 2026-05 | active, ~12M wk downloads | programmatic build; **runs in browser** → zero function slots |
| `docxtemplater` | 3.69.0, 2026-06 | active 8+ yrs | template-fill; images/HTML modules paid |
| `@turbodocx/html-to-docx` | 1.22.0, 2026-06 | active fork | html→docx path |
| `html-to-docx` (orig) | 1.8.0, 2023 | dead | avoid |
| `officegen` | 0.6.5, 2021 | abandoned | avoid |
| `mammoth` | 1.12.0, 2026-03 | active | **one-directional** (docx→HTML); own docs rule out round-trip editing |

- Trade-off consensus (all three researchers): template-fill wins when a designer controls layout and content is slot-shaped; programmatic `docx` wins for variable structure (unknown section/bullet counts — the résumé case). Middle path found by gpt-researcher: `docx`'s **`patchDocument`** replaces `{{tokens}}` in an *existing* .docx with `keepOriginalStyles` ([docx.js.org patchDocument](https://docx.js.org/api/functions/patchDocument.html)).
- **Hard truth on "reuse existing résumé formatting as-is" (plan line):** arbitrary in-place content replacement in an uploaded .docx is a known hard problem — text splits across `<w:r>` runs, breaking naive replacement; no established Node library for non-placeholder replacement surfaced. Feasible paths: (1) one-time convert the base résumé into a `{{placeholder}}` template, then template-fill per generation; (2) own house template + programmatic build. True arbitrary-layout preservation: no off-the-shelf solution found. Also: the stored base résumé is a **PDF**, not .docx — layout "reuse" means re-creation regardless (project-context note, not researched).
- `docx-templates` has a documented code-injection risk with user-uploaded templates — avoid that combination server-side ([npm docx-templates](https://www.npmjs.com/package/docx-templates)).
- Confidence: **high** on library facts; **medium** on editability quality (no rigorous head-to-head exists).

### 6. Section-approval UX

- Closest published pattern: Shape of AI **Inline Action** — AI output as a suggestion layer, never an overwrite; explicit accept/reject/refine; scope granularity chosen *before* invoking; "see how this was changed" view for factual edits. Implementations cited: GitHub Copilot, Atlassian Intelligence, Figma Make ([shapeof.ai/patterns/inline-action](https://www.shapeof.ai/patterns/inline-action)).
- Anti-rubber-stamp: reject must be as low-friction as approve — "if reject is buried, you have a spectator, not an approver" ([aiuxdesign.guide](https://www.aiuxdesign.guide/patterns/human-in-the-loop), fetched by two researchers). Route by risk: pre-approve verbatim-carryover sections (contact, education); reserve the full loop for rewritten experience/project bullets.
- Show minimum decision context per item: the input, a 1–2 sentence reason, confidence. Grammarly's 2025 **Authorship** (provenance tracking of human vs AI text in Word) is prior art for the honesty angle ([grammarly support](https://support.grammarly.com/hc/en-us/articles/38552281546765)).
- Pills/editable chips for accept-or-modify maps directly to the planned skill-gap confirmation ([thedesignsystem.guide](https://thedesignsystem.guide/blog/ai-ux-patterns-for-design-systems-(part-1))).
- **Genuine gap:** no prior art found (two researchers, independently) on *scoping revision notes to a section*. Design inference: attach the note only to that section's regenerate call + frozen claim evidence, appended after the cached prefix, never into global chat history — idempotent and cache-friendly. Novel ground.
- Confidence: **medium-high** on patterns (design literature, not empirical research); **low** on revision-note scoping (no sources exist).

### 7. Prior art, legal, and norms

- **ResumeLM** ([github.com/olyaiy/resume-lm](https://github.com/olyaiy/resume-lm)) — OSS, nearly this stack (Next.js + Supabase): base-vs-tailored two-tier data model, JSONB section configs, React-PDF export. No claim verification — grounding is "suggestions based on your experience." Worth reading for schema shape; the claim/provenance layer would exceed everything surveyed, commercial or OSS.
- **Jobscan match-score backlash**: opaque score, users at 80%+ with zero callbacks, BBB C-; "not the same score an ATS would give" — a warning for how to *present* the before/after number (directional, not absolute).
- **EU AI Act**: employment AI is Annex III high-risk, but compliance deferred to **2 Dec 2027** (Digital Omnibus, Council approved 2026-06-29) — and it regulates **employer-side** AI; a candidate-side tailoring tool is not Annex III high-risk ([DLA Piper](https://knowledge.dlapiper.com/dlapiperknowledge/globalemploymentlatestdevelopments/2026/The-Digital-AI-Omnibus-Proposed-deferral-of-high-risk-AI-obligations-under-the-AI-Act)). NYC LL144: Dec 2025 state audit found enforcement "ineffective"; stricter phase expected ([osc.ny.gov](https://www.osc.ny.gov/state-agencies/audits/2025/12/02/enforcement-local-law-144-automated-employment-decision-tools)). *Inference: regulatory risk for this feature ≈ nil; the pressure is on ATS vendors.*
- **Employer norms**: Anthropic's own candidate policy U-turned (Feb 2025 "no AI" → Jul 2025 "own first draft, AI to refine; none in interviews" — [fortune.com](https://fortune.com/2025/07/21/billion-dollar-giant-anthropic-ai-ban-hiring-policy-change-job-seekers-interview-process/), [anthropic.com/candidate-ai-guidance](https://www.anthropic.com/candidate-ai-guidance)). The plan's posture (human-confirmed claims, rephrase-only, human approval per section) operationalizes exactly this norm. Survey-farm stats (62% of employers reject unpersonalized AI résumés, etc.): trend credible, individual figures low-confidence.
- **Eval strategy** (Hamel Husain, fetched — [hamel.dev/blog/posts/evals-faq](https://hamel.dev/blog/posts/evals-faq/)): binary pass/fail over Likert; error analysis before infrastructure (~100 traces saturates failure categories); code assertions first (schema compliance, every-bullet-cites-a-claim-id, digit-diff), one calibrated LLM-judge metric ("every sentence entailed by a claim"); evaluate end-to-end first, per-step only where it fails. The existing `matchJob()` scorer is the free code-based regression tier; golden set = 25–50 (résumé, JD, approved-claims) triples grown from real failures.

## Per-researcher contributions

- **claude-researcher** (276k tokens, 23 tool uses): deepest on anti-hallucination architecture (MiniCheck, Deterministic Quoting, quote-then-anchor), prompt-caching mechanics + TTL-vs-human-pause interaction, model-tier mapping. Fetched Vercel limits + atsverification directly.
- **gemini-researcher** (69k tokens, 28 tool uses): freshness wins — npm registry primary data (maintenance table), ATS-myth debunk with recruiter survey, full legal sweep (EU AI Act deferral, LL144 audit, state laws), Anthropic candidate-policy timeline, Careerflow/FinalRound complaint clusters.
- **gpt-researcher** (68k tokens, 27 tool uses): structured-output specifics (schema limits, cache invalidation by schema change, refusal/max_tokens bypasses), `patchDocument` middle path, ResumeLM discovery, Python-only NLI runtime caveat, Goodhart framing, Hamel eval playbook.

## Key takeaways

1. **The claim-checklist design is the product.** Every commercial tool fabricates; none ship provenance. Add `claim_ids` per bullet to the output schema + digit-diff + cheap entailment judge, and the honesty guarantee becomes machine-checkable instead of prompt-hoped.
2. **Split by labeling, not regeneration** — verbatim quotes anchored by local string match; nullable schema fields; validate `join(sections) ≈ source` deterministically.
3. **One dispatcher route** (`/api/tailor`, action discriminator) — the 12-function cap makes per-step routes a non-starter; docx export can go client-side for zero slots.
4. **Prompt-cache the loop**: stable prefix (résumé + JD + claims), one stable output schema (schema changes invalidate cache), revision notes appended after the prefix; consider 1-hr TTL for human-paced review.
5. **`matchJob()` = report, not target** (Goodhart). Present the before/after delta as directional; never feed the scorer into generation.
6. **"Reuse existing formatting as-is" needs a decision**: placeholder-template conversion (once) vs house template — arbitrary layout preservation of an uploaded file has no off-the-shelf solution; base résumé is stored as PDF anyway.
7. **Two novel-ground areas** (no prior art exists — design freedom, but nothing to lean on): end-to-end rephrase-only fidelity benchmarking; section-scoped revision notes.

## Gaps / unverified (carry into /propose)

- Whether Vercel AI SDK's Anthropic provider uses native `output_config` constrained decoding (affects AI SDK vs raw `@anthropic-ai/sdk` choice).
- Whether Workflow DevKit consumes Hobby function slots (moot if the UI-as-orchestrator inference holds).
- Fluid Compute enabled on this project? (predates the default; 300s vs legacy 60s ceiling).
- Six-tool fabrication test and parse-rate percentages: single unreplicated test (direction corroborated, numbers not).
- No first-party engineering writeup exists from any team shipping claim-verified résumé generation — the whole verification layer is assembled from components, not copied from a proven system.
- All NLI/faithfulness tooling is Python — in-request verification must be an LLM-judge call; NLI models are offline-eval only.

## Source list (deduped, by theme)

**Fabrication / grounding:** atsverification.com/blog/ai-resume-builders-tested-2026 · rotascale.com/blog/structured-output-isnt-reliable-output · arxiv.org/abs/2404.10774 (MiniCheck) · mattyyeung.github.io/deterministic-quoting · huggingface.co/vectara/hallucination_evaluation_model · arxiv.org/pdf/2505.21786 (VeriTrail) · techsy.io/en/blog/llm-structured-outputs-guide
**Splitting / structured output:** github.com/xitanggg/open-resume · shanechang.com/p/demystifying-text-anchoring-langextract · github.com/google/langextract · platform.claude.com/docs/en/build-with-claude/structured-outputs · arxiv.org/abs/2510.09722 · arxiv.org/pdf/2601.16946
**ATS / matching:** enhancv.com/blog/does-ats-reject-resumes · resumeadapter.com/ats-statistics · jobscan.co/blog/resume-keyword-stuffing · lilianweng.github.io/posts/2024-11-28-reward-hacking · arxiv.org/abs/2307.03539 · lightcast.io/open-skills/faqs
**Stack:** vercel.com/docs/functions/limitations · community.vercel.com (function-count-limit thread) · platform.claude.com/docs/en/build-with-claude/prompt-caching · vercel.com/blog/vercel-ai-sdk-3-3 · vercel.com/blog/introducing-workflow · platform.claude.com/docs/en/pricing.md
**Docx:** npmjs.com/package/docx · github.com/open-xml-templating/docxtemplater · docx.js.org/api/functions/patchDocument.html · npmjs.com/package/mammoth · npmjs.com/package/docx-templates
**UX:** shapeof.ai/patterns/inline-action · aiuxdesign.guide/patterns/human-in-the-loop · support.grammarly.com (Authorship) · thedesignsystem.guide (AI UX patterns pt 1)
**Prior art / legal / norms:** github.com/olyaiy/resume-lm · knowledge.dlapiper.com (Digital Omnibus deferral) · osc.ny.gov (LL144 audit) · fortune.com (Anthropic candidate policy, Feb + Jul 2025) · anthropic.com/candidate-ai-guidance · hamel.dev/blog/posts/evals-faq
