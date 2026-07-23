"""email_parser.source — where emails come from, behind one interface.

The pipeline only ever calls `EmailSource.fetch() -> list[RawEmail]`, so nothing
outside this module knows about Gmail. Two implementations:

  - `FixtureSource(dir)` — reads pre-built RawEmail JSON from a directory. No
    network, deterministic; every test uses this.
  - `GmailSource` — the real thing: OAuth2 desktop flow, a locally-cached
    refreshable token, `users.messages.list` PAGINATED through every page (a
    label commonly exceeds one 100-id page — page 1 is not the whole inbox), then
    `messages.get` per id mapped to a RawEmail. Body is the text/plain part; if
    there is none, the text/html part tag-stripped with the stdlib html.parser
    (no new dependency — many recruiter/LinkedIn mails are HTML-only); else "".

An expired/invalid token raises `GmailAuthError` (testing-mode tokens die every 7
days) so the pipeline aborts loudly BEFORE any write, never half-processing.

Does NOT: write anything, classify, or extract — it only produces RawEmail. The
Gmail service and the authenticator are injectable so tests never touch the wire.
"""

import base64
import json
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

from email_parser import config
from email_parser.models import RawEmail

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


class GmailAuthError(Exception):
    """Cached Gmail token is missing/expired/un-refreshable. Re-run the OAuth flow."""


class EmailSource(ABC):
    """The only contract the pipeline depends on."""

    @abstractmethod
    def fetch(self) -> list[RawEmail]:
        ...


class FixtureSource(EmailSource):
    """Reads `<dir>/*.json`, each a RawEmail-shaped dict. Deterministic (sorted)."""

    def __init__(self, dir: str | Path):
        self.dir = Path(dir)

    def fetch(self) -> list[RawEmail]:
        emails = []
        for path in sorted(self.dir.glob("*.json")):
            emails.append(RawEmail.model_validate_json(path.read_text()))
        return emails


# --- Gmail body / header parsing (pure; unit-tested directly on message dicts) ---

class _TextExtractor(HTMLParser):
    """Collects visible text, dropping script/style content."""

    def __init__(self):
        super().__init__()
        self._chunks: list[str] = []
        self._skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip = True

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._skip = False

    def handle_data(self, data):
        if not self._skip and data.strip():
            self._chunks.append(data)

    def text(self) -> str:
        # collapse whitespace runs across collected nodes
        return " ".join(" ".join(self._chunks).split())


def _strip_html(html: str) -> str:
    p = _TextExtractor()
    p.feed(html)
    return p.text()


def _decode_b64url(data: str) -> str:
    # Gmail returns URL-safe base64, padding sometimes stripped.
    padded = data + "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(padded).decode("utf-8", errors="replace")


def _walk_parts(payload: dict):
    """Yield (mimeType, data) for every leaf part with body data."""
    parts = payload.get("parts")
    if parts:
        for part in parts:
            yield from _walk_parts(part)
        return
    data = payload.get("body", {}).get("data")
    if data:
        yield payload.get("mimeType", ""), data


def _extract_body(payload: dict) -> str:
    """text/plain wins; else tag-stripped text/html; else "". First non-empty."""
    plain = None
    html = None
    for mime, data in _walk_parts(payload):
        text = _decode_b64url(data)
        if not text.strip():
            continue
        if mime == "text/plain" and plain is None:
            plain = text
        elif mime == "text/html" and html is None:
            html = text
    if plain is not None:
        return plain
    if html is not None:
        return _strip_html(html)
    return ""


def _header(headers: list[dict], name: str) -> str:
    target = name.lower()
    for h in headers:
        if h.get("name", "").lower() == target:
            return h.get("value", "")
    return ""


def _message_to_raw_email(msg: dict) -> RawEmail:
    payload = msg.get("payload", {})
    headers = payload.get("headers", [])
    internal_ms = int(msg["internalDate"])
    return RawEmail(
        gmail_message_id=msg["id"],
        subject=_header(headers, "Subject"),
        sender=_header(headers, "From"),
        body=_extract_body(payload),
        received_at=datetime.fromtimestamp(internal_ms / 1000, tz=timezone.utc),
    )


class GmailSource(EmailSource):
    """Fetches labelled Gmail as RawEmail. `service`/`authenticator` injectable."""

    def __init__(
        self,
        *,
        service=None,
        authenticator=None,
        query: str | None = None,
        token_file: Path | None = None,
        credentials_file: Path | None = None,
    ):
        self._service = service
        self._authenticator = authenticator  # callable() -> service, may raise GmailAuthError
        self.query = query or config.GMAIL_QUERY
        self.token_file = token_file or config.GMAIL_TOKEN_FILE
        self.credentials_file = credentials_file or config.GMAIL_CREDENTIALS_FILE

    def _resolve_service(self):
        if self._service is not None:
            return self._service
        if self._authenticator is not None:
            return self._authenticator()
        return self._default_authenticate()

    def _default_authenticate(self):
        """Load the cached token, refresh if needed, build the Gmail service.
        Any missing/expired/un-refreshable token -> GmailAuthError."""
        if not self.token_file.exists():
            raise GmailAuthError(
                f"No cached Gmail token at {self.token_file}. Run the OAuth flow."
            )
        # Imports are local so the module (and every test) loads without google libs.
        from google.auth.exceptions import RefreshError
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        creds = Credentials.from_authorized_user_file(str(self.token_file), GMAIL_SCOPES)
        if not creds.valid:
            if creds.expired and creds.refresh_token:
                try:
                    creds.refresh(Request())
                except RefreshError as e:
                    raise GmailAuthError(
                        "Gmail token expired and refresh failed. Re-run the OAuth flow."
                    ) from e
                self.token_file.write_text(creds.to_json())
            else:
                raise GmailAuthError(
                    "Gmail token invalid/expired. Re-run the OAuth flow."
                )
        return build("gmail", "v1", credentials=creds)

    def fetch(self) -> list[RawEmail]:
        service = self._resolve_service()  # raises GmailAuthError before any read/write
        messages = service.users().messages()

        ids: list[str] = []
        page_token = None
        while True:
            resp = messages.list(userId="me", q=self.query, pageToken=page_token).execute()
            ids += [m["id"] for m in resp.get("messages", [])]
            page_token = resp.get("nextPageToken")
            if not page_token:
                break

        emails: list[RawEmail] = []
        for mid in ids:
            msg = messages.get(userId="me", id=mid, format="full").execute()
            emails.append(_message_to_raw_email(msg))
        return emails
