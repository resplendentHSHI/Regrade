"""Tests for the token-bucket-ish rate limiter with per-run and daily caps."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from gradescope_bot import rate_limit


class FakeClock:
    def __init__(self, start: float = 1_000_000.0) -> None:
        self.now = start
        self.sleeps: list[float] = []

    def time(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def limiter(tmp_data_dir: Path, clock: FakeClock) -> rate_limit.RateLimiter:
    return rate_limit.RateLimiter(
        min_spacing=2.0,
        jitter=0.0,  # deterministic for tests
        per_run_cap=3,
        daily_cap=5,
        clock=clock.time,
        sleep=clock.sleep,
        now_local=lambda: datetime(2026, 4, 13, 2, 0, 0, tzinfo=timezone.utc),
    )


def test_first_request_does_not_sleep(limiter: rate_limit.RateLimiter, clock: FakeClock) -> None:
    limiter.wait()
    assert clock.sleeps == []


def test_second_request_sleeps_to_enforce_spacing(limiter: rate_limit.RateLimiter, clock: FakeClock) -> None:
    limiter.wait()
    limiter.wait()
    assert clock.sleeps == [2.0]


def test_per_run_cap_raises(limiter: rate_limit.RateLimiter) -> None:
    limiter.wait()
    limiter.wait()
    limiter.wait()
    with pytest.raises(rate_limit.RatePerRunExhausted):
        limiter.wait()


def test_daily_cap_persists_across_limiter_instances(tmp_data_dir: Path, clock: FakeClock) -> None:
    for _ in range(3):
        rate_limit.RateLimiter(
            min_spacing=0.0, jitter=0.0, per_run_cap=100, daily_cap=5,
            clock=clock.time, sleep=clock.sleep,
            now_local=lambda: datetime(2026, 4, 13, 2, 0, 0, tzinfo=timezone.utc),
        ).wait()
    # Fourth and fifth requests succeed
    for _ in range(2):
        rate_limit.RateLimiter(
            min_spacing=0.0, jitter=0.0, per_run_cap=100, daily_cap=5,
            clock=clock.time, sleep=clock.sleep,
            now_local=lambda: datetime(2026, 4, 13, 2, 0, 0, tzinfo=timezone.utc),
        ).wait()
    # Sixth request — daily cap hit
    limiter = rate_limit.RateLimiter(
        min_spacing=0.0, jitter=0.0, per_run_cap=100, daily_cap=5,
        clock=clock.time, sleep=clock.sleep,
        now_local=lambda: datetime(2026, 4, 13, 2, 0, 0, tzinfo=timezone.utc),
    )
    with pytest.raises(rate_limit.DailyCapExhausted):
        limiter.wait()


def test_daily_cap_resets_on_new_day(tmp_data_dir: Path, clock: FakeClock) -> None:
    # Day 1: hit the cap
    day1 = datetime(2026, 4, 13, 2, 0, 0, tzinfo=timezone.utc)
    for _ in range(5):
        rate_limit.RateLimiter(
            min_spacing=0.0, jitter=0.0, per_run_cap=100, daily_cap=5,
            clock=clock.time, sleep=clock.sleep, now_local=lambda: day1,
        ).wait()
    # Day 2: should reset
    day2 = datetime(2026, 4, 14, 2, 0, 0, tzinfo=timezone.utc)
    limiter = rate_limit.RateLimiter(
        min_spacing=0.0, jitter=0.0, per_run_cap=100, daily_cap=5,
        clock=clock.time, sleep=clock.sleep, now_local=lambda: day2,
    )
    limiter.wait()  # should not raise
