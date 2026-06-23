# Pre-Event Prep Checklist — Deploy Path + API Key

Goal of this week's prep: prove the **push → live URL** loop cold, and confirm your API key works — so on the day none of this is a surprise. Work top to bottom. Each step has a command (where relevant) and a **Done when** so you know it worked before moving on.

The big idea to hold onto: you're building **one app, deployed to one host (Vercel)**. Extraction runs as a separate Python script *on your laptop* that writes a `jobs.json` file; the React app just reads that file. The API key only ever touches the Python script — never the React app, never Vercel.

---

## Part 0 — One-time setup (accounts + tools)

- [ ] **Node.js installed, version 18 or newer.** Check it:
  ```
  node --version
  ```
  **Done when:** it prints `v18.x` or higher (v20+ ideal). If it errors or shows older, install the LTS from nodejs.org.

- [ ] **npm works** (it ships with Node):
  ```
  npm --version
  ```
  **Done when:** it prints a version number.

- [ ] **git works:**
  ```
  git --version
  ```
  **Done when:** it prints a version number.

- [ ] **GitHub account** exists and you can log in. (You said the `job-pipeline` repo is already created — good. For the smoothest path, make sure it was created **empty**: no README, no .gitignore. If it has a README, see the note in Part 2.)

- [ ] **Vercel account** — sign up at vercel.com **using "Continue with GitHub."** This links the two so importing your repo later is one click.
  **Done when:** you're logged into the Vercel dashboard.

---

## Part 1 — Scaffold the React app locally (into `dashboard/`)

The repo root is for Python (your extraction lives there). The React app goes in its own `dashboard/` subfolder so the two toolchains don't collide.

- [ ] **Create the Vite + React app inside a `dashboard` folder.** Run this from the repo root:
  ```
  npm create vite@latest dashboard -- --template react
  ```
  If it asks to install `create-vite`, say yes.

- [ ] **Go into it and install dependencies:**
  ```
  cd dashboard
  npm install
  ```
  **Done when:** a `node_modules` folder appears inside `dashboard/` and there are no red errors.

- [ ] **Run it locally** (still inside `dashboard/`):
  ```
  npm run dev
  ```
  It prints a local address, usually `http://localhost:5173`. Open that in your browser.
  **Done when:** you see the default Vite + React starter page (spinning logos). Stop the server anytime with `Ctrl+C`. Then `cd ..` back to the repo root.

---

## Part 2 — Get it onto GitHub

The Vite scaffold may already have set up git. Check with `git status` — if it says "not a git repository," run `git init` first.

- [ ] **Stage and commit everything:**
  ```
  git add .
  git commit -m "Initial Vite + React scaffold"
  ```

- [ ] **Connect your local folder to your GitHub repo** (replace `USERNAME` with yours):
  ```
  git remote add origin https://github.com/USERNAME/job-pipeline.git
  git branch -M main
  ```

- [ ] **Push:**
  ```
  git push -u origin main
  ```
  **Done when:** you refresh the repo page on GitHub and see your files there.

  > **Gotcha:** if the push is rejected because the GitHub repo already has a README, run `git pull origin main --rebase` first, then push again. Easiest to avoid entirely by creating the repo empty.

---

## Part 3 — Deploy to Vercel (the first deploy)

