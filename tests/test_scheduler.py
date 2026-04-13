"""Tests for the 2 AM catch-up scheduler logic (pure functions, no threading)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from gradescope_bot.scheduler import Decision, decide_next_action

TZ = timezone(timedelta(hours=-4))  # arbitrary fixed offset for tests


def dt(y, mo, d, h, mi=0) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=TZ)


def test_catch_up_when_last_run_before_today_2am_and_now_after() -> None:
    decision = decide_next_action(
        now=dt(2026, 4, 13, 9, 0),
        last_run=dt(2026, 4, 12, 2, 0),
        hour=2, minute=0,
    )
    assert decision.run_now is True
    assert decision.next_wake == dt(2026, 4, 14, 2, 0)


def test_sleep_until_tomorrow_if_already_ran_today() -> None:
    decision = decide_next_action(
        now=dt(2026, 4, 13, 9, 0),
        last_run=dt(2026, 4, 13, 2, 5),
        hour=2, minute=0,
    )
    assert decision.run_now is False
    assert decision.next_wake == dt(2026, 4, 14, 2, 0)


def test_sleep_until_today_if_early_morning_and_last_run_yesterday_early() -> None:
    decision = decide_next_action(
        now=dt(2026, 4, 13, 0, 30),
        last_run=dt(2026, 4, 12, 2, 0),
        hour=2, minute=0,
    )
    assert decision.run_now is False
    assert decision.next_wake == dt(2026, 4, 13, 2, 0)


def test_first_run_ever_with_no_last_run_runs_immediately_if_past_2am() -> None:
    decision = decide_next_action(
        now=dt(2026, 4, 13, 9, 0),
        last_run=None,
        hour=2, minute=0,
    )
    assert decision.run_now is True


def test_first_run_ever_before_2am_waits_until_2am() -> None:
    decision = decide_next_action(
        now=dt(2026, 4, 13, 0, 30),
        last_run=None,
        hour=2, minute=0,
    )
    assert decision.run_now is False
    assert decision.next_wake == dt(2026, 4, 13, 2, 0)
