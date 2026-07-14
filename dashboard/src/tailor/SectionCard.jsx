import { useState } from 'react'

// One résumé section in the tailoring loop (spec C8). States:
// pending → generating → review (verified | unverified badge) → approved.
// Skip leaves the section as verbatim carryover; a request error (422 etc.)
// renders red with a Retry. Review offers Approve and a revision note with
// EQUAL visual weight — no rubber-stamp bias.
export default function SectionCard({
  name,
  state,
  evidence, // [{id, text}] — selected template claims ∪ pills ∪ orig-claim
  isCurrent,
  onGenerate, // () => void
  onRevise, // (note, priorBullets) => void
  onApprove,
  onSkip,
}) {
  const [note, setNote] = useState('')
  const [selectedBullet, setSelectedBullet] = useState(null)
  const status = state?.status ?? 'pending'
  const bullets = state?.bullets ?? []

  // Tap a bullet → highlight the claims it cites (mechanical provenance view).
  const cited =
    selectedBullet != null && bullets[selectedBullet]
      ? new Set(bullets[selectedBullet].claim_ids)
      : null

  return (
    <div className={'section-card' + (isCurrent ? ' current' : '') + ' sc-' + status}>
      <div className="sc-head">
        <span className="sc-name">{name}</span>
        {status === 'pending' && <span className="sc-status">carryover unless generated</span>}
        {status === 'generating' && <span className="sc-status busy">generating…</span>}
        {status === 'approved' && <span className="sc-badge approved">approved</span>}
        {status === 'skipped' && <span className="sc-status">skipped — carries over verbatim</span>}
        {status === 'review' && state.verified === false && (
          <span className="sc-badge unverified">
            unverified — not confirmed against your claims
          </span>
        )}
        {status === 'review' && state.verified === true && (
          <span className="sc-badge verified">verified</span>
        )}
      </div>

      {status === 'pending' && isCurrent && (
        <button className="sc-generate" onClick={onGenerate}>
          Generate bullets
        </button>
      )}

      {status === 'error' && (
        <div className="sc-error" role="alert">
          <span className="sc-error-msg">⚠ {state.error}</span>
          <button className="sc-retry" onClick={onGenerate}>
            Retry
          </button>
        </div>
      )}

      {(status === 'review' || status === 'approved') && (
        <>
          {state.verified === false && state.objection && (
            <p className="sc-objection">{state.objection}</p>
          )}
          <ul className="sc-bullets">
            {bullets.map((b, i) => (
              <li
                key={i}
                className={'sc-bullet' + (selectedBullet === i ? ' selected' : '')}
                onClick={() => setSelectedBullet(selectedBullet === i ? null : i)}
              >
                <span className="sc-bullet-text">{b.text}</span>
                <span className="sc-bullet-chips">
                  {b.claim_ids.map((id) => (
                    <span
                      key={id}
                      className={'claim-chip' + (cited?.has(id) ? ' cited' : '')}
                    >
                      {id}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {cited && (
            <ul className="sc-evidence">
              {evidence.map((c) => (
                <li key={c.id} className={'sc-claim' + (cited.has(c.id) ? ' cited' : '')}>
                  <span className="claim-chip">{c.id}</span> {c.text}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {status === 'review' && (
        <div className="sc-actions">
          <button className="sc-approve" onClick={() => onApprove(bullets)}>
            Approve
          </button>
          <span className="sc-revise">
            <textarea
              className="sc-note"
              placeholder="What should change? e.g. lead with the pipeline work"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
            <button
              className="sc-revise-btn"
              disabled={!note.trim()}
              onClick={() => {
                onRevise(note.trim(), bullets)
                setNote('')
              }}
            >
              Request revision
            </button>
          </span>
          <button className="sc-skip" onClick={onSkip}>
            Skip
          </button>
        </div>
      )}
    </div>
  )
}
