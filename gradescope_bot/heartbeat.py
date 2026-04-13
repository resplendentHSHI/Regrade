"""Long-running heartbeat daemon entry point.

Usage:
  python -m gradescope_bot.heartbeat           # sleep-until-next-2am loop
  python -m gradescope_bot.heartbeat --run-now # one cycle and exit
"""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import json
import logging
import logging.handlers
import signal
import sys
import threading
from datetime import datetime
from pathlib import Path

from gradescope_bot import analyzer, config, fetcher
from gradescope_bot.gs_client import GSClient
from gradescope_bot.rate_limit import DailyCapExhausted, RatePerRunExhausted
from gradescope_bot.scheduler import decide_next_action

log = logging.getLogger("gradescope_bot.heartbeat")

_stop = threading.Event()


def _setup_logging() -> None:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    handler = logging.handlers.RotatingFileHandler(
        config.HEARTBEAT_LOG, maxBytes=10 * 1024 * 1024, backupCount=5,
    )
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )
    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(handler.formatter)
    logging.basicConfig(level=logging.INFO, handlers=[handler, stream])


def _acquire_pid_lock() -> int:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    fd = config.HEARTBEAT_PID.open("w")
    try:
        fcntl.flock(fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log.error("Another heartbeat process holds the lock; exiting")
        sys.exit(1)
    fd.write(str(sys.argv))
    fd.flush()
    # Return the raw fd so it stays alive for the process lifetime
    return fd.fileno()


def _read_state() -> dict:
    if config.HEARTBEAT_STATE.exists():
        return json.loads(config.HEARTBEAT_STATE.read_text(encoding="utf-8"))
    return {}


def _write_state(state: dict) -> None:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = config.HEARTBEAT_STATE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    tmp.replace(config.HEARTBEAT_STATE)


def _now_local() -> datetime:
    return datetime.now().astimezone()


def run_cycle() -> dict:
    """Run one fetch+analyze cycle and return counters. Updates heartbeat_state.json."""
    started = _now_local()
    log.info("Cycle start")
    state = _read_state()
    state["last_status"] = "running"
    state["daemon_started_local"] = state.get("daemon_started_local") or started.isoformat()
    _write_state(state)

    fetch_counters = {"new_items": 0, "skipped_existing": 0, "errors": 0}
    analyze_counters = {"analyzed_ok": 0, "needs_review": 0, "no_issues_found": 0, "failed": 0}
    last_status = "ok"

    try:
        client = GSClient()
        client.login()
        fetch_counters = fetcher.run_fetch_phase(client, now_local=_now_local)
        analyze_counters = analyzer.run_analyze_phase()
    except DailyCapExhausted as e:
        log.warning("Daily cap hit: %s", e)
        last_status = "daily_cap_hit"
    except RatePerRunExhausted as e:
        log.warning("Per-run cap hit: %s", e)
        last_status = "per_run_cap_hit"
    except Exception as e:
        log.exception("Cycle failed: %s", e)
        last_status = f"error: {type(e).__name__}"

    finished = _now_local()
    counters = {**fetch_counters, **analyze_counters}
    log.info("Cycle end: %s (%s)", counters, last_status)

    if last_status == "ok":
        state["last_run_local"] = finished.isoformat()
    state["last_status"] = last_status
    state["last_cycle_counters"] = counters
    _write_state(state)
    return counters


def _install_signal_handlers() -> None:
    def handler(signum, _frame):
        log.info("Received signal %s; exiting", signum)
        _stop.set()

    signal.signal(signal.SIGTERM, handler)
    signal.signal(signal.SIGINT, handler)


def run_scheduler_loop() -> None:
    while not _stop.is_set():
        now = _now_local()
        state = _read_state()
        last_run_str = state.get("last_run_local")
        last_run = datetime.fromisoformat(last_run_str) if last_run_str else None

        decision = decide_next_action(
            now=now,
            last_run=last_run,
            hour=config.HEARTBEAT_HOUR_LOCAL,
            minute=config.HEARTBEAT_MINUTE_LOCAL,
        )

        if decision.run_now:
            run_cycle()
            # Refresh state — last_run_local may have moved
            state = _read_state()

        state["next_scheduled_local"] = decision.next_wake.isoformat()
        _write_state(state)

        wait_seconds = max(0.0, (decision.next_wake - _now_local()).total_seconds())
        log.info("Sleeping %s seconds until %s", int(wait_seconds), decision.next_wake.isoformat())
        _stop.wait(timeout=wait_seconds)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-now", action="store_true", help="Run one cycle and exit")
    args = parser.parse_args()

    _setup_logging()
    _acquire_pid_lock()
    _install_signal_handlers()

    if args.run_now:
        run_cycle()
        return

    run_scheduler_loop()


if __name__ == "__main__":
    main()
