"""email_parser.extract_fields — pull the raw fields out of an email (Sonnet).

`extract(email, category, *, api_key, client=None) -> ExtractedFields`. One
Anthropic call: model `claude-sonnet-4-6`, temperature 0, a FORCED tool `extract`
whose schema mirrors `ExtractedFields`. The category conditions the prompt (a
rejection carries no action or dates; an interview_invite usually has key_dates).

Extraction stays DUMB on purpose: company/role are copied VERBATIM as
`company_raw`/`role_raw` — no canonicalization, no guessing a legal name. Missing
fields come back null / `[]` / false. `extraction_confidence` is the model's own
"how sure am I" flag — advisory only, it NEVER blocks the write. `client` is
injectable so tests mock it; a live call in a test is a bug (AGENTS.md).

Does NOT: match to a job (matcher.py), classify (classify.py), or clean up any
string it extracts. The matcher, not this, decides company equality.
"""

import anthropic

from email_parser import config
from email_parser.models import Category, ExtractedFields, KeyDateType

_KEY_DATE_TYPES = [t.value for t in KeyDateType]

_EXTRACT_TOOL = {
    "name": "extract",
    "description": (
        "Record the structured fields found in this job-search email. Copy "
        "company and role text VERBATIM — do not normalize, expand, or guess. "
        "Leave a field null / empty / false when the email does not state it."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "company_raw": {"type": ["string", "null"], "description": "Company name, exactly as written."},
            "role_raw": {"type": ["string", "null"], "description": "Role/title, exactly as written."},
            "contact_name": {"type": ["string", "null"], "description": "Human contact/recruiter name, if any."},
            "key_dates": {
                "type": "array",
                "description": "Dates the email states (interviews, deadlines, start dates).",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "enum": _KEY_DATE_TYPES},
                        "date": {
                            "type": ["string", "null"],
                            "description": "ISO date (YYYY-MM-DD) if parseable, else null.",
                        },
                        "raw_text": {"type": "string", "description": "The verbatim date phrase from the email."},
                    },
                    "required": ["type", "raw_text"],
                },
            },
            "action_required": {"type": "boolean", "description": "Does the email ask the recipient to do something?"},
            "action_description": {"type": ["string", "null"], "description": "What action, if any."},
            "extraction_confidence": {
                "type": "string",
                "enum": ["high", "low"],
                "description": "'low' when the email is ambiguous. Advisory only; never blocks the write.",
            },
        },
        "required": [],
        "additionalProperties": False,
    },
}

# Per-category nudge appended to the prompt. Keeps the extractor's expectations
# aligned with what each kind of email actually contains.
_CATEGORY_HINT = {
    Category.recruiter_outreach: "Recruiter reaching out: capture company/role and any contact name; usually no dates.",
    Category.interview_invite: "Interview invite: expect one or more key_dates (interview time) and likely an action.",
    Category.rejection: "Rejection: usually no action and no future dates. Still capture company/role.",
    Category.application_confirmation: "Application confirmation: capture company/role; usually no action.",
    Category.other: "Other/unclear: extract only what is explicitly present; leave the rest null/empty/false.",
}


def extract(
    email,
    category: Category,
    *,
    api_key: str,
    client: anthropic.Anthropic | None = None,
) -> ExtractedFields:
    """Return the email's ExtractedFields. Raw strings, missing -> null/[]/false."""
    client = client or anthropic.Anthropic(api_key=api_key)

    system = (
        "You extract structured fields from a single job-search email by calling "
        "the `extract` tool. Copy company and role text verbatim; never normalize "
        "or invent. " + _CATEGORY_HINT.get(category, "")
    )
    prompt = (
        f"Category: {category.value}\n"
        f"Subject: {email.subject}\n"
        f"From: {email.sender}\n"
        f"Body:\n{email.body}"
    )

    response = client.messages.create(
        model=config.MODEL_EXTRACTOR,
        max_tokens=1024,
        temperature=0,
        system=system,
        tools=[_EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "extract"},
        messages=[{"role": "user", "content": prompt}],
    )

    payload = _tool_payload(response)
    # model_validate applies ExtractedFields defaults for anything the model omitted,
    # and coerces an off-enum key-date type to `other` (see models.KeyDate).
    return ExtractedFields.model_validate(payload)


def _tool_payload(response) -> dict:
    """Pull the `extract` tool call's input dict; {} if the model didn't call it."""
    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "extract":
            return block.input
    return {}
