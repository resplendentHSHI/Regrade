"""Pure-function scheduler logic for the 2 AM catch-up policy."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass
class Decision:
    run_now: bool
    next_wake: datetime


def decide_next_action(
    now: datetime,
    last_run: datetime | None,
    hour: int,
    minute: int,
) -> Decision:
    """Given current time and last successful run time, decide the next action.

    Policy:
      * If we missed today's HH:MM slot (now >= today@HH:MM and last_run < today@HH:MM),
        run immediately and schedule next wake for tomorrow@HH:MM.
      * Otherwise, if last_run >= today@HH:MM (we already ran today), sleep until
        tomorrow@HH:MM.
      * Otherwise (early morning, before today@HH:MM, haven't run yet today),
        sleep until today@HH:MM.
    """
    today_slot = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    tomorrow_slot = today_slot + timedelta(days=1)

    if last_run is None:
        if now >= today_slot:
            return Decision(run_now=True, next_wake=tomorrow_slot)
        return Decision(run_now=False, next_wake=today_slot)

    if last_run < today_slot <= now:
        return Decision(run_now=True, next_wake=tomorrow_slot)

    if last_run >= today_slot:
        return Decision(run_now=False, next_wake=tomorrow_slot)

    return Decision(run_now=False, next_wake=today_slot)
