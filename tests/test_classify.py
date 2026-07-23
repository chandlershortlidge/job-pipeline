"""Tests for email_parser.classify (T7). LLM fully mocked — no live call.

Covers the two classify BDD scenarios (assigns one of five; off-enum coerces to
other) plus the forced-tool request contract (model, temp 0, tool_choice).
"""

from datetime import datetime, timezone

from email_parser.classify import classify
from email_parser.models import Category, RawEmail


def _email():
    return RawEmail(
        gmail_message_id="m1",
        subject="Update on your application",
        sender="no-reply@globex.example",
        body="We have decided to move forward with other candidates.",
        received_at=datetime.now(timezone.utc),
    )


class _Block:
    type = "tool_use"
    name = "classify"

    def __init__(self, category):
        self.input = {"category": category}


class _Response:
    def __init__(self, category):
        self.content = [_Block(category)]


class _FakeMessages:
    def __init__(self, category):
        self._category = category
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return _Response(self._category)


class _FakeClient:
    def __init__(self, category):
        self.messages = _FakeMessages(category)


def test_classification_assigns_one_of_five_categories():
    client = _FakeClient("rejection")
    result = classify(_email(), api_key="test", client=client)
    assert isinstance(result, Category)
    assert result in set(Category)
    assert result is Category.rejection


def test_off_enum_output_coerces_to_other():
    client = _FakeClient("spam_not_a_category")
    result = classify(_email(), api_key="test", client=client)
    assert result is Category.other


def test_missing_tool_call_coerces_to_other():
    class _EmptyResp:
        content = []

    class _M:
        def create(self, **kwargs):
            return _EmptyResp()

    class _C:
        messages = _M()

    assert classify(_email(), api_key="test", client=_C()) is Category.other


def test_forced_tool_contract():
    client = _FakeClient("recruiter_outreach")
    classify(_email(), api_key="test", client=client)
    kw = client.messages.calls[0]
    assert kw["model"] == "claude-haiku-4-5"
    assert kw["temperature"] == 0
    assert kw["tool_choice"] == {"type": "tool", "name": "classify"}
    # the single tool is the classify tool with the five-value enum
    (tool,) = kw["tools"]
    assert tool["name"] == "classify"
    assert set(tool["input_schema"]["properties"]["category"]["enum"]) == {
        "recruiter_outreach",
        "interview_invite",
        "rejection",
        "application_confirmation",
        "other",
    }
