"""Test that the sidecar works when invoked from ANY working directory.

This is the #1 failure point: Tauri spawns `python3 /path/to/sidecar_main.py`
but the working directory is NOT the sidecar dir. If sidecar_main.py uses
`import config` (relative import), it will fail because Python won't find
config.py in the cwd.
"""
import json
import os
import subprocess
import sys
import tempfile

SIDECAR_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "client", "sidecar")
SIDECAR_MAIN = os.path.join(SIDECAR_DIR, "sidecar_main.py")
PYTHON = sys.executable


def run_sidecar(args: list[str], cwd: str = "/tmp") -> dict:
    """Run the sidecar from an arbitrary working directory (simulates Tauri)."""
    result = subprocess.run(
        [PYTHON, SIDECAR_MAIN, *args],
        capture_output=True, text=True, timeout=30,
        cwd=cwd,
    )
    stdout = result.stdout.strip()
    if stdout:
        return json.loads(stdout)
    return {"ok": False, "error": result.stderr or "no output", "_exitcode": result.returncode}


def test_sidecar_from_tmp_dir():
    """Sidecar must work when cwd is /tmp (simulates Tauri's spawn behavior)."""
    resp = run_sidecar([], cwd="/tmp")
    # Should get usage error, not import error
    assert "error" in resp
    assert "Usage" in resp.get("error", ""), f"Got import error instead of usage: {resp}"


def test_sidecar_from_home_dir():
    """Sidecar must work when cwd is ~."""
    resp = run_sidecar([], cwd=os.path.expanduser("~"))
    assert "Usage" in resp.get("error", ""), f"Got: {resp}"


def test_sidecar_from_root_dir():
    """Sidecar must work when cwd is /."""
    resp = run_sidecar([], cwd="/")
    assert "Usage" in resp.get("error", ""), f"Got: {resp}"


def test_sidecar_login_bad_creds_from_foreign_dir():
    """Login with bad creds from a foreign dir — should get credentials error, not import error."""
    resp = run_sidecar(["login", "fake@test.com", "badpass"], cwd="/tmp")
    assert not resp.get("ok"), f"Should have failed: {resp}"
    error = resp.get("error", "")
    # Should be a Gradescope error, not a Python import error
    assert "module" not in error.lower() and "import" not in error.lower(), \
        f"Got import error: {error}"


if __name__ == "__main__":
    tests = [
        test_sidecar_from_tmp_dir,
        test_sidecar_from_home_dir,
        test_sidecar_from_root_dir,
        test_sidecar_login_bad_creds_from_foreign_dir,
    ]
    for t in tests:
        try:
            t()
            print(f"  PASS: {t.__name__}")
        except Exception as e:
            print(f"  FAIL: {t.__name__}: {e}")
