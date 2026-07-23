"""email_parser.pipeline — the one entry point that wires the whole flow.

`run(source, supabase, jobs, *, api_key, client=None) -> RunReport`: fetch emails,
skip ones already stored, then per email classify -> extract -> match -> insert an
`application` row. Returns a tally (fetched/skipped/inserted/linked/unlinked/errors).

Two invariants it must not get wrong:
  - **Idempotency** is belt-and-suspenders: a pre-filter skips gmail_message_ids
    already in `application`, and the DB UNIQUE constraint catches a concurrent
    race. A unique-violation (SQLSTATE 23505) on insert is counted as `skipped`,
    never raised.
  - **Per-email log-and-continue**: any OTHER failure on one email (a non-23505
    write error, or an LLM/parse failure) is appended to `RunReport.errors` and
    the batch continues — one bad row must not drop the rest, and nothing is lost
    silently because every failure is recorded.

An expired Gmail token raises `GmailAuthError` from `source.fetch()` BEFORE the
loop, so the run aborts before any write. Writes target `application` only — the
`job` table is never touched. `jobs` is fetched once by the caller (or the thin
`load_jobs` helper here) so the matcher stays pure.
"""

from postgrest.exceptions import APIError

from email_parser.classify import classify
from email_parser.extract_fields import extract
from email_parser.matcher import match
from email_parser.models import RunReport
from email_parser.source import EmailSource

_UNIQUE_VIOLATION = "23505"  # Postgres unique_violation SQLSTATE


def load_jobs(supabase) -> list[dict]:
    """Fetch the job rows the matcher compares against. Thin — matcher stays pure."""
    return supabase.table("job").select("id, company, title").execute().data


def run(source: EmailSource, supabase, jobs, *, api_key, client=None) -> RunReport:
    """Classify/extract/match each fetched email and insert an application row."""
    report = RunReport()

    existing = {
        row["gmail_message_id"]
        for row in supabase.table("application").select("gmail_message_id").execute().data
    }

    emails = source.fetch()  # GmailAuthError (expired token) propagates here — before any write
    report.fetched = len(emails)

    for email in emails:
        if email.gmail_message_id in existing:
            report.skipped += 1
            continue
        try:
            category = classify(email, api_key=api_key, client=client)
            fields = extract(email, category, api_key=api_key, client=client)
            job_id = match(fields, jobs)
            supabase.table("application").insert(
                _to_row(email, category, fields, job_id)
            ).execute()
            report.inserted += 1
            if job_id is not None:
                report.linked += 1
            else:
                report.unlinked += 1
            existing.add(email.gmail_message_id)  # guard against dup ids within this batch
        except APIError as e:
            if _is_unique_violation(e):
                report.skipped += 1  # tolerated race — already inserted concurrently
            else:
                report.errors.append(f"{email.gmail_message_id}: {e}")
        except Exception as e:  # noqa: BLE001 — per-email log-and-continue, never abort the batch
            report.errors.append(f"{email.gmail_message_id}: {e}")

    return report


def _is_unique_violation(err: APIError) -> bool:
    code = getattr(err, "code", None)
    return code == _UNIQUE_VIOLATION or _UNIQUE_VIOLATION in str(code or "")


def _to_row(email, category, fields, job_id) -> dict:
    """Shape one application row for insert. key_dates -> jsonb-ready list."""
    return {
        "gmail_message_id": email.gmail_message_id,
        "subject": email.subject,
        "sender": email.sender,
        "body": email.body,
        "received_at": email.received_at.isoformat(),
        "category": category.value,
        "company_raw": fields.company_raw,
        "role_raw": fields.role_raw,
        "contact_name": fields.contact_name,
        "key_dates": [kd.model_dump(mode="json") for kd in fields.key_dates],
        "action_required": fields.action_required,
        "action_description": fields.action_description,
        "extraction_confidence": fields.extraction_confidence,
        "job_id": job_id,
    }
