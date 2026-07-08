// Soft duplicate detection for the live drop-in (dedup v2, client-side). The server's
// hash check only catches a byte-identical re-upload; a NEW screenshot of the SAME
// posting sails through it. After a successful parse, this flags an existing job that
// looks like the same posting so the UI can warn — non-blocking: the new job is still
// added, the user decides.
// v1 signal: same company (case-insensitive, trimmed). Deliberately coarse — a false
// "possible duplicate" costs one glance; a missed one costs a skewed chart.
// Does NOT mutate anything and does NOT decide — it only finds the candidate.
export function findSimilarJob(jobs, newJob) {
  const co = (newJob?.company || '').trim().toLowerCase()
  if (!co) return null
  return (
    jobs.find(
      (j) => j.id !== newJob.id && (j.company || '').trim().toLowerCase() === co,
    ) || null
  )
}
