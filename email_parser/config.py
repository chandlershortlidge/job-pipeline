"""email_parser.config — pinned constants for the email→application pipeline.

Single home for model ids, the Gmail fetch query, and the OAuth credential/token
file paths. Keeping them here (not scattered as literals) means a change is
one-line and testable — tests assert against these constants rather than magic
strings.

Does NOT: hold secrets. The credential/token FILES it points at are gitignored
and never committed; this module only names their paths. Runtime secrets
(ANTHROPIC_API_KEY, SUPABASE_*) come from the environment, not from here.
"""

from pathlib import Path

# --- Models (match the repo's existing pins: dashboard/api-lib/tailor/prompts.js,
#     dashboard/api/extract.js) ---
MODEL_CLASSIFIER = "claude-haiku-4-5"  # cheap 5-way label
MODEL_EXTRACTOR = "claude-sonnet-4-6"  # field extraction (same id as extract.js)

# --- Gmail ---
# Curated fetch: only messages the user has labelled "job-search" enter the
# pipeline (NOT a time window, which would pull in unrelated mail as `other`).
GMAIL_QUERY = "label:job-search"

# OAuth desktop credentials + refreshable token cache. Both gitignored — secrets,
# same rule as .env. Paths are relative to this package directory.
_PKG_DIR = Path(__file__).resolve().parent
GMAIL_CREDENTIALS_FILE = _PKG_DIR / ".gmail_credentials.json"  # OAuth client secret
GMAIL_TOKEN_FILE = _PKG_DIR / ".gmail_token.json"  # cached refresh token
