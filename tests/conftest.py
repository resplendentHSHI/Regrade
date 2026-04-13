"""Shared pytest fixtures and path constants."""
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def dashboard_html() -> str:
    """Real saved Gradescope course dashboard HTML (18-100 Spring 2026)."""
    return (FIXTURES / "dashboard_sample.html").read_text(encoding="utf-8")


@pytest.fixture
def sample_pdf_path() -> Path:
    """Real 10-page graded PDF from smoke test #1 (HW08 ADCs)."""
    return FIXTURES / "sample_graded.pdf"


@pytest.fixture
def tmp_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point gradescope_bot.config.DATA_DIR at a tmp directory for the test."""
    from gradescope_bot import config

    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setattr(config, "DATA_DIR", data)
    monkeypatch.setattr(config, "QUEUE_DIR", data / "queue")
    monkeypatch.setattr(config, "HEARTBEAT_STATE", data / "heartbeat_state.json")
    monkeypatch.setattr(config, "RATE_LIMIT_STATE", data / "rate_limit_state.json")
    monkeypatch.setattr(config, "HEARTBEAT_LOG", data / "heartbeat.log")
    monkeypatch.setattr(config, "HEARTBEAT_PID", data / "heartbeat.pid")
    (data / "queue").mkdir()
    return data
