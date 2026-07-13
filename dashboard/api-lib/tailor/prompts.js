// api-lib/tailor/prompts.js — server-only prompt builders for the tailor pipeline (spec C2).
// Pure module: no route handler, no React, no I/O. Every builder is deterministic
// (no timestamps, no randomness) so the generate/revise prefix stays cache-stable.
// House body shape follows api/resume.js sandboxCode: {model, max_tokens, tools,
// tool_choice, messages} with forced tool_choice {type:'tool', name}.

export const MODEL_MAIN = 'claude-sonnet-4-6'
export const MODEL_JUDGE = 'claude-haiku-4-5'

// One stable tool schema for generate AND revise (schema churn would thrash the prompt cache).
export const BULLETS_SCHEMA = {
  type: 'object',
  properties: {
    bullets: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, claim_ids: { type: 'array', items: { type: 'string' } } },
        required: ['text', 'claim_ids'],
      },
    },
  },
  required: ['bullets'],
}

// Verbatim from spec.md C2 — part of the cached prefix.
const SYSTEM_RULES = `You tailor résumé sections. Rules, absolute:
- Use ONLY the evidence provided (claims and the section's original text).
- Every bullet MUST list the claim_ids it draws from. No claim_id, no bullet.
- Never introduce a skill, metric, number, employer, title, or capability that
  is not in the evidence. Rephrasing and reordering are allowed; inventing is not.
- Write plainly. No buzzword stuffing.`

// Fixed key order + explicit fields -> byte-identical serialization per input.
function serializeClaim(claim) {
  return JSON.stringify({
    id: claim.id,
    text: claim.text,
    skills: Array.isArray(claim.skills) ? claim.skills : [],
  })
}

// Cached prefix: identical for every generate/revise in a (cv, job) session.
// Returns messages-API content blocks; cache_control on the LAST block.
export function buildPrefix({ fullText, jdSkills, allClaims }) {
  const sorted = [...allClaims].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  // Sort + dedupe jdSkills so permuted/duplicated inputs serialize byte-identically
  // (prefix determinism = cache stability).
  const skills = [...new Set(jdSkills)].sort()
  const text = [
    SYSTEM_RULES,
    '',
    'RESUME FULL TEXT:',
    fullText,
    '',
    'JD REQUIRED SKILLS:',
    skills.join(', '),
    '',
    'CLAIM CORPUS (catalog of claims by id; per-section instructions name which ids are usable):',
    ...sorted.map(serializeClaim),
  ].join('\n')
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }]
}

// Suffix (after the cache breakpoint): per-request material only.
// pillClaimIds is optional (spec C2 amendment): pill claims arrive per-request
// and are part of the ALLOWED evidence set (C6), so they join the allowlist here.
export function buildSuffix({ sectionName, origClaim, selectedClaimIds, note, priorBullets, objection, pillClaimIds }) {
  // Explicit allowlist: the ONLY ids the model may cite for this section.
  const allowedIds = [...new Set([...selectedClaimIds, ...(pillClaimIds ?? []), `orig-${sectionName}`])]
  const lines = [
    `SECTION TO TAILOR: ${sectionName}`,
    `ORIGINAL SECTION TEXT (cite as claim id "orig-${sectionName}"):`,
    origClaim,
    `SELECTED CLAIM IDS FOR THIS SECTION: ${selectedClaimIds.join(', ')}`,
    `Use ONLY these claim ids for this section's bullets: ${allowedIds.join(', ')}. Citing any other id is a failure.`,
  ]
  if (Array.isArray(priorBullets) && priorBullets.length > 0) {
    lines.push('PRIOR BULLETS TO REVISE:')
    for (const bullet of priorBullets) {
      lines.push(JSON.stringify({ text: bullet.text, claim_ids: bullet.claim_ids }))
    }
  }
  if (note) lines.push(`REVISION NOTE FROM THE USER: ${note}`)
  if (objection) lines.push(`GUARD OBJECTION — your previous attempt failed verification, fix this: ${objection}`)
  lines.push('Write the tailored bullets for this section now. Every bullet must cite the claim_ids it draws from.')
  return [{ type: 'text', text: lines.join('\n') }]
}

// Full messages-API body for a generate/revise call (forced tool write_bullets).
// Temperature intentionally omitted (main calls use the model default).
export function buildGenerateBody({ prefix, suffix }) {
  return {
    model: MODEL_MAIN,
    max_tokens: 2048,
    tools: [
      {
        name: 'write_bullets',
        description: 'Record the tailored résumé bullets for this section, each citing the claim_ids it draws from.',
        input_schema: BULLETS_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: 'write_bullets' },
    messages: [{ role: 'user', content: [...prefix, ...suffix] }],
  }
}

// Transcribe body: PDF document block -> forced tool record_transcript.
// max_tokens 8192 — a full CV transcript; the house 1024 would truncate it.
export function buildTranscribeBody({ pdfBase64 }) {
  return {
    model: MODEL_MAIN,
    max_tokens: 8192,
    tools: [
      {
        name: 'record_transcript',
        description: 'Record the complete plain-text transcript of the résumé PDF.',
        input_schema: {
          type: 'object',
          properties: { full_text: { type: 'string' } },
          required: ['full_text'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'record_transcript' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          {
            type: 'text',
            text: 'Transcribe this résumé PDF verbatim into plain text. Preserve reading order, headings, and line breaks. Record the COMPLETE text — do not summarize, shorten, or omit anything.',
          },
        ],
      },
    ],
  }
}

// Split body: full_text -> forced tool record_sections.
export function buildSplitBody({ fullText }) {
  return {
    model: MODEL_MAIN,
    max_tokens: 2048,
    tools: [
      {
        name: 'record_sections',
        description: 'Record the résumé sections in document order, quoting each heading and first content line verbatim.',
        input_schema: {
          type: 'object',
          properties: {
            sections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  heading_quote: { type: 'string' },
                  first_line_quote: { type: 'string' },
                },
                required: ['name', 'heading_quote', 'first_line_quote'],
              },
            },
          },
          required: ['sections'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'record_sections' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Split this résumé into its sections, in document order. For each section give its name, its heading quoted VERBATIM from the text, and the section's first content line quoted VERBATIM.\n\nRESUME FULL TEXT:\n${fullText}`,
          },
        ],
      },
    ],
  }
}
