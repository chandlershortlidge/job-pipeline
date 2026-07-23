"""email_parser.normalize — one NULL-safe text key used by the matcher.

`normalize(s)` turns a raw company/role/title string into a comparison key:
lowercase, trimmed, internal whitespace collapsed to single spaces. `None` and
`""` both become `""` so the matcher can test `== ""` instead of guarding for
None everywhere. Pure — no I/O, deterministic, safe to call in any process.

Does NOT: canonicalize. No synonym folding, no legal-suffix stripping
("Acme Inc" and "Acme" stay different keys), no unicode normalization. The
matcher wants exact-after-cleanup equality, not fuzzy company matching — that
would risk linking an application to the wrong job ad.
"""


def normalize(s: str | None) -> str:
    """Lowercase, strip, collapse internal whitespace. None/"" -> "". Never raises."""
    if not s:
        return ""
    # str.split() with no args splits on any whitespace run and drops empties,
    # so join-on-space collapses internal runs and trims the ends in one step.
    return " ".join(s.split()).lower()
