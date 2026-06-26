# Daytona Live Drop-in — Build Plan (Phase 4 stretch)

The wow moment: a judge uploads a brand-new JD screenshot on the live site → it's parsed
**on demand inside a Daytona sandbox** → the dashboard updates. The plumbing is already proven
(`daytona-prep-checklist.md` Parts 0–3); this plan turns the hello-world into the real thing.

**Division of labour:** the front-end agent owns the **upload UI** (in `dashboard/src/`); the
backend (`dashboard/api/extract.js` + sandbox code) is owned separately. They meet at **one
contract** (below) and can build in parallel.

---

## The contract (front-end ⇄ backend) — build to this

**Request:** `POST /api/extract`
```json
{ "image": "<base64 string, no data: prefix>", "media_type": "image/png" }
```

**Response (success):**
```json
{ "job": {
    "id": "live-1719400000000",
    "company": "Acme AI", "title": "ML Engineer",
    "seniority": "Senior", "seniority_signal": "5+ years", "seniority_basis": "inferred",
    "summary": "…", "source": "screenshot",
    "skills": [ { "canonical": "RAG", "raw_text": "retrieval-augmented generation", "requirement": "required" } ]
} }
```
**Response (failure):** `{ "error": "couldn't parse" }` with HTTP 500.

**Front-end behaviour (frontend-spec.md):** on upload → POST → on success **prepend `job` to the
`jobs` array in state** (stats/chart/list re-derive automatically); on error show a small
"couldn't parse" note and leave everything intact. Stateless — no DB, no refresh needed.

The returned `job` is the **same shape as every job in `jobs.json`**, so the existing derive logic
"just works."

---

## Backend build steps (`dashboard/api/extract.js`)

Today the function runs `print("hi from daytona")` in a sandbox. Replace that with the real
extraction, in three moves:

**1. Run the extraction Python *inside* the Daytona sandbox — using the stdlib only (no pip).**
This resolves the "how do deps get into the sandbox" open question: don't install the SDK at all.
The sandbox code calls the model's HTTP API directly with `urllib` (standard library), so the
sandbox needs nothing pre-installed and boots fast.
- Pass into the sandbox via the code string: the **image base64**, the **system prompt + tool
  schema** (copy from `extract.py`), and the **model API key** (read from the function's env and
  interpolated/passed in — never hard-coded).
- The Python posts to `https://api.anthropic.com/v1/messages` (same request shape as
  `extract.py`: `model`, `system`, `tools=[record_job]`, `tool_choice`, `messages` with the image
  block), reads the `tool_use` input, and `print(json.dumps(that input))`.
- The function reads the sandbox's stdout (`response.result`) and `JSON.parse`s it.

**2. Normalize the single live job** so its skills match the existing chart's canonicals.
- `normalize.py` already produces the mapping; have it also write a static
  **`dashboard/public/canonical_map.json`** = `{ "<lowercased raw canonical>": "<display canonical>" }`
  plus the `SPLITS` list. (One small addition to `normalize.py`.)
- The function loads that map and applies, per skill: split-slash → lowercase → map lookup
  (fallback: keep as-is). ~15 lines of JS. Good-enough; perfect global case-folding isn't needed
  for one live job.
- *MVP shortcut if time is tight:* skip this and return the model's `canonical` as-is. The new job
  still appears and updates the chart; a slightly-off bar is acceptable for the live moment.

**3. Secrets + id.** `DAYTONA_API_KEY` and the model key live in **Vercel env vars** (Daytona one
already set). `id = "live-" + Date.now()` (Node `Date.now()` is fine here).

---

## Test plan (de-risk before relying on it in the demo)
1. **Sandbox extraction in isolation** — a local script that runs the stdlib-urllib extraction in a
   sandbox over one real screenshot, prints the job JSON. (Mirrors the Part-1 hello-world.)
2. **Through the function locally** — invoke the handler with a mock req carrying a base64 image;
   confirm it returns a valid `job`.
3. **Deployed** — `curl -X POST .../api/extract` with a base64 image; confirm HTTP 200 + job.
4. **End-to-end in the browser** — front-end agent's upload UI against the live endpoint, with a
   **fresh screenshot not in the corpus**.

## Guardrails (unchanged from the plan)
- **Gated stretch.** The static dashboard + live URL (the prize floor) is already deployed and must
  never depend on this. If the drop-in breaks, cut it — nothing else is affected.
- **Cut line ~16:00.** Stop adding to it then; record the 90-sec demo backup regardless.
- Each live call spins a real Daytona sandbox (a little credit + a few seconds latency) — fine for a
  demo; don't loop it.
