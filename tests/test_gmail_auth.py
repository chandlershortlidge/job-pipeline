"""Tests for scripts/gmail_auth.py (Phase 1). Flow injected — no browser, no network."""

import importlib

from scripts.gmail_auth import bootstrap


class _FakeCreds:
    def to_json(self):
        return '{"token": "fake-access", "refresh_token": "fake-refresh"}'


class _FakeFlow:
    def __init__(self):
        self.called = None

    def run_local_server(self, port):
        self.called = ("local_server", port)
        return _FakeCreds()

    def run_console(self):
        self.called = ("console",)
        return _FakeCreds()


def test_bootstrap_writes_token_via_injected_flow(tmp_path):
    tok = tmp_path / ".gmail_token.json"
    flow = _FakeFlow()
    out = bootstrap(token_file=tok, flow_factory=lambda: flow, open_browser=True)
    assert out == tok
    assert tok.exists()
    assert "fake-refresh" in tok.read_text()
    assert flow.called[0] == "local_server"  # browser path used


def test_bootstrap_console_path(tmp_path):
    tok = tmp_path / ".gmail_token.json"
    flow = _FakeFlow()
    bootstrap(token_file=tok, flow_factory=lambda: flow, open_browser=False)
    assert flow.called == ("console",)


def test_run_parser_imports():
    # thin wiring module — just confirm it imports without side effects
    mod = importlib.import_module("scripts.run_parser")
    assert hasattr(mod, "main")
