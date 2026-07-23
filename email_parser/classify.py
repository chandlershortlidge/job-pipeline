"""email_parser.classify — put each email in one of five buckets (Haiku).

`classify(email, *, api_key, client=None) -> Category`. One Anthropic call per
email: model `claude-haiku-4-5`, temperature 0, a FORCED tool named `classify`
whose only input is the five-value category enum. Forcing the tool + the enum
means the model must return one of the five server-side; the off-enum ->
`other` coercion here is a defensive belt (its test documents intent, not an
observed failure). `client` is injectable so tests pass a mock — a live call in
a test is a bug (AGENTS.md).

Does NOT: extract fields (that's extract_fields.py), retry, or branch on
category. It answers exactly one question: which of the five is this.
"""

import anthropic

from email_parser import config
from email_parser.models import Category, RawEmail

_CATEGORY_VALUES = [c.value for c in Category]

_CLASSIFY_TOOL = {
    "name": "classify",
    "description": (
        "Record the single category that best describes this job-search email. "
        "Choose exactly one of the allowed values."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "enum": _CATEGORY_VALUES,
                "description": (
                    "recruiter_outreach: a recruiter/company reaching out about a role. "
                    "interview_invite: an invitation or scheduling for an interview. "
                    "rejection: a 'not moving forward' decision. "
                    "application_confirmation: 'we received your application'. "
                    "other: anything else (newsletters, unrelated mail)."
                ),
            }
        },
        "required": ["category"],
        "additionalProperties": False,
    },
}

_SYSTEM = (
    "You classify a single job-search email into exactly one category by calling "
    "the `classify` tool. Judge only from the email's subject, sender, and body."
)


def classify(email: RawEmail, *, api_key: str, client: anthropic.Anthropic | None = None) -> Category:
    """Return the email's Category. Off-enum model output coerces to `other`."""
    client = client or anthropic.Anthropic(api_key=api_key)

    prompt = (
        f"Subject: {email.subject}\n"
        f"From: {email.sender}\n"
        f"Body:\n{email.body}"
    )

    response = client.messages.create(
        model=config.MODEL_CLASSIFIER,
        max_tokens=256,
        temperature=0,
        system=_SYSTEM,
        tools=[_CLASSIFY_TOOL],
        tool_choice={"type": "tool", "name": "classify"},
        messages=[{"role": "user", "content": prompt}],
    )

    raw = _tool_category(response)
    try:
        return Category(raw)
    except ValueError:
        return Category.other  # defensive: off-enum -> other (never blocks the row)


def _tool_category(response) -> object:
    """Pull the `category` field out of the forced `classify` tool call."""
    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "classify":
            return block.input.get("category")
    return None  # no tool call -> coerces to other upstream
