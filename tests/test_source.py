"""Tests for email_parser.source (T6). Gmail API fully mocked — no live call.

Covers the four source BDD scenarios (only-labelled ingested, HTML-only body,
multi-page fully ingested, expired-token aborts-before-write) plus FixtureSource
and the base64url/internalDate mapping.
"""

import base64
from datetime import timezone
from pathlib import Path

import pytest

from email_parser import config
from email_parser.models import RawEmail
from email_parser.source import (
    FixtureSource,
    GmailAuthError,
    GmailSource,
    _extract_body,
    _message_to_raw_email,
)

EMAILS_DIR = Path(__file__).parent / "fixtures" / "emails"


def _b64url(s: str) -> str:
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip("=")


def _msg(mid, *, plain=None, html=None, subject="S", sender="a@b.c", internal="1690000000000"):
    parts = []
    if plain is not None:
        parts.append({"mimeType": "text/plain", "body": {"data": _b64url(plain)}})
    if html is not None:
        parts.append({"mimeType": "text/html", "body": {"data": _b64url(html)}})
    return {
        "id": mid,
        "internalDate": internal,
        "payload": {
            "headers": [{"name": "Subject", "value": subject}, {"name": "From", "value": sender}],
            "mimeType": "multipart/alternative",
            "parts": parts,
        },
    }


class _FakeMessages:
    def __init__(self, pages, messages):
        self.pages = pages
        self.messages = messages
        self._by_token = {
            p["nextPageToken"]: pages[i + 1]
            for i, p in enumerate(pages)
            if "nextPageToken" in p
        }
        self.list_queries = []
        self.get_ids = []

    def list(self, userId, q, pageToken=None):
        self.list_queries.append(q)
        page = self.pages[0] if pageToken is None else self._by_token[pageToken]
        return _FakeExec(page)

    def get(self, userId, id, format):
        self.get_ids.append(id)
        return _FakeExec(self.messages[id])


class _FakeExec:
    def __init__(self, val):
        self._val = val

    def execute(self):
        return self._val


class _FakeService:
    def __init__(self, fake_messages):
        self._m = fake_messages

    def users(self):
        return self

    def messages(self):
        return self._m


# --- FixtureSource ---------------------------------------------------------

def test_fixturesource_reads_all_fixtures_as_rawemails():
    emails = FixtureSource(EMAILS_DIR).fetch()
    assert len(emails) == 5
    assert all(isinstance(e, RawEmail) for e in emails)
    # sorted by filename -> deterministic order
    assert emails[0].gmail_message_id == "msg-recruiter-001"


# --- only labelled mail is ingested ---------------------------------------

def test_fetch_queries_only_the_configured_label():
    fm = _FakeMessages(
        pages=[{"messages": [{"id": "m1"}]}],
        messages={"m1": _msg("m1", plain="hello")},
    )
    GmailSource(service=_FakeService(fm)).fetch()
    # The source passes config.GMAIL_QUERY verbatim to Gmail — assert the constant
    # is what's used (the keyword-scan net; not a hardcoded label).
    assert fm.list_queries == [config.GMAIL_QUERY]
    assert "interview" in config.GMAIL_QUERY and "application" in config.GMAIL_QUERY


# --- HTML-only email still yields a body ----------------------------------

def test_html_only_email_yields_stripped_body():
    msg = _msg("m1", html="<html><body><p>Hello <b>Acme</b></p><script>x=1</script></body></html>")
    email = _message_to_raw_email(msg)
    assert email.body.strip() != ""
    assert "<" not in email.body and ">" not in email.body
    assert "Hello Acme" in email.body
    assert "x=1" not in email.body  # script content dropped


def test_plain_wins_over_html_when_both_present():
    assert _extract_body(_msg("m", plain="PLAIN TEXT", html="<p>HTML</p>")["payload"]) == "PLAIN TEXT"


def test_empty_body_when_no_parts():
    assert _message_to_raw_email(_msg("m")).body == ""


def test_received_at_is_utc_aware_from_internaldate():
    email = _message_to_raw_email(_msg("m", plain="hi", internal="1690000000000"))
    assert email.received_at.tzinfo is not None
    assert email.received_at.utcoffset() == timezone.utc.utcoffset(None)


# --- label with more than one page is fully ingested ----------------------

def test_multipage_label_is_fully_ingested():
    ids = [f"m{i}" for i in range(150)]
    pages = [
        {"messages": [{"id": i} for i in ids[:100]], "nextPageToken": "T2"},
        {"messages": [{"id": i} for i in ids[100:]]},
    ]
    fm = _FakeMessages(pages=pages, messages={i: _msg(i, plain=f"body {i}") for i in ids})
    emails = GmailSource(service=_FakeService(fm)).fetch()
    assert len(emails) == 150
    assert {e.gmail_message_id for e in emails} == set(ids)
    assert fm.get_ids == ids  # every id fetched, none truncated


# --- expired Gmail token aborts before any write --------------------------

def test_expired_token_raises_before_touching_service():
    def _boom():
        raise GmailAuthError("token expired")

    src = GmailSource(authenticator=_boom)
    with pytest.raises(GmailAuthError):
        src.fetch()


def test_missing_token_file_raises_gmail_auth_error(tmp_path):
    src = GmailSource(token_file=tmp_path / "nope.json")
    with pytest.raises(GmailAuthError):
        src.fetch()  # no service ever built; deterministic, no google libs touched
