"""Token-bucket-ish rate limiter with per-run and daily hard caps."""
from __future__ import annotations

import json
import random
import time
from datetime import datetime
from typing import Callable

import config


class RatePerRunExhausted(Exception):
    """Raised when the per-run request cap is reached."""


class DailyCapExhausted(Exception):
    """Raised when the daily request cap is reached."""


class RateLimiter:
    """Enforces minimum inter-request spacing and hard per-run and per-day caps.

    The daily counter is persisted to disk so it survives process restarts
    and applies across both the heartbeat daemon and any --run-now invocations.
    """

    def __init__(
        self,
        min_spacing: float = config.MIN_REQUEST_SPACING_SEC,
        jitter: float = config.REQUEST_SPACING_JITTER_SEC,
        per_run_cap: int = config.PER_RUN_CAP,
        daily_cap: int = config.DAILY_CAP,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        now_local: Callable[[], datetime] = lambda: datetime.now().astimezone(),
    ) -> None:
        self._min_spacing = min_spacing
        self._jitter = jitter
        self._per_run_cap = per_run_cap
        self._daily_cap = daily_cap
        self._clock = clock
        self._sleep = sleep
        self._now_local = now_local
        self._last_request_time: float | None = None
        self._run_count = 0

    def _load_daily_state(self) -> dict:
        path = config.RATE_LIMIT_STATE
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
        return {"day_local": "", "requests_used": 0, "daily_cap": self._daily_cap}

    def _save_daily_state(self, state: dict) -> None:
        path = config.RATE_LIMIT_STATE
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(state), encoding="utf-8")
        tmp.replace(path)

    def wait(self) -> None:
        """Block until the next request is allowed. Raises on cap exhaustion."""
        today = self._now_local().strftime("%Y-%m-%d")
        state = self._load_daily_state()
        if state.get("day_local") != today:
            state = {"day_local": today, "requests_used": 0, "daily_cap": self._daily_cap}

        if state["requests_used"] >= self._daily_cap:
            raise DailyCapExhausted(
                f"Daily cap {self._daily_cap} hit for {today}"
            )

        if self._run_count >= self._per_run_cap:
            raise RatePerRunExhausted(
                f"Per-run cap {self._per_run_cap} hit"
            )

        if self._last_request_time is not None:
            elapsed = self._clock() - self._last_request_time
            target = self._min_spacing + (random.uniform(0, self._jitter) if self._jitter else 0.0)
            if elapsed < target:
                self._sleep(target - elapsed)

        self._last_request_time = self._clock()
        self._run_count += 1
        state["requests_used"] += 1
        self._save_daily_state(state)
