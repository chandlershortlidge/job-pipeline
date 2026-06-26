import { useEffect, useMemo, useState } from 'react'
import './App.css'

const SENIORITY_LEVELS = ['Junior', 'Mid', 'Senior']

export default function App() {
  const [data, setData] = useState(null)
  const [selectedSkill, setSelectedSkill] = useState(null)
  const [selectedSeniority, setSelectedSeniority] = useState(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    fetch('/jobs.json')
      .then((r) => r.json())
      .then(setData)
      .catch((e) => console.error('failed to load jobs.json', e))
  }, [])

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

    // document frequency: distinct jobs per canonical skill
    const counts = {}
    for (const j of jobs) {
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
      stats: { jobs: jobs.length, skills: skillSet.size, companies: companySet.size },
      chart,
      max,
    }
  }, [data, showAll])

  if (!derived) {
    return (
      <div className="app">
        <p className="loading">Loading…</p>
      </div>
    )
  }

  const { jobs, variants, stats, chart, max } = derived
  // Filters compose: skill narrows first, then seniority narrows within that.
  const skillJobs = selectedSkill
    ? jobs.filter((j) => j.skills.some((s) => s.canonical === selectedSkill))
    : jobs
  // Per-level counts reflect the current skill filter (seniority read from data, not recomputed).
  const senCounts = { Junior: 0, Mid: 0, Senior: 0 }
  for (const j of skillJobs) {
    if (Object.hasOwn(senCounts, j.seniority)) senCounts[j.seniority] += 1
  }
  const shownJobs = selectedSeniority
    ? skillJobs.filter((j) => j.seniority === selectedSeniority)
    : skillJobs

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

      <section className="chart">
        <div className="chart-head">
          <h2>Most-wanted skills</h2>
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
          {showAll
            ? 'All skills (required + nice-to-have).'
            : 'Required skills wanted by 2+ jobs.'}{' '}
          Hover a bar to see what merged into it; click to filter the jobs below.
        </p>
        <ul className="bars">
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
        <div className="sen-filter">
          <span className="sen-filter-label">Seniority</span>
          {SENIORITY_LEVELS.map((level) => (
            <button
              key={level}
              className={'sen-btn' + (selectedSeniority === level ? ' active' : '')}
              aria-pressed={selectedSeniority === level}
              onClick={() =>
                setSelectedSeniority(selectedSeniority === level ? null : level)
              }
            >
              {level} <span className="sen-btn-n">{senCounts[level]}</span>
            </button>
          ))}
          {selectedSeniority && (
            <button className="sen-clear" onClick={() => setSelectedSeniority(null)}>
              all
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
        <span className="job-co">{job.company || '—'}</span>
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
