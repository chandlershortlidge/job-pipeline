"""One-call smoke test for both model providers.

Proves each API key in .env actually works before the hackathon, so whichever
provider supplies credits on the day, you already know it's wired up.
Run with: uv run test_key.py
"""

import os

from dotenv import load_dotenv

load_dotenv()

PROMPT = "Say hello in 3 words."


def test_openai() -> None:
    from openai import OpenAI

    client = OpenAI()  # reads OPENAI_API_KEY from the environment
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": PROMPT}],
    )
    print("OpenAI  reply:", resp.choices[0].message.content.strip())


def test_anthropic() -> None:
    from anthropic import Anthropic

    client = Anthropic()  # reads ANTHROPIC_API_KEY from the environment
    resp = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=20,
        messages=[{"role": "user", "content": PROMPT}],
    )
    print("Claude  reply:", resp.content[0].text.strip())


def main() -> None:
    for name, key, runner in (
        ("OpenAI", "OPENAI_API_KEY", test_openai),
        ("Anthropic", "ANTHROPIC_API_KEY", test_anthropic),
    ):
        if not os.getenv(key):
            print(f"[{name}] SKIPPED — {key} not set in .env")
            continue
        try:
            runner()
            print(f"[{name}] OK\n")
        except Exception as e:  # noqa: BLE001 - we want to see any failure per provider
            print(f"[{name}] FAILED — {type(e).__name__}: {e}\n")


if __name__ == "__main__":
    main()
