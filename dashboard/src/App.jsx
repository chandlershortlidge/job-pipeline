import { useEffect, useMemo, useState } from 'react'
import './App.css'

// Selecting a level re-scopes the chart to that level's jobs and recolors the bars.
// "All" (no level) keeps the default global indigo.
const GLOBAL_COLOR = '#4f46e5'
const SENIORITY_LEVELS = [
  { level: 'Junior', color: '#16a34a' },
  { level: 'Mid', color: '#d97706' },
  { level: 'Senior', color: '#dc2626' },
]

// Read a File into a base64 string (no data: prefix) for POSTing to /api/extract.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function App() {
  const [data, setData] = useState(null)
  const [selectedSkill, setSelectedSkill] = useState(null)
  const [selectedSeniority, setSelectedSeniority] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)

  useEffect(() => {
    fetch('/jobs.json')
      .then((r) => r.json())
      .then(setData)
      .catch((e) => console.error('failed to load jobs.json', e))
  }, [])

  // Live drop-in: parse an uploaded screenshot in a Daytona sandbox, prepend the job.
  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    setUploading(true)
    try {
      const image = await fileToBase64(file)
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image, media_type: file.type || 'image/png' }),
      })
      const payload = await res.json()
      if (!res.ok || !payload.job) throw new Error(payload.error || 'extraction failed')
      setData((prev) => ({ ...prev, jobs: [payload.job, ...prev.jobs] }))
    } catch (err) {
      setUploadError(String(err.message || err))
    } finally {
      setUploading(false)
      e.target.value = '' // allow re-uploading the same file
    }
  }

  const derived = useMemo(() => {
    if (!data) return null
    const jobs = data.jobs
    const variants = data.skill_variants || {}

    const skillSet = new Set()
    const companySet = new Set()
    for (const j of jobs) {
      if (j.company) companySet.add(j.company.trim().toLowerCase())
      for (const s of j.skills) skillSet.add(s.canonical)
    }

    // jobs per level, for the view-selector buttons (seniority read from data, not recomputed)
    const senCounts = { Junior: 0, Mid: 0, Senior: 0 }
    for (const j of jobs) {
      if (Object.hasOwn(senCounts, j.seniority)) senCounts[j.seniority] += 1
    }

    // document frequency: distinct jobs per canonical skill, scoped to the selected seniority view
    const counts = {}
    for (const j of jobs) {
      if (selectedSeniority && j.seniority !== selectedSeniority) continue
      const seen = new Set()
      for (const s of j.skills) {
        if (!showAll && s.requirement !== 'required') continue
        if (seen.has(s.canonical)) continue
        seen.add(s.canonical)
        ;(counts[s.canonical] ??= new Set()).add(j.id)
      }
    }
    let chart = Object.entries(counts).map(([skill, set]) => ({ skill, count: set.size }))
    if (!showAll) chart = chart.filter((d) => d.count >= 2)
    chart.sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
    const max = chart.length ? chart[0].count : 1

    return {
      jobs,
      variants,
      senCounts,
      stats: { jobs: jobs.length, skills: skillSet.size, companies: companySet.size },
      chart,
      max,
    }
  }, [data, showAll, selectedSeniority])

  if (!derived) {
    return (
      <div className="app">
        <p className="loading">Loading…</p>
      </div>
    )
  }

  const { jobs, variants, senCounts, stats, chart, max } = derived
  const activeColor = selectedSeniority
    ? SENIORITY_LEVELS.find((s) => s.level === selectedSeniority).color
    : GLOBAL_COLOR
  // The job list composes both filters: the clicked skill AND the selected seniority.
  const shownJobs = jobs.filter(
    (j) =>
      (!selectedSkill || j.skills.some((s) => s.canonical === selectedSkill)) &&
      (!selectedSeniority || j.seniority === selectedSeniority),
  )

  return (
    <div className="app">
      <header>
        <h1>JD Skills Aggregator</h1>
        <p className="sub">
          What is the AI job market prioritizing? — extracted from {stats.jobs} real
          job-description screenshots.
        </p>
      </header>

      <section className="stats">
        <div>
          <strong>{stats.jobs}</strong>
          <span>jobs</span>
        </div>
        <div>
          <strong>{stats.skills}</strong>
          <span>skills</span>
        </div>
        <div>
          <strong>{stats.companies}</strong>
          <span>companies</span>
        </div>
      </section>

      <section className="upload">
        <label className={'upload-btn' + (uploading ? ' busy' : '')}>
          {uploading ? 'Parsing in a Daytona sandbox…' : '+ add a screenshot'}
          <input type="file" accept="image/*" onChange={handleUpload} disabled={uploading} hidden />
        </label>
        <span className="upload-hint">parsed live in a Daytona sandbox</span>
        {uploadError && <span className="upload-err">⚠ {uploadError}</span>}
      </section>

      <section className="chart">
        <div className="sen-view">
          <span className="sen-view-label">Compare by level:</span>
          <button
            className={'sen-chip' + (selectedSeniority === null ? ' active' : '')}
            style={{ '--chip-color': GLOBAL_COLOR }}
            aria-pressed={selectedSeniority === null}
            onClick={() => setSelectedSeniority(null)}
          >
            All <span className="sen-chip-n">{stats.jobs}</span>
          </button>
          {SENIORITY_LEVELS.map(({ level, color }) => (
            <button
              key={level}
              className={'sen-chip' + (selectedSeniority === level ? ' active' : '')}
              style={{ '--chip-color': color }}
              aria-pressed={selectedSeniority === level}
              onClick={() => setSelectedSeniority(level)}
            >
              {level} <span className="sen-chip-n">{senCounts[level]}</span>
            </button>
          ))}
        </div>
        <div className="chart-head">
          <h2>
            Most-wanted skills
            {selectedSeniority && (
              <span className="chart-scope" style={{ color: activeColor }}>
                {' · '}
                {selectedSeniority}
              </span>
            )}
          </h2>
          <label className="toggle">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            show all
          </label>
        </div>
        <p className="hint">
          {showAll ? 'All skills (required + nice-to-have)' : 'Required skills wanted by 2+ jobs'}
          {selectedSeniority ? ` at ${selectedSeniority} level` : ''}. Hover a bar to see what
          merged into it; click to filter the jobs below.
        </p>
        {chart.length === 0 ? (
          <p className="empty">
            No required skills appear in 2+ {selectedSeniority} jobs — try “show all”.
          </p>
        ) : (
          <ul className="bars" style={{ '--bar-color': activeColor }}>
            {chart.map((d) => (
              <li
                key={d.skill}
                className={'bar-row' + (selectedSkill === d.skill ? ' selected' : '')}
                onClick={() => setSelectedSkill(selectedSkill === d.skill ? null : d.skill)}
              >
                <span className="bar-label">{d.skill}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${(d.count / max) * 100}%` }} />
                </span>
                <span className="bar-count">{d.count}</span>
                {variants[d.skill] && (
                  <span className="tooltip">
                    <strong>{d.skill}</strong> merged from: {variants[d.skill].join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="jobs">
        <div className="jobs-head">
          <h2>
            Jobs{selectedSkill ? <> wanting <em>{selectedSkill}</em></> : ''}
            <span className="count"> ({shownJobs.length})</span>
          </h2>
          {selectedSkill && (
            <button className="clear" onClick={() => setSelectedSkill(null)}>
              clear ✕
            </button>
          )}
        </div>
        <ul className="job-list">
          {shownJobs.map((j) => (
            <JobRow key={j.id} job={j} />
          ))}
        </ul>
      </section>

      <footer>AI extraction + deterministic normalization · built at the hackathon</footer>
    </div>
  )
}

function JobRow({ job }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="job">
      <button className="job-head" onClick={() => setOpen((o) => !o)}>
        <span className="job-co">
          {job.company || '—'}
          {job.id?.startsWith('live-') && <span className="live-badge">live</span>}
        </span>
        <span className="job-title">{job.title || '—'}</span>
        <span className="job-sen">
          {job.seniority || '—'}
          {job.seniority_basis === 'inferred' && (
            <span className="inf" title={job.seniority_signal || 'inferred'}>
              {' '}~
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="job-detail">
          {job.summary && <p className="job-sum">{job.summary}</p>}
          <div className="chips">
            {job.skills.map((s) => (
              <span
                key={s.canonical}
                className={'chip' + (s.requirement === 'required' ? ' req' : '')}
              >
                {s.canonical}
              </span>
            ))}
          </div>
        </div>
      )}
    </li>
  )
}
