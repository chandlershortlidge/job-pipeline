// api-lib/tailor/judge.js — server-only entailment judge for the tailor pipeline (spec C3).
// One Haiku call, temperature 0, forced tool 'verdict'. NEVER throws:
// any infrastructure failure (fetch throw, non-200, malformed response) →
// {pass:false, objection:'judge unavailable', judgeError:true}.

import { MODEL_JUDGE } from './prompts.js'

const JUDGE_ERROR = Object.freeze({ pass: false, objection: 'judge unavailable', judgeError: true })

// Verbatim from spec.md C3.
const QUESTION =
  'Is every factual statement in these bullets entailed by the evidence? ' +
  'Rephrasing is fine; any new fact, number, skill, or capability is not.'

const VERDICT_TOOL = {
  name: 'verdict',
  description: 'Record the entailment verdict for the tailored bullets.',
  input_schema: {
    type: 'object',
    properties: {
      pass: { type: 'boolean' },
      objection: { type: ['string', 'null'] },
    },
    required: ['pass', 'objection'],
  },
}

function buildUserText({ bullets, evidence }) {
  return [
    'EVIDENCE:',
    ...evidence.map((claim) => `${claim.id}: ${claim.text}`),
    '',
    'BULLETS:',
    ...bullets.map((bullet) => bullet.text),
    '',
    QUESTION,
  ].join('\n')
}

// → {pass: boolean, objection: string|null}. NEVER throws.
export async function judge({ bullets, evidence, apiKey }) {
  const body = {
    model: MODEL_JUDGE,
    max_tokens: 512,
    temperature: 0,
    tools: [VERDICT_TOOL],
    tool_choice: { type: 'tool', name: 'verdict' },
    messages: [{ role: 'user', content: [{ type: 'text', text: buildUserText({ bullets, evidence }) }] }],
  }
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) return JUDGE_ERROR
    const data = await response.json()
    const block = (data?.content ?? []).find((b) => b?.type === 'tool_use' && b?.name === 'verdict')
    if (!block || typeof block.input?.pass !== 'boolean') return JUDGE_ERROR
    return { pass: block.input.pass, objection: block.input.objection ?? null }
  } catch {
    return JUDGE_ERROR
  }
}
