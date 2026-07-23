"""Tests for email_parser.extract_fields (T8). LLM fully mocked — no live call.

Covers the extractor BDD scenario (raw strings verbatim; low confidence never
blocks) plus the forced-tool contract, key_dates typing, and missing -> defaults.
"""

from datetime import date, datetime, timezone

from email_parser.extract_fields import extract
from email_parser.models import Category, ExtractedFields, KeyDateType, RawEmail


def _email():
    return RawEmail(
        gmail_message_id="m1",
        subject="Chat about a role?",
        sender="jordan@acmetalent.example",
        body="Hi, I'm a recruiter at Acme Inc. We have a Backend Engineer opening.",
        received_at=datetime.now(timezone.utc),
    )


class _Block:
    type = "tool_use"
    name = "extract"

    def __init__(self, payload):
        self.input = payload


class _Response:
    def __init__(self, payload):
        self.content = [_Block(payload)]


class _FakeMessages:
    def __init__(self, payload):
        self._payload = payload
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return _Response(self._payload)


class _FakeClient:
    def __init__(self, payload):
        self.messages = _FakeMessages(payload)


def test_keeps_raw_strings_and_low_confidence_never_blocks():
    payload = {
        "company_raw": "Acme Inc.",
        "role_raw": "Backend Engineer",
        "contact_name": "Jordan",
        "extraction_confidence": "low",
    }
    client = _FakeClient(payload)
    fields = extract(_email(), Category.recruiter_outreach, api_key="test", client=client)
    assert isinstance(fields, ExtractedFields)
    # verbatim passthrough, not canonicalized ("Inc." kept)
    assert fields.company_raw == "Acme Inc."
    assert fields.role_raw == "Backend Engineer"
    # low confidence is recorded but the call still returns fields (never blocks)
    assert fields.extraction_confidence == "low"


def test_missing_fields_default_to_null_empty_false():
    client = _FakeClient({})  # model returned an empty extract
    fields = extract(_email(), Category.other, api_key="test", client=client)
    assert fields.company_raw is None
    assert fields.role_raw is None
    assert fields.key_dates == []
    assert fields.action_required is False
    assert fields.extraction_confidence == "high"


def test_key_dates_typed_and_offvalue_coerces_to_other():
    payload = {
        "company_raw": "Acme",
        "role_raw": "Data Scientist",
        "key_dates": [
            {"type": "interview", "date": "2026-08-04", "raw_text": "Aug 4 at 3pm"},
            {"type": "not_a_real_type", "date": None, "raw_text": "soon"},
        ],
    }
    fields = extract(_email(), Category.interview_invite, api_key="test", client=_FakeClient(payload))
    assert fields.key_dates[0].type is KeyDateType.interview
    assert fields.key_dates[0].date == date(2026, 8, 4)
    assert fields.key_dates[1].type is KeyDateType.other  # off-value coerced


def test_forced_tool_contract():
    client = _FakeClient({"company_raw": "Acme"})
    extract(_email(), Category.recruiter_outreach, api_key="test", client=client)
    kw = client.messages.calls[0]
    assert kw["model"] == "claude-sonnet-4-6"
    assert kw["temperature"] == 0
    assert kw["tool_choice"] == {"type": "tool", "name": "extract"}
    (tool,) = kw["tools"]
    assert tool["name"] == "extract"
    props = tool["input_schema"]["properties"]
    assert "company_raw" in props and "role_raw" in props and "key_dates" in props
