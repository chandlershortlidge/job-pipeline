// Job-list search (v1: company name only). Pure filter — takes the jobs array and a
// free-text query, returns the jobs whose company contains it (case-insensitive,
// whitespace-trimmed). Does NOT touch the chart, stats, or any other filter — search
// scopes the job list only, same as the skill/seniority filters.
// Invariants: empty/blank query returns the input array unchanged (same reference);
// jobs with a null company never match a non-empty query.
export function filterJobsByCompany(jobs, query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return jobs
  return jobs.filter((j) => (j.company || '').toLowerCase().includes(q))
}
