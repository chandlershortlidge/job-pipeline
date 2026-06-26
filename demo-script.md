# Demo Script — ~2-minute live pitch

The event is judged on **live demos + pitches**, so this is as important as the build. Know the
**three beats**, not the words — reading a script reads as nervous; hitting beats reads as confident.

## The beats (memorize these)
1. **The problem → the question:** job descriptions are a mess; *what is the market actually prioritizing?*
2. **The chart is the answer — and the "merged from" reveal proves it's real extraction**, not word-counting.
3. **The live drop-in proves the pipeline runs for real** (in a Daytona sandbox).
4. **The résumé match flips the question to *you*:** upload your résumé → see which jobs you fit, and
   watch the match % jump when you swap a generic résumé for a tailored one. This is the strongest,
   most personal moment — and it bridges straight into the part-2 vision. Close there.

---

## Full script (~2 min)
*(URL already open on the dashboard — never navigate or live-type during a demo. Swap in whatever skills are actually on your screen.)*

**Hook (~15s)**
> "If you're job-hunting in AI right now, you're staring at dozens of job descriptions trying to
> figure out what to actually learn. The signal — what the market really wants — is buried in messy,
> inconsistent postings. So I built something that reads them for you."

**What it is (~10s)**
> "This is the JD Skills Aggregator. I fed it about 20 real job-description screenshots, and it
> answers one question, visually: what is the job market prioritizing?"

**Demo — stats + chart (~20s)**
> [gesture to stats] "20 jobs, 30-some skills, a dozen companies — all pulled from raw screenshots."
> [gesture to chart] "And here's the answer: skills ranked by how many jobs ask for them — Python,
> LLMs, prompt engineering, agents, LangChain. By default it shows *required* skills wanted by two or
> more jobs — the real signal, not the noise."

**The seams — normalization (~20s)  ← your proudest moment**
> [hover a bar] "Now the part I'm proud of. Hover LLMs — see *'merged from: large language models,
> LLM APIs, LLM orchestration'*? A vision model read half-cropped screenshots and reconciled all those
> variants into one skill. That reconciliation is the whole ballgame — without it, this chart is noise."

**Depth — click-through (~15s)**
> [click a skill] "Click a skill, I get the jobs that want it. [click a job] Click a job, I get its
> full skill set — required versus nice-to-have — and a seniority level inferred from the text, with
> the evidence on hover. Nothing's hardcoded; it's all from the postings."

**The climax — live Daytona drop-in (~20s)  [if built]**
> [upload] "And it's live. Here's a posting the model has never seen — I'll drop it in… [it parses]
> …and it just extracted the skills and updated the chart. That extraction ran in a **Daytona
> sandbox** — a real, on-demand pipeline, not a canned demo."

**The personal turn — résumé match (~25s)  ← the showstopper**
> [scroll to "Match your résumé"] "So that's what the *market* wants. Last thing — where do *you* fit?
> I'll drop in my résumé… [upload] …it parses in a Daytona sandbox, normalizes my skills into the same
> vocabulary, and ranks every job by how much of what it *requires* I already have — with the skills
> I'm missing right next to it."
> [swap résumés — the punch] "And it's reading the actual content, not keywords. Here's a generic
> résumé against this role — [X]%. Here's the same résumé tailored to it — [upload] — watch: jumps to
> [Y]%. That's the gap between you and the job, made visible."

**Tech + close (~20s)**
> "Under the hood: structured-output extraction, a deterministic normalization pass, the live parses
> running in Daytona, all deployed as one repo on one URL — no backend to babysit. And this is just
> part one. Part two parses your application emails, and because everything shares one job model, it all
> joins into a single picture: what the market wants, and where *you* stand in it. Thanks."

---

## 20-second elevator version (hallway / intro)
> "Job descriptions are a mess of inconsistent skill names. I built a tool that reads ~20 JD
> screenshots with a vision model, normalizes the skills into one vocabulary, and charts what the
> market actually wants — with a live drop-in that parses a brand-new posting on the spot in a
> Daytona sandbox."

## Degraded demo (if you didn't finish everything — it degrades like the build does)
- **Two live Daytona moments now** (JD drop-in *and* résumé match) — you don't need both on stage.
  If time or nerves are tight, run **only the résumé match**: it's the more memorable, more personal
  one, and it still shows the live Daytona pipeline. Keep the JD drop-in as a one-line mention.
- **No Daytona drop-in?** Cut the JD climax; the chart + "merged from" reveal still carry it. Make the
  drop-in your forward-looking close: "next step is parsing a new posting live."
- **No click-to-filter?** Cut the depth beat; chart + reveal alone tell the story.
- **Only chart + stats?** Still a complete demo: pose the question, show the ranked answer, hover the
  "merged from", done. (This is the plan's "degrade gracefully" bet — the pitch degrades with the build.)

## Delivery + safety
- **Open the live URL in a tab before you present.** Never navigate or live-type mid-demo.
- **Record a 90-second screen capture of the working demo at ~16:30** (right after the freeze/stranger
  test). If Wi-Fi or Vercel hiccups mid-pitch, play the recording and keep talking. Cheap insurance.
- **Have a fresh screenshot ready** for the live drop-in — one that is NOT in your corpus, so it's
  genuinely "never seen."
- **Have BOTH résumé PDFs ready** for the swap — a generic one and one tailored to a *specific*
  on-screen job — and **know that job's before/after %** so the punch lands even if you can't read the
  screen mid-pitch. (Tested: generic → tailored on ZDF Sparks visibly raises the match.)
- **Time it once — it's ~2.5 min now with the résumé beat.** If you're over, cut the depth/click-through
  beat first, then drop the JD drop-in (the résumé match covers the live-Daytona story on its own).
- **End on the vision** (the part-2 join), not on a feature — judges remember the last sentence.
