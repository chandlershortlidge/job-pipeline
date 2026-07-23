"""Local hand-triggered parser run: Gmail keyword scan → application rows (Phase 1).

Wires the real GmailSource (keyword net = config.GMAIL_QUERY) → load_jobs →
pipeline.run, using ANTHROPIC_API_KEY and the Supabase service-role key, and
prints the RunReport. This is the laptop entry point the empty-state hints at
("run the email parser"); it writes application rows the dashboard then reads.

Prereqs:
  - scripts/gmail_auth.py run once (cached Gmail token).
  - .env with ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

  uv run scripts/run_parser.py
"""

import os

from dotenv import load_dotenv
from supabase import create_client

from email_parser.pipeline import load_jobs, run
from email_parser.source import GmailAuthError, GmailSource


def main() -> None:
    load_dotenv()
    api_key = os.environ["ANTHROPIC_API_KEY"]
    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    source = GmailSource()  # keyword-scan query + cached token from gmail_auth.py
    jobs = load_jobs(supabase)
    print(f"scanning inbox (query: {source.query[:60]}…) against {len(jobs)} saved jobs")

    try:
        report = run(source, supabase, jobs, api_key=api_key)
    except GmailAuthError as e:
        raise SystemExit(f"Gmail auth failed: {e}\nRun `uv run scripts/gmail_auth.py` first.")

    print("--- RunReport ---")
    print(f"  fetched : {report.fetched}")
    print(f"  skipped : {report.skipped}  (already stored)")
    print(f"  dropped : {report.dropped}  (classified 'other' — not a job email)")
    print(f"  inserted: {report.inserted}  (linked {report.linked} / unlinked {report.unlinked})")
    if report.errors:
        print(f"  errors  : {len(report.errors)}")
        for e in report.errors:
            print("    -", e)


if __name__ == "__main__":
    main()
