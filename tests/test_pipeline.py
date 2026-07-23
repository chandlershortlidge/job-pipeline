"""Tests for email_parser.pipeline (T9). Supabase + LLM fully mocked — no live calls.

Covers the pipeline BDD scenarios: idempotent re-run, unique-violation tolerated
skip, non-unique write error doesn't abort the batch, a bad row never lands in
`job` (writes target `application` only), and expired-token aborts before write.
"""

from datetime import datetime, timezone

import pytest
from postgrest.exceptions import APIError

from email_parser.models import RawEmail
from email_parser.pipeline import run
from email_parser.source import EmailSource, GmailAuthError

JOBS = [{"id": "job-1", "company": "Acme", "title": "Backend Engineer"}]


def _email(mid, company="Acme", role="Backend Engineer"):
    return RawEmail(
        gmail_message_id=mid,
        subject=f"re {company}",
        sender="x@y.z",
        body=f"{company} {role}",
        received_at=datetime(2026, 7, 20, tzinfo=timezone.utc),
    )


# --- fakes -----------------------------------------------------------------

class _ListSource(EmailSource):
    def __init__(self, emails):
        self._emails = emails

    def fetch(self):
        return list(self._emails)


class _BoomSource(EmailSource):
    def fetch(self):
        raise GmailAuthError("expired token")


class _LLMBlock:
    type = "tool_use"

    def __init__(self, name, payload):
        self.name = name
        self.input = payload


class _LLMResponse:
    def __init__(self, content):
        self.content = content


class _FakeLLM:
    """One anthropic-like client; branches on the forced tool name."""

    def __init__(self, category="recruiter_outreach"):
        self._category = category
        self.messages = self._Messages(category)

    class _Messages:
        def __init__(self, category):
            self._category = category

        def create(self, **kw):
            name = kw["tool_choice"]["name"]
            if name == "classify":
                return _LLMResponse([_LLMBlock("classify", {"category": self._category})])
            # extract: echo the company verbatim from the prompt body (first token)
            body = kw["messages"][0]["content"].split("Body:\n", 1)[-1]
            company = body.split()[0] if body.split() else None
            return _LLMResponse([_LLMBlock("extract", {"company_raw": company, "role_raw": "Backend Engineer"})])


class _FakeQuery:
    def __init__(self, table):
        self._table = table

    def select(self, *_a, **_k):
        return self

    def insert(self, row):
        self._table.insert_calls.append(row)
        self._table._maybe_raise(row)
        return self

    def execute(self):
        return type("R", (), {"data": self._table.existing_rows})()


class _FakeTable:
    def __init__(self, name, existing_rows=None, raise_on_insert=None):
        self.name = name
        self.existing_rows = existing_rows or []
        self.insert_calls = []
        self._raise_on_insert = raise_on_insert  # callable(row) -> APIError | None

    def _maybe_raise(self, row):
        if self._raise_on_insert:
            err = self._raise_on_insert(row)
            if err:
                raise err


class _FakeSupabase:
    def __init__(self, application):
        self._tables = {"application": application, "job": _FakeTable("job")}

    def table(self, name):
        return _FakeQuery(self._tables[name])

    def application_inserts(self):
        return self._tables["application"].insert_calls

    def job_inserts(self):
        return self._tables["job"].insert_calls


# --- scenarios -------------------------------------------------------------

def test_idempotent_on_rerun():
    app = _FakeTable("application", existing_rows=[{"gmail_message_id": "abc"}])
    supa = _FakeSupabase(app)
    report = run(_ListSource([_email("abc")]), supa, JOBS, api_key="k", client=_FakeLLM())
    assert report.fetched == 1
    assert report.skipped == 1
    assert report.inserted == 0
    assert supa.application_inserts() == []  # nothing written on re-run


def test_unique_violation_is_a_tolerated_skip():
    def dup(_row):
        return APIError({"code": "23505", "message": "dup", "details": "", "hint": ""})

    app = _FakeTable("application", raise_on_insert=dup)
    supa = _FakeSupabase(app)
    report = run(_ListSource([_email("m1")]), supa, JOBS, api_key="k", client=_FakeLLM())
    assert report.skipped == 1
    assert report.inserted == 0
    assert report.errors == []  # a 23505 race is not an error


def test_non_unique_write_error_does_not_abort_batch():
    def fail_second(row):
        if row["gmail_message_id"] == "m2":
            return APIError({"code": "42P01", "message": "boom", "details": "", "hint": ""})
        return None

    app = _FakeTable("application", raise_on_insert=fail_second)
    supa = _FakeSupabase(app)
    emails = [_email("m1"), _email("m2"), _email("m3")]
    report = run(_ListSource(emails), supa, JOBS, api_key="k", client=_FakeLLM())
    assert report.inserted == 2  # m1 and m3 landed
    assert len(report.errors) == 1 and "m2" in report.errors[0]
    inserted_ids = {r["gmail_message_id"] for r in supa.application_inserts()}
    assert inserted_ids == {"m1", "m2", "m3"}  # m2 was attempted, then recorded as error


def test_writes_target_application_only_job_untouched():
    app = _FakeTable("application")
    supa = _FakeSupabase(app)
    report = run(_ListSource([_email("m1")]), supa, JOBS, api_key="k", client=_FakeLLM())
    assert report.inserted == 1 and report.linked == 1  # matched job-1
    assert supa.job_inserts() == []  # the job table is never written


def test_expired_token_aborts_before_any_write():
    app = _FakeTable("application")
    supa = _FakeSupabase(app)
    with pytest.raises(GmailAuthError):
        run(_BoomSource(), supa, JOBS, api_key="k", client=_FakeLLM())
    assert supa.application_inserts() == []  # nothing written


def test_other_is_dropped_not_stored():
    # Keyword-scan false positive: classifier says `other` -> drop, never insert.
    app = _FakeTable("application")
    supa = _FakeSupabase(app)
    report = run(_ListSource([_email("m1")]), supa, JOBS, api_key="k", client=_FakeLLM(category="other"))
    assert report.fetched == 1
    assert report.dropped == 1
    assert report.inserted == 0
    assert supa.application_inserts() == []  # nothing written for an `other` email


def test_report_counts_linked_vs_unlinked():
    app = _FakeTable("application")
    supa = _FakeSupabase(app)
    emails = [_email("m1", company="Acme"), _email("m2", company="Nonesuch")]
    report = run(_ListSource(emails), supa, JOBS, api_key="k", client=_FakeLLM())
    assert report.inserted == 2
    assert report.linked == 1    # m1 -> job-1
    assert report.unlinked == 1  # m2 -> no candidate
