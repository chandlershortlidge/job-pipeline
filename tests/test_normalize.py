"""Tests for the deterministic normalization primitives in normalize.py.

Covers only the pure, top-level pieces: split_skill() and the SPLITS / ALIASES
tables. The resolution / per-job dedup / clean_variants logic still lives inside
normalize.main() (mixed with file I/O), so it is deferred until that is refactored
into pure functions — see AGENTS.md's layout rules.
"""

import normalize


class TestSplitSkill:
    def test_splits_a_known_slash_list(self):
        assert normalize.split_skill("GCP/AWS/Azure") == ["GCP", "AWS", "Azure"]

    def test_split_key_lookup_is_case_insensitive(self):
        assert normalize.split_skill("gcp/aws/azure") == ["GCP", "AWS", "Azure"]

    def test_protected_slash_terms_do_not_split(self):
        # CI/CD, A/B Testing, ETL/ELT are single skills — they must stay intact.
        assert normalize.split_skill("CI/CD") == ["CI/CD"]
        assert normalize.split_skill("A/B Testing") == ["A/B Testing"]

    def test_non_split_skill_is_stripped(self):
        assert normalize.split_skill("  Python  ") == ["Python"]

    def test_unknown_skill_returned_as_single_item(self):
        assert normalize.split_skill("Kubernetes") == ["Kubernetes"]


class TestAliasAndSplitTables:
    def test_alias_keys_are_lowercased(self):
        # resolve() looks aliases up by lowercased key, so a non-lowercased key would
        # silently never match — guard against that dead-entry bug.
        for key in normalize.ALIASES:
            assert key == key.lower(), f"alias key not lowercased: {key!r}"

    def test_alias_values_are_nonempty(self):
        for key, value in normalize.ALIASES.items():
            assert value and value.strip(), f"empty canonical for alias {key!r}"

    def test_split_keys_lowercased_and_values_nonempty(self):
        for key, parts in normalize.SPLITS.items():
            assert key == key.lower(), f"split key not lowercased: {key!r}"
            assert parts and all(p.strip() for p in parts), f"bad split value for {key!r}"
