// Résumé-vs-job skill matching. Pure — no React, no I/O — so it's unit-testable.
// Used by App.jsx for both the post-upload comparison card and the per-row compare.

// Compare one job's REQUIRED skills against a résumé's canonical skill set.
// Returns the skills the résumé has (matched), lacks (missing), and the share covered.
export function matchJob(job, resumeSet) {
  const req = [
    ...new Set(job.skills.filter((s) => s.requirement === 'required').map((s) => s.canonical)),
  ]
  const matched = req.filter((c) => resumeSet.has(c))
  const missing = req.filter((c) => !resumeSet.has(c))
  return { matched, missing, score: req.length ? matched.length / req.length : 0 }
}
