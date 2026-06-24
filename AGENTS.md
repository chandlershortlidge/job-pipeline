# AGENTS.md — job-pipeline (sprint variant)

This is the scaled-down harness for a time-boxed solo build. It covers only *how to work* — verify, test, commit, when to check in. **Scope, build order, architecture, and the data contract live in the planning doc (`jd-aggregator-sprint-plan.md`), not here.** If you need to know what to build or in what order, read that. This file is how to build it.

What's deliberately dropped for this sprint (do not reintroduce): the full written-plan ritual, the handoff ceremony, module-promotion with docstrings/layout rules, and comprehensive test coverage. Keep only what's below. (One exception, added mid-project: a lightweight `DECISIONS.md` log **is** kept — see "Decision log" below.)

## Who you're working with
I think clearly about systems and specify precisely, but I do **not** verify code by reading it line by line. I verify by *behavior*: by running things, checking outputs on real inputs, and reading your plain-English account of what the code does against what I asked for. So, always:

- Explain what your code does in plain English, not just by handing over code.
- Show outputs on real inputs whenever you can, and say what they mean.
- Leave behavior inspectable — print the intermediate values that let me see what actually happened, especially around the LLM calls and the normalization step.
- If your explanation and your code don't match, stop and resolve it — don't paper over it.
- You are not the authority. You produce a recommendation; I evaluate it. Expect to be questioned, and treat that as normal.

## Verify load-bearing code before trusting it
Extraction and skill-normalization are load-bearing: a wrong result there is hard to spot by eye and sinks the whole demo. For that code, before it's trusted: run it on **real screenshots** (not invented input), print meaningful output at each step, and explain in plain English what the output means and what to expect. I check three things against each other — the output, my expectation, and your explanation. If they line up, it's good. If not, expect a specific question first.

This does **not** apply to UI, glue, or wiring code — build that directly.

## Testing
No test suite this sprint; verification is by eyeballing output on real inputs, per above. The one rule that still holds: **if you write any test, mock the LLM call — never make a live one.**

## Commits
Commit at each working checkpoint, so there's always a working state to roll back to — you have standing permission to do this, don't wait to be asked. Keep each commit to one logical thing, and say in a line what it contains. Don't bundle unrelated cleanup into a commit because you noticed it while working — mention it instead.

## Decision log (DECISIONS.md)
Keep `DECISIONS.md` (repo root) current as you work. This is the one record-keeping habit kept for this sprint — do it **silently and proactively**, never as a thing we stop to discuss on the day.

**Do not narrate it.** Don't write "I added to DECISIONS.md, here's why" in your reply — that burns my time mid-event. Just write the entry and fold it into the same commit as the change it documents. I'll read the log when *I* choose to, not in your chat output; the commit line is enough of a signal.

**When to add an entry — over-share, don't under-share. When in doubt, log it.** Add one whenever you:
- chose between approaches, or made a trade-off;
- tried something that didn't work (so it isn't retried later);
- changed the data model, schema, extraction, normalization, or deploy setup;
- picked a default, threshold, or number someone might later wonder about;
- hit a gotcha worth not rediscovering.

Skip it only for pure mechanical edits with no judgment (typos, formatting) or things already obvious from the diff.

**How:** newest entry first; stamp it with the real time (`date`, or the git commit time — don't guess); a few plain-English lines I can read; include what you tried and what failed when it's relevant.

## Honesty (applies every turn)
- Before claiming a function, import, or symbol exists, verify it by reading the file or grepping. Never fabricate symbols.
- Don't claim a script, test, or build succeeded unless you actually ran it this session.
- Never invent error messages, API responses, or outputs. If you didn't see it, say so.
- "I haven't verified this," "I don't know," and "I need to check first" are all correct answers and are preferred over a confident guess. If a guess is load-bearing, don't write code on top of it.

## Review & pushback
There's no formal review pass this sprint — no time for it. Verification is the eyeball-on-output already described above: I'm watching the printed output of the load-bearing code as it runs and reacting when the numbers don't match what I expected. That's the whole check.

The one active guard that still matters, because solo there's no one else to catch it: **scope drift.** If the work grows past what the planning doc scoped — a panel, feature, or abstraction that isn't in v0 — stop and flag it before building, don't absorb it. Surfacing it is enough; I decide whether it's in.

## Reporting work to the person
When reporting what you did, lead with: what it does, and whether it works (tests pass? ran clean?). Keep it plain.

- Assume the person does not know tooling/type-checker jargon (pyright, cast, type stubs, SimpleNamespace, etc.). Don't explain these unless asked.
- Tooling internals (linter quirks, type-checker workarounds, mocking mechanics) get at most a ONE-LINE flag — "had to work around a LiteLLM type-stub quirk, not a logic bug" — not a paragraph.
- If you went down a side-track (typing, config plumbing), don't narrate the whole detour. State the outcome.
- Plain English over precision-jargon. If a thing matters for a decision the person makes, explain it at a level they can act on. If it doesn't, leave it out.
