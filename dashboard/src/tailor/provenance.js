// Provenance guards for tailored bullets (spec C5). Pure — no React, no I/O —
// safe to share between api/ and src/. Used by the tailor guard pipeline.

// Number-token regex per spec: digits optionally followed by digits/commas/dots,
// with an optional trailing '%'. "24/7" tokenizes as "24" and "7"; ranges split too.
const DIGIT_RE = /\d[\d,.]*%?/g

// Normalize one token: strip commas, then strip trailing '.'/',' so that
// sentence-final "40." → "40" and "3.11." → "3.11" (only the trailing dot goes).
function normalizeToken(token) {
  let t = token.replace(/,/g, '')
  while (t.endsWith('.') || t.endsWith(',')) t = t.slice(0, -1)
  return t
}

// Tokenize a text into normalized number tokens.
function digitTokens(text) {
  return (String(text).match(DIGIT_RE) || []).map(normalizeToken)
}

// HARD guard. Every bullet must cite at least one claim id, and every cited id
// must exist in evidenceIds. → {ok:true} | {ok:false, reason}
export function validateClaimIds(bullets, evidenceIds) {
  if (!Array.isArray(bullets) || bullets.length === 0) {
    return { ok: false, reason: 'bullets missing or empty' }
  }
  const known = new Set(evidenceIds || [])
  for (const b of bullets) {
    const ids = b && b.claim_ids
    if (!Array.isArray(ids) || ids.length === 0) {
      return { ok: false, reason: `bullet "${b && b.text}" has no claim_ids` }
    }
    for (const id of ids) {
      if (!known.has(id)) {
        return { ok: false, reason: `claim_id "${id}" not in evidence (bullet "${b.text}")` }
      }
    }
  }
  return { ok: true }
}

// SOFT guard. Every number token in the bullets must appear (as a normalized
// token, set membership — NOT substring) somewhere in the evidence texts.
// → {ok:true} | {ok:false, digits:[offending normalized tokens]}
export function digitDiff(bullets, evidenceTexts) {
  const evidence = new Set()
  for (const text of evidenceTexts || []) {
    for (const tok of digitTokens(text)) evidence.add(tok)
  }
  const digits = []
  for (const b of bullets || []) {
    for (const tok of digitTokens(b && b.text)) {
      if (!evidence.has(tok) && !digits.includes(tok)) digits.push(tok)
    }
  }
  return digits.length ? { ok: false, digits } : { ok: true }
}
