"""email_parser.models — the typed contract for the email->application pipeline.

Pydantic v2 models, one per row/shape the pipeline moves: what Gmail hands us
(`RawEmail`), what the classifier/extractor produce (`Category`, `KeyDateType`,
`KeyDate`, `ExtractedFields`), what lands in Supabase (`Application`), and the
per-run tally the pipeline returns (`RunReport`). Mirrors spec §3 field-for-field.

Two deliberate softness points, both so a slightly-off model output degrades
instead of aborting the run:
  - `KeyDateType` coerces an unrecognised value to `other` (a before-validator),
    mirroring the classifier's off-enum handling.
  - `extraction_confidence` is advisory only — it is a value on the row, NEVER a
    gate on whether the row is written.

Does NOT: talk to Supabase or Gmail, canonicalize company/role text, or validate
that dates are sane (a bad date is kept verbatim in `KeyDate.raw_text` so it is
spottable downstream, not silently dropped).
"""

import datetime as dt
from enum import Enum

from pydantic import BaseModel, Field, field_validator


class Category(str, Enum):
    """The five buckets an email is classified into. Strict enum at the model
    boundary — the classifier layer (classify.py) coerces off-enum output to
    `other` before it ever reaches a model."""

    recruiter_outreach = "recruiter_outreach"
    interview_invite = "interview_invite"
    rejection = "rejection"
    application_confirmation = "application_confirmation"
    other = "other"


class KeyDateType(str, Enum):
    interview = "interview"
    deadline = "deadline"
    response_by = "response_by"
    start_date = "start_date"
    other = "other"


class RawEmail(BaseModel):
    """A single fetched Gmail message, pre-classification."""

    gmail_message_id: str  # idempotency key
    subject: str
    sender: str  # raw From header
    body: str  # plain-text body
    received_at: dt.datetime  # timezone-aware (UTC)


class KeyDate(BaseModel):
    type: KeyDateType  # off-value coerces to `other` (see validator)
    date: dt.date | None = None  # parsed ISO date; None if unparseable
    raw_text: str  # verbatim source phrase

    @field_validator("type", mode="before")
    @classmethod
    def _coerce_unknown_type(cls, v: object) -> object:
        """An unrecognised key-date type degrades to `other` rather than raising,
        mirroring the classifier. Known values (enum members or their string
        value) pass through untouched."""
        if isinstance(v, KeyDateType):
            return v
        if isinstance(v, str) and v in KeyDateType._value2member_map_:
            return v
        return KeyDateType.other


class ExtractedFields(BaseModel):
    """What the extractor returns — raw strings, never canonicalized."""

    company_raw: str | None = None
    role_raw: str | None = None
    contact_name: str | None = None
    key_dates: list[KeyDate] = Field(default_factory=list)
    action_required: bool = False
    action_description: str | None = None
    extraction_confidence: str = "high"  # advisory only: "high" | "low", NEVER a gate


class Application(BaseModel):
    """The persisted `application` row."""

    id: int  # DB-assigned serial
    gmail_message_id: str  # UNIQUE
    subject: str
    sender: str
    body: str
    received_at: dt.datetime
    category: Category | None = None  # null until classified
    company_raw: str | None = None
    role_raw: str | None = None
    contact_name: str | None = None
    action_description: str | None = None
    key_dates: list[KeyDate] = Field(default_factory=list)  # stored as jsonb
    action_required: bool = False
    extraction_confidence: str = "high"
    job_id: str | None = None  # TEXT FK -> job.id
    created_at: dt.datetime  # DB default now()


class RunReport(BaseModel):
    """The tally pipeline.run() returns. Counts, plus per-email failure notes."""

    fetched: int = 0
    skipped: int = 0
    dropped: int = 0  # classified `other` by the relevance filter — fetched but not stored
    inserted: int = 0
    linked: int = 0
    unlinked: int = 0
    errors: list[str] = Field(default_factory=list)
