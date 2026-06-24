# Daytona De-Risk Checklist — prove the live drop-in round-trip (OPTIONAL, sponsor stretch)

This is **optional** prep for the Daytona sponsor showcase: the live "drop in a screenshot →
parse it on demand" feature. The goal is to prove the **whole round-trip with a hello-world
before the day**, so the only day-of work is swapping the trivial script for the real
extraction. If you run out of time or it won't cooperate, you lose nothing — the core project
(static dashboard + live URL) does not depend on this. **Timebox it to ~1–2 hours.**

The round-trip you're proving:
```
Browser (live site)
  → POST to /api/extract        (Vercel serverless function — same repo, holds the secrets)
     → Daytona SDK: create a sandbox, run Python in it, read the output
  ← returns the output as JSON
Page shows the output
```
Build it in slices, **innermost first**, so each slice is verifiable on its own.

> ⚠️ **Honesty note:** Daytona's SDK details change, and their core repo went private in
> June 2026. Use their **current docs** (daytona.io/docs) for exact SDK calls — don't build
> against remembered or AI-guessed signatures. Verify each step by actually running it.

---

## Part 0 — Account + key
- [ ] Sign up at daytona.io, **or** use sponsor-provided access — ask the organizers; sponsors
  often hand out keys/credits at the event, but get it earlier if you can.
- [ ] Get a **Daytona API key**. **Done when:** you have the key saved somewhere safe (not committed).
- [ ] Skim the Daytona quickstart + SDK docs. Note the exact calls to **create a sandbox**,
  **run code/a process** in it, and **read its output**. **Done when:** you can name the 3–4 SDK
  calls you'll use.

## Part 1 — Daytona hello-world, run LOCALLY first (isolate the new thing)
- [ ] In a scratch script (Node/TypeScript is the natural fit for a Vercel function), use the
  Daytona SDK to: create a sandbox, run `print("hi from daytona")` (or `console.log`), read the
  output, print it to your terminal.
- **Done when:** you run the script on your laptop and see the sandbox's output. This proves
  auth + sandbox + run + read, with nothing else in the way.

## Part 2 — Wrap it in a Vercel serverless function
- [ ] Create `dashboard/api/extract.js` (Vercel auto-detects the `api/` folder under the root
  directory). Move the Daytona call into it; return the sandbox output as JSON.
- [ ] Test with `vercel dev` locally, or deploy and hit the URL.
- **Done when:** hitting `/api/extract` returns the output as JSON, e.g. `{"output":"hi from daytona"}`.

## Part 3 — Secrets via Vercel env vars
- [ ] Put `DAYTONA_API_KEY` (and your model API key, for later) in Vercel →
  Project → Settings → Environment Variables. Remove any hard-coded key from the function.
- [ ] Redeploy.
- **Done when:** the deployed `/api/extract` still works reading the key from the env var, and
  `git status` shows no secret committed.

## Part 4 — Front-end ping (full round-trip)
- [ ] Add a temporary button to the React app that calls `/api/extract` and shows the returned text.
- **Done when:** clicking the button on your **live Vercel URL** shows the sandbox output. The
  whole path is proven.

---

## Done = ready for the day
On the day, the live drop-in becomes just two swaps on top of this proven plumbing:
1. Replace the trivial script with the **real extraction** (vision call + Pydantic schema)
   running in the sandbox.
2. Replace the button with a **file-upload input** that sends the screenshot.
Everything between (function, Daytona call, secrets, front-end wiring) already works.

## Open questions to resolve during de-risk (note answers in DECISIONS.md)
- How do the extraction code + its deps (`anthropic`/`openai`, `pydantic`) get into the
  sandbox — inline code string, a pre-baked snapshot/image, or install-on-boot? Pick the
  simplest that works.
- How does the **model API key** reach the code running *inside* the sandbox? (Pass it via the
  sandbox's env/params.)
- Is the sandbox cold-start + extraction latency acceptable for a live demo? (Aim for a few seconds.)

## Guardrails
- **Optional and gated.** The core project (static dashboard + live URL) must never depend on this.
- **Timebox ~1–2h.** If the round-trip isn't working by then, drop the Daytona showcase. Optional
  lighter fallback: run the *offline batch* extraction through a Daytona sandbox — a weaker story,
  but still genuine sponsor usage that doesn't risk the live URL.
- **Current docs only** for SDK specifics. Don't build on guessed API calls.
