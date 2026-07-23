"""Tests for email_parser.matcher — the pure email->job link (T4).

One test per spec §2 BDD scenario (8 total). Runs in a fresh process. The frozen
`jobs_snapshot.json` supplies the shared job table (>=2 same-company Acme, a
null-company row, a null-title row); a couple of scenarios that need a specific
title arrangement build their jobs inline.
"""

import json
from pathlib import Path

from email_parser.matcher import match
from email_parser.models import ExtractedFields

JOBS = json.loads((Path(__file__).parent / "fixtures" / "jobs_snapshot.json").read_text())


def rec(company_raw=None, role_raw=None):
    return ExtractedFields(company_raw=company_raw, role_raw=role_raw)


def test_unambiguous_single_match_links():
    # Globex has exactly one open role in the snapshot.
    assert match(rec(company_raw="globex"), JOBS) == "job-3"


def test_no_candidate_company_stays_unlinked():
    assert match(rec(company_raw="Nonesuch"), JOBS) is None


def test_empty_company_raw_stays_unlinked():
    assert match(rec(company_raw=None), JOBS) is None
    assert match(rec(company_raw=""), JOBS) is None
    assert match(rec(company_raw="   "), JOBS) is None  # whitespace normalizes to ""


def test_two_roles_same_company_resolved_by_role_token():
    # Acme job-1 "Senior Backend Engineer" vs job-2 "Data Scientist".
    assert match(rec(company_raw="Acme", role_raw="backend engineer"), JOBS) == "job-1"


def test_two_roles_same_company_no_role_text_stays_unlinked():
    assert match(rec(company_raw="Acme", role_raw=None), JOBS) is None
    assert match(rec(company_raw="Acme", role_raw=""), JOBS) is None


def test_two_roles_same_company_non_overlapping_role_stays_unlinked():
    assert match(rec(company_raw="Acme", role_raw="Product Manager"), JOBS) is None


def test_null_title_candidate_never_wins_tiebreak():
    jobs = [
        {"id": "acme-null", "company": "Acme", "title": None},
        {"id": "acme-be", "company": "Acme", "title": "Backend Engineer"},
    ]
    assert match(rec(company_raw="Acme", role_raw="backend"), jobs) == "acme-be"


def test_matcher_never_raises_on_null_fields():
    # jobs contains null company (job-4) and null title (job-5); records vary.
    for r in [
        rec(),
        rec(company_raw="Acme", role_raw="engineer"),
        rec(company_raw="Initech", role_raw="anything"),  # Initech title is null
        rec(company_raw=None, role_raw=None),
    ]:
        result = match(r, JOBS)
        assert result is None or isinstance(result, str)
