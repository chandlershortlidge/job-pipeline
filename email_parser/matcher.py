"""email_parser.matcher — link an extracted email to a saved job ad, or don't.

`match(record, jobs)` returns a `job.id` when the email unambiguously belongs to
one saved ad, else `None`. This is the load-bearing step: a wrong link files an
application under the wrong job. So it is pure, fully enumerated, and NEVER
guesses — two plausible candidates with nothing to separate them return `None`
(stay unlinked) rather than a coin-flip. Under-linking is safe; mis-linking is not.

Matching key is `normalize()` only (lowercase/strip/collapse) — no synonym or
legal-suffix folding. Company must match exactly-after-cleanup; when one company
has several open roles, a shared role token breaks the tie, and only a unique
survivor wins.

Does NOT: do I/O, call an LLM, canonicalize names, or raise on null fields — a
`jobs` list with null company/title is handled, not a crash.
"""

from email_parser.models import ExtractedFields
from email_parser.normalize import normalize


def match(record: ExtractedFields, jobs: list[dict]) -> str | None:
    """Return a job.id for an unambiguous link, else None. Never raises on null
    fields. Algorithm is spec §2, in order — order matters."""
    company_key = normalize(record.company_raw)
    if company_key == "":
        return None  # nothing to match on; never inspect jobs

    candidates = [
        j
        for j in jobs
        if normalize(j.get("company")) == company_key and normalize(j.get("company")) != ""
    ]

    if len(candidates) == 0:
        return None
    if len(candidates) == 1:
        return candidates[0]["id"]

    # >= 2 candidates: same company, multiple open roles — need a role tiebreak.
    role_key = normalize(record.role_raw)
    if role_key == "":
        return None  # nothing to disambiguate on; never guess

    role_tokens = set(role_key.split())
    survivors = [
        j for j in candidates if set(normalize(j.get("title")).split()) & role_tokens
    ]
    # A null/empty title -> "" -> empty token set -> never intersects -> never survives.
    if len(survivors) == 1:
        return survivors[0]["id"]
    return None  # zero or ambiguous survivors -> stay unlinked
