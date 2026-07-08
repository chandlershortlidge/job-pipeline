# Plan: Source-File Storage v1 (JD screenshots + résumé PDFs)

## Purpose

Stop discarding the source documents the pipeline is built on. Today both live
paths throw away their input after parsing: `extract.js` hashes the screenshot
and drops it; `resume.js` extracts skills and drops the PDF. Store both in
Supabase Storage so that:

- a job row can show its original screenshot ("is this the same posting?" —
  the Mercanis question — settled by eye);
- the tailored-résumé feature (`tailored-resume-plan.md`) has its two hard
  inputs accumulating from day one: the JD screenshot for its side-by-side
  screen, and the full base résumé for its section splitter.

Visible v1 deliverable: a **"View screenshot"** button on the expanded job row.
The résumé-PDF side ships as capture-only (stored, retrievable via the same
route, no UI yet) — its UI belongs to the tailored-résumé plan.

## Definition of done

- New JD drop-in → expanded row shows "View screenshot" → opens the image in a
  lightbox. Rows without a stored image (all pre-existing jobs) show no button.
- New résumé upload → PDF stored, `cv` row carries its path; retrievable
  through the signed-URL route (verified by direct request, no UI).
- A storage failure never fails the upload — both paths degrade to today's
  behavior (job/CV saved without a source file).
- Deleting a job (or CV) also deletes its stored file — no orphans.
- Tests green (storage mocked); one real drop-in + one real résumé upload
  verified on the deployed site.

## Adds / does not add

**Adds:**

- **Bucket:** one private Supabase Storage bucket `sources`, prefixes
  `screenshots/` and `cvs/`. Private = no anon read policies; all access via
  short-lived signed URLs.
- **Schema:** `job.screenshot_path text`, `cv.pdf_path text` (nullable —
  legacy rows stay null). SQL run by hand in the Supabase editor, same as the
  `screenshot_hash` migration.
- **`extract.js`:** after a successful parse, upload the image bytes (already
  in memory) to `sources/screenshots/<job-id>.<ext>` with the service-role
  key, best-effort; save the path on the job row.
- **`resume.js`:** same pattern — upload the PDF to `sources/cvs/<cv-id>.pdf`
  after the profile persists, best-effort; save `pdf_path` on the cv row.
  (Insert first to get the id, then upload + update the path.)
- **New route `api/file.js`:** `GET ?kind=screenshot|cv&id=` → looks up the
  path, returns a short-lived signed URL (~1 h). Browser stays read-only;
  secrets stay server-side — same access model as every other write path.
- **`api/job.js` / `api/cv.js`:** on delete, also remove the stored file
  (best-effort).
- **UI:** "View screenshot" button in the expanded job row (only when
  `screenshot_path` is set) → fetches the signed URL → simple lightbox
  overlay. No CV UI in this pass.

**Does not add (explicitly cut):**

- Backfill of the 20 corpus screenshots — separate follow-up task. Worth doing
  soon: uploading them also computes their hashes, which closes the legacy
  dedup hole that let Mercanis and ClickHouse through.
- Images/PDFs for pre-existing live rows (7 jobs, 2 CVs) — originals are gone
  server-side; the 2 CVs can be re-uploaded by hand if wanted.
- Extracted full-text storage for résumés — the PDF itself is the minimal
  enabling artifact; the tailored-résumé plan decides later whether it wants
  text extraction on top (the model can re-read the PDF).
- Any image processing (crop/compress/thumbnail).
- Public bucket access or long-lived URLs.

## Steps

1. **Migration + bucket** (by hand in Supabase): create `sources` bucket
   (private), add the two columns. Verify with a REST probe.
2. **`extract.js` upload + path save**, with a handler test (storage mocked)
   locking: path saved on success, upload failure → job still returned, path
   never leaks client-side secrets.
3. **`resume.js` upload + path save**, same test pattern.
4. **`api/file.js` signed-URL route** + tests (kind validation, missing id,
   null path → 404).
5. **Delete cleanup** in `api/job.js` / `api/cv.js`.
6. **UI: button + lightbox** in the expanded row; `vite build` + headless
   screenshot.
7. **Deployed verify:** one real drop-in → button appears → image opens; one
   real résumé upload → signed URL fetch returns the PDF. Throwaway rows,
   deleted after (established practice).

Each step is a commit; stop-and-report if the storage API misbehaves rather
than patching around it.

## Pitfalls

- **Bucket must stay private.** No anon policies; a public bucket would leak
  every uploaded résumé. The signed-URL route is the only read path.
- **Previews share prod storage** (same as the DB) — test uploads are real;
  delete them.
- **Insert-then-upload ordering for CVs:** the path update is a second write —
  if the upload succeeds but the update fails, the file is orphaned. Keep the
  cleanup-on-delete logic tolerant of both null paths and missing files.
- **Vercel function payload/time limits:** the bytes are already in the
  request today, so no new ceiling — but the extra storage round-trip adds
  latency; keep it after the response-critical work where possible.
- **Don't let the signed-URL route grow write abilities.** GET only, kind
  allowlist, no arbitrary-path lookups — the path always comes from the DB
  row, never from the query string.

## Budget

- Files touched: `api/extract.js`, `api/resume.js`, `api/job.js`, `api/cv.js`,
  new `api/file.js`, `App.jsx`, `App.css`, plus tests. No new dependencies
  (`@supabase/supabase-js` already does Storage).
- One manual SQL/bucket setup in the Supabase dashboard.
- LLM calls: zero. Live verification: one real drop-in + one real résumé
  upload (one Daytona parse + one small model call each), rows deleted after.
- Deferred: corpus backfill, CV re-upload of the 2 existing rows, résumé
  full-text extraction, any CV-viewing UI.
