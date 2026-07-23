"""Tests for email_parser.normalize — the NULL-safe matcher text key (T2).

Runs in a fresh process (default pytest invocation) so determinism is exercised,
not cached. Covers the spec's four named behaviours plus whitespace collapse and
the never-throws contract on non-string-ish input.
"""

from email_parser.normalize import normalize


def test_none_returns_empty():
    assert normalize(None) == ""


def test_empty_returns_empty():
    assert normalize("") == ""


def test_trims_and_collapses_internal_whitespace():
    # spec's worked example: "  Acme  Corp " -> "acme corp"
    assert normalize("  Acme  Corp ") == "acme corp"


def test_case_folds():
    assert normalize("PYTHON Corp") == "python corp"


def test_collapses_tabs_and_newlines():
    assert normalize("Acme\t\n  Corp") == "acme corp"


def test_whitespace_only_is_empty():
    assert normalize("   \t\n ") == ""


def test_already_clean_is_idempotent():
    once = normalize("acme corp")
    assert once == "acme corp"
    assert normalize(once) == once


def test_no_synonym_or_suffix_folding():
    # normalize is a cleanup key, NOT canonicalization: "Acme Inc" != "Acme".
    assert normalize("Acme Inc") != normalize("Acme")
