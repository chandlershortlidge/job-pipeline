// Section anchoring for the tailor flow. Pure — no React, no I/O — so it's
// unit-testable and shared-safe (bundled by Vite for the browser AND imported
// by api/tailor.js on Vercel). Locates each LLM-claimed section quote in the
// transcript and returns character spans; sha256Hex fingerprints full_text so
// stored splits can be detected as stale. No node:crypto anywhere — webcrypto
// (globalThis.crypto.subtle) works in browsers and Node >= 18 alike.

const FUZZY_THRESHOLD = 0.85

// Collapse whitespace runs to single spaces. Returns the collapsed string plus
// a map from each collapsed index back to its original index, so fuzzy matches
// on collapsed text can be reported as offsets into the original text.
function collapseWithMap(text) {
  let collapsed = ''
  const map = []
  let wsStart = -1 // original index where the current whitespace run began
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      if (wsStart === -1) wsStart = i
      continue
    }
    if (wsStart !== -1 && collapsed.length > 0) {
      // interior whitespace run -> one space, mapped to the run's first char
      collapsed += ' '
      map.push(wsStart)
    }
    wsStart = -1
    collapsed += ch
    map.push(i)
  }
  return { collapsed, map }
}

function collapse(text) {
  return text.replace(/\s+/g, ' ').trim()
}

// Character-level Levenshtein distance (two-row DP; inputs are short quotes).
function levenshtein(a, b) {
  if (a === b) return 0
  let prev = new Array(b.length + 1)
  let curr = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

// Anchor one quote in text at or after `from`. Exact indexOf first; on a miss,
// slide a needle-sized window over the whitespace-collapsed text and accept the
// best window with normalized similarity >= 0.85 (earliest on ties). Returns
// {start, end} in ORIGINAL text offsets, or null when nothing clears the bar.
function anchorQuote(text, quote, from = 0) {
  const exact = text.indexOf(quote, from)
  if (exact !== -1) return { start: exact, end: exact + quote.length }

  const needle = collapse(quote)
  if (!needle) return null
  const { collapsed, map } = collapseWithMap(text.slice(from))
  const n = needle.length
  if (collapsed.length < n) return null

  let bestScore = 0
  let bestAt = -1
  for (let i = 0; i + n <= collapsed.length; i++) {
    const dist = levenshtein(needle, collapsed.slice(i, i + n))
    const score = 1 - dist / n
    if (score > bestScore) {
      bestScore = score
      bestAt = i
    }
  }
  if (bestScore < FUZZY_THRESHOLD) return null
  return { start: from + map[bestAt], end: from + map[bestAt + n - 1] + 1 }
}

// Locate each section's verbatim quotes in fullText and return offsets.
// quotes: [{name, heading_quote, first_line_quote}] (LLM output, order =
// document order).
// -> {ok:true, sections:[{name,start,end}]}
//  | {ok:false, gap:{section, quote}}   // ONE shape for every failure mode
// Spans tile fullText (heading -> next heading, last -> length; text before
// the first heading becomes '_header'). Tiling proves nothing by itself, so
// the falsifiable coverage rule: each section's first_line_quote must anchor
// (exact, then fuzzy) INSIDE its computed span — an omitted heading leaves a
// first line in a neighbor's span and the check fires. The gap object is the
// split action's 422 payload.
export function anchorSections(fullText, quotes) {
  // 0. Empty/whitespace-only quotes fail immediately. Without this guard an
  //    empty heading_quote "anchors" via indexOf('') at the cursor (zero-width
  //    span), silently swallowing header text instead of failing loudly.
  for (const { name, heading_quote, first_line_quote } of quotes) {
    if (typeof heading_quote !== 'string' || heading_quote.trim() === '') {
      return { ok: false, gap: { section: name, quote: heading_quote } }
    }
    if (typeof first_line_quote !== 'string' || first_line_quote.trim() === '') {
      return { ok: false, gap: { section: name, quote: first_line_quote } }
    }
  }

  // 1. Anchor every heading, searching forward from the previous match.
  const anchored = []
  let cursor = 0
  for (const { name, heading_quote } of quotes) {
    const hit = anchorQuote(fullText, heading_quote, cursor)
    if (!hit) return { ok: false, gap: { section: name, quote: heading_quote } }
    anchored.push({ name, start: hit.start })
    cursor = hit.end
  }

  // 2. Build spans: heading -> next heading, last -> fullText.length.
  //    Pre-first-heading text is '_header' (carried verbatim, never generated
  //    against, exempt from the first-line check — it has no quotes).
  const sections = []
  if (anchored.length > 0 && anchored[0].start > 0) {
    sections.push({ name: '_header', start: 0, end: anchored[0].start })
  }
  for (let i = 0; i < anchored.length; i++) {
    sections.push({
      name: anchored[i].name,
      start: anchored[i].start,
      end: i + 1 < anchored.length ? anchored[i + 1].start : fullText.length,
    })
  }

  // 3. Coverage rule: each first_line_quote must anchor inside its own span.
  for (let i = 0; i < quotes.length; i++) {
    const { name, first_line_quote } = quotes[i]
    const span = sections.find((s) => s.name === name)
    const inside = anchorQuote(fullText.slice(span.start, span.end), first_line_quote)
    if (!inside) return { ok: false, gap: { section: name, quote: first_line_quote } }
  }

  return { ok: true, sections }
}

// Canonical hash for full_text staleness checks. Webcrypto only — available in
// browsers and Node >= 18; node:crypto would break the Vite browser bundle.
export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