- [ ] In the Vercel dashboard, click **Add New… → Project**.
- [ ] **Import** your `job-pipeline` repo from the list. (It's there because you signed up with GitHub.)
- [ ] Vercel auto-detects Vite and fills in the build settings (Framework: Vite, Build Command: `npm run build`, Output: `dist`). **Don't change those.**
- [ ] **Set the Root Directory to `dashboard`.** This is the one setting you must change — there's a "Root Directory" field; set it to `dashboard` so Vercel builds only the React app and ignores the Python at the repo root.
- [ ] Click **Deploy** and wait ~1 minute for the build to finish.
  **Done when:** Vercel shows "Congratulations" and a live URL like `https://job-pipeline-xxxx.vercel.app`. Open it — you should see the same starter page you saw locally, now on the public internet.

---

## Part 4 — Prove the loop (this is the actual goal)

This is the whole point of the week's prep: confirming that a push automatically updates the live site.

- [ ] Open `dashboard/src/App.jsx` in your editor. Find the text on the page (something like "Vite + React") and change it to anything — e.g. "JD Skills Aggregator — coming soon."
- [ ] Save, then:
  ```
  git add .
  git commit -m "Test the deploy loop"
  git push
  ```
- [ ] Wait ~1 minute, then refresh your live Vercel URL.
  **Done when:** your changed text shows up on the live site. **If this works, your deploy path is solved cold.** On the day, shipping = `git push`, nothing more.

---

## Part 5 — Python extraction at the repo root (uv) + API key

This is independent of the React app. Python lives at the **repo root** (where you're used to it); the key lives in a root `.env` and **never gets committed or deployed.**

- [ ] **Get an API key** from your model provider's dashboard (OpenAI or Anthropic — whichever your keys are for). Copy it somewhere safe temporarily.

- [ ] **Initialize the uv project at the repo root.** From `job-pipeline/`:
  ```
  uv init
  uv add openai python-dotenv        (or: uv add anthropic python-dotenv)
  ```
  `uv init` creates `pyproject.toml`; `uv add` creates the environment and records the dependencies. No separate activate step — you run things with `uv run` (below).
  **Done when:** `pyproject.toml` and a `uv.lock` exist at the root, listing your dependencies.

- [ ] **Create a `.env` file at the repo root** containing just your key:
  ```
  OPENAI_API_KEY=sk-...your-key...
  ```
  (Use `ANTHROPIC_API_KEY=` if you're on Anthropic.)

- [ ] **Protect the key — critical.** Make sure `.env` is never committed. From the repo root, add it to `.gitignore` (uv already ignores `.venv/`):
  ```
  echo ".env" >> .gitignore
  ```
  **Done when:** `git status` does **not** list `.env` as a file to be committed. (Committing an API key is a real security mistake — providers auto-revoke leaked keys, and you'd have to regenerate.)

- [ ] **Test the key with one tiny call.** Make `test_key.py` at the root:
  ```python
  from dotenv import load_dotenv
  from openai import OpenAI   # or: from anthropic import Anthropic

  load_dotenv()
  client = OpenAI()           # reads OPENAI_API_KEY from the environment
  resp = client.chat.completions.create(
      model="gpt-4o-mini",
      messages=[{"role": "user", "content": "Say hello in 3 words."}],
  )
  print(resp.choices[0].message.content)
  ```
  Run it with uv:
  ```
  uv run test_key.py
  ```
  **Done when:** it prints a short reply. That proves the key works and your environment is wired — no surprises at 11am on the day.

---

## Where things will sit in the repo (for orientation)

```
job-pipeline/
  pyproject.toml       <- Python/uv project at root
  uv.lock
  .env                 <- API key lives here (never committed)
  .venv/               <- uv's environment (never committed)
  extract.py           <- the extraction script (built on the day)
  test_key.py          <- the one-call key test
  scratch/             <- notebook verification during the week
  dashboard/           <- the whole React app
    src/App.jsx        <- the dashboard you build on the day
    public/jobs.json   <- extraction writes here; React reads it at /jobs.json
    package.json
  AGENTS.md
```

Python sits at the root where you're used to it. The extraction script writes its output to `dashboard/public/jobs.json` (one folder over) so the React app can read it. Vercel builds only the `dashboard/` folder (the Root Directory setting from Part 3) and ignores the Python entirely.

---

## End-of-week definition of done
- [ ] Live Vercel URL exists and updates when you `git push` (Part 4 passed)
- [ ] API key tested and confirmed working from the Python script (Part 5 passed)
- [ ] `.env` confirmed gitignored

If those three are checked, you walk in on the day with the entire setup tax already paid — and the 5 hours are yours for extraction and the dashboard.
