"""Shared test fixtures for the Poko server."""
from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from poko_server import config


@pytest.fixture()
def tmp_data_dir(tmp_path: Path):
    """Redirect all config paths to a temp directory."""
    data = tmp_path / "data"
    data.mkdir()
    uploads = data / "uploads"
    uploads.mkdir()
    db_path = data / "poko.db"

    with patch.object(config, "DATA_DIR", data), \
         patch.object(config, "UPLOAD_DIR", uploads), \
         patch.object(config, "DB_PATH", db_path):
        yield tmp_path


@pytest.fixture()
def db_conn(tmp_data_dir: Path):
    """Create an in-memory DB with the schema applied."""
    from poko_server.db import create_tables, get_connection, close_connection
    create_tables()
    conn = get_connection()
    yield conn
    conn.close()
    close_connection()
