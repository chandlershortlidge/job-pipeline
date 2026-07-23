"""One-time Gmail OAuth consent — mints the token GmailSource reads (Phase 1).

`GmailSource` only *loads* a cached token; it never runs the initial browser
consent. This script closes that gap: it runs the InstalledAppFlow desktop
consent once and writes `email_parser/.gmail_token.json` (gitignored). Re-run it
when the token lapses (Testing-mode OAuth expires ~7 days).

Prereq: a Google Cloud OAuth **desktop** client secret saved as
`email_parser/.gmail_credentials.json`. See the README / DECISIONS for the
Google Cloud steps.

  uv run scripts/gmail_auth.py
"""

from pathlib import Path

from email_parser import config
from email_parser.source import GMAIL_SCOPES


def bootstrap(*, credentials_file=None, token_file=None, flow_factory=None, open_browser=True) -> Path:
    """Run consent, write the token, return its path. `flow_factory` is injectable
    so tests never open a browser."""
    cred = Path(credentials_file or config.GMAIL_CREDENTIALS_FILE)
    tok = Path(token_file or config.GMAIL_TOKEN_FILE)

    if flow_factory is None:
        if not cred.exists():
            raise SystemExit(
                f"Missing {cred}. Create a Google Cloud OAuth *desktop* client, "
                "download the client-secret JSON, and save it there."
            )
        from google_auth_oauthlib.flow import InstalledAppFlow

        def flow_factory():  # noqa: E306 - local default
            return InstalledAppFlow.from_client_secrets_file(str(cred), GMAIL_SCOPES)

    flow = flow_factory()
    creds = flow.run_local_server(port=0) if open_browser else flow.run_console()
    tok.write_text(creds.to_json())
    return tok


def main() -> None:
    path = bootstrap()
    print(f"Gmail token written to {path}. You can now run scripts/run_parser.py.")


if __name__ == "__main__":
    main()
