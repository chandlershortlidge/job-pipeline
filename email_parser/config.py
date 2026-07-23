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
# Keyword-scan fetch (see DECISIONS.md 2026-07-23): a broad, high-RECALL net over
# the whole inbox. This stage is deliberately dumb — Gmail does literal keyword
# matching, no judgement. Its only job is to over-fetch candidate emails; the
# Haiku classifier is the PRECISION filter that decides real category vs `other`,
# and the pipeline drops `other` (never stored). Broad domain words + the common
# ATS sender platforms; outcome phrases ("rejected", "not moving forward") are the
# LLM's call, NOT search terms. Widen/narrow here; add `newer_than:Nd` to bound it.
GMAIL_QUERY = (
    'interview OR "phone screen" OR application OR applied OR candidate '
    'OR role OR position OR opening OR hiring OR offer '
    'OR greenhouse OR lever OR ashby OR workday OR myworkday'
)

# OAuth desktop credentials + refreshable token cache. Both gitignored — secrets,
# same rule as .env. Paths are relative to this package directory.
_PKG_DIR = Path(__file__).resolve().parent
GMAIL_CREDENTIALS_FILE = _PKG_DIR / ".gmail_credentials.json"  # OAuth client secret
GMAIL_TOKEN_FILE = _PKG_DIR / ".gmail_token.json"  # cached refresh token
