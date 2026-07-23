"""Tests for email_parser.models — Pydantic v2 contract (T3).

Covers enum bounds, the KeyDateType off-value -> other coercion, the applied
defaults (key_dates=[], action_required=False), and a key_dates round-trip
through JSON so the typed nested shape is exercised end to end.
"""

from datetime import date, datetime, timezone

import pytest
from pydantic import ValidationError

from email_parser.models import (
    Application,
    Category,
    ExtractedFields,
    KeyDate,
    KeyDateType,
    RawEmail,
    RunReport,
)


# --- enums -----------------------------------------------------------------

def test_category_accepts_all_five_values():
    vals = {c.value for c in Category}
    assert vals == {
        "recruiter_outreach",
        "interview_invite",
        "rejection",
        "application_confirmation",
        "other",
    }


def test_category_rejects_off_enum_at_model_boundary():
    # Application.category is strict — off-enum is a validation error here;
    # the classify layer is what coerces before a model is built.
    with pytest.raises(ValidationError):
        Application(
            id=1,
            gmail_message_id="m1",
            subject="s",
            sender="a@b.c",
            body="b",
            received_at=datetime.now(timezone.utc),
            category="not_a_category",
            created_at=datetime.now(timezone.utc),
        )


def test_keydatetype_off_value_coerces_to_other():
    kd = KeyDate(type="not_a_real_type", raw_text="next Tuesday")
    assert kd.type is KeyDateType.other


def test_keydatetype_known_value_passes_through():
    kd = KeyDate(type="interview", raw_text="Mon 3pm")
    assert kd.type is KeyDateType.interview


# --- defaults --------------------------------------------------------------

def test_extractedfields_defaults_applied():
    ef = ExtractedFields()
    assert ef.key_dates == []
    assert ef.action_required is False
    assert ef.company_raw is None
    assert ef.role_raw is None
    assert ef.extraction_confidence == "high"


def test_extractedfields_default_list_not_shared():
    a = ExtractedFields()
    b = ExtractedFields()
    a.key_dates.append(KeyDate(type="deadline", raw_text="Fri"))
    assert b.key_dates == []  # default_factory, not a shared mutable


def test_runreport_defaults_zeroed():
    r = RunReport()
    assert (r.fetched, r.skipped, r.inserted, r.linked, r.unlinked) == (0, 0, 0, 0, 0)
    assert r.errors == []


# --- round-trip ------------------------------------------------------------

def test_key_dates_typed_shape_round_trips():
    ef = ExtractedFields(
        company_raw="Acme",
        role_raw="ML Engineer",
        key_dates=[
            KeyDate(type="interview", date=date(2026, 8, 1), raw_text="Aug 1"),
            KeyDate(type="response_by", date=None, raw_text="ASAP"),
        ],
    )
    restored = ExtractedFields.model_validate_json(ef.model_dump_json())
    assert restored == ef
    assert restored.key_dates[0].type is KeyDateType.interview
    assert restored.key_dates[0].date == date(2026, 8, 1)
    assert restored.key_dates[1].date is None


def test_rawemail_requires_tz_aware_datetime_field():
    # received_at accepts a tz-aware datetime; the field is required.
    e = RawEmail(
        gmail_message_id="m1",
        subject="s",
        sender="a@b.c",
        body="hi",
        received_at=datetime(2026, 7, 22, 12, 0, tzinfo=timezone.utc),
    )
    assert e.received_at.tzinfo is not None
