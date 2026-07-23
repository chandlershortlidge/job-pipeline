"""Seed a few THROWAWAY `application` rows for the dashboard screenshot (T10).

Not a pytest test — a hand-run helper. Inserts three demo rows via the
service-role key (public-read RLS blocks the anon key from writing): one linked
to a real `job` via `job_id`, one unlinked, one with `action_required`. Every
row carries a `seed-demo-*` gmail_message_id so cleanup deletes exactly these
and nothing else.

Preview deploys share the PROD Supabase, so these are disposable and must be
cleaned up (AGENTS.md). The `job` table is never written.

  uv run scripts/seed_applications.py          # insert the demo rows
  uv run scripts/seed_applications.py clean     # delete them again
"""

import os
import sys

from dotenv import load_dotenv
from supabase import create_client

# Fixed ids so cleanup targets exactly the rows this script created.
LINKED_ID = "seed-demo-linked"
UNLINKED_ID = "seed-demo-unlinked"
ACTION_ID = "seed-demo-action"
SEED_IDS = [LINKED_ID, UNLINKED_ID, ACTION_ID]


def _client():
    load_dotenv()
    return create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])


def _pick_job_id(client) -> str | None:
    """A real job.id for the linked demo row (None if the job table is empty)."""
    rows = client.table("job").select("id").limit(1).execute().data
    return rows[0]["id"] if rows else None


def seed(client) -> None:
    job_id = _pick_job_id(client)
    if job_id is None:
        print("WARNING: job table empty — the 'linked' row will be unlinked too.")

    rows = [
        {
            "gmail_message_id": LINKED_ID,
            "subject": "Interview invitation — Backend Engineer",
            "sender": "recruiting@acme.example",
            "body": "We'd like to invite you to interview for the Backend Engineer role.",
            "received_at": "2026-07-21T09:15:00+00:00",
            "category": "interview_invite",
            "company_raw": "Acme",
            "role_raw": "Backend Engineer",
            "contact_name": "Jordan Lee",
            "key_dates": [{"type": "interview", "date": "2026-08-04", "raw_text": "Aug 4 at 3pm"}],
            "action_required": False,
            "action_description": None,
            "extraction_confidence": "high",
            "job_id": job_id,  # linked to a real job ad
        },
        {
            "gmail_message_id": UNLINKED_ID,
            "subject": "Update on your application to Globex",
            "sender": "no-reply@globex.example",
            "body": "After careful consideration we have decided to move forward with other candidates.",
            "received_at": "2026-07-19T17:45:00+00:00",
            "category": "rejection",
            "company_raw": "Globex",
            "role_raw": "ML Engineer",
            "contact_name": None,
            "key_dates": [],
            "action_required": False,
            "action_description": None,
            "extraction_confidence": "low",  # exercises the low-confidence flag in the UI
            "job_id": None,  # no matching ad -> unlinked
        },
        {
            "gmail_message_id": ACTION_ID,
            "subject": "Action needed: confirm your availability",
            "sender": "recruiting@initech.example",
            "body": "Please confirm your availability for a screening call this week.",
            "received_at": "2026-07-22T06:00:00+00:00",
            "category": "recruiter_outreach",
            "company_raw": "Initech",
            "role_raw": "Platform Engineer",
            "contact_name": "Sam Rivera",
            "key_dates": [],
            "action_required": True,  # exercises the action-required badge
            "action_description": "Confirm availability for a screening call.",
            "extraction_confidence": "high",
            "job_id": None,
        },
    ]

    client.table("application").insert(rows).execute()
    print(f"seeded {len(rows)} demo application rows: {', '.join(SEED_IDS)}")


def clean(client) -> None:
    client.table("application").delete().in_("gmail_message_id", SEED_IDS).execute()
    print(f"deleted demo application rows: {', '.join(SEED_IDS)}")


def main() -> None:
    action = sys.argv[1] if len(sys.argv) > 1 else "seed"
    client = _client()
    if action == "clean":
        clean(client)
    elif action == "seed":
        seed(client)
    else:
        raise SystemExit(f"unknown action {action!r} — use 'seed' (default) or 'clean'.")


if __name__ == "__main__":
    main()
