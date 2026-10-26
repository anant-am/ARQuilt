"""
scheduler.py — Deterministic discrete-event simulation scheduler.

Uses a min-heap priority queue keyed on (virtual_time, tie_break_counter).
Tie-breaking is strictly by insertion order to ensure determinism.
"""
from __future__ import annotations
import heapq
from typing import Any, Callable


class Event:
    __slots__ = ("time", "seq", "callback", "args", "cancelled")

    def __init__(self, time: int, seq: int, callback: Callable, args: tuple):
        self.time = time
        self.seq = seq
        self.callback = callback
        self.args = args
        self.cancelled = False

    def __lt__(self, other: "Event") -> bool:
        return (self.time, self.seq) < (other.time, other.seq)

    def __le__(self, other: "Event") -> bool:
        return (self.time, self.seq) <= (other.time, other.seq)


class Scheduler:
    """Deterministic discrete-event scheduler with integer virtual time (µs)."""

    def __init__(self) -> None:
        self._heap: list[Event] = []
        self._seq: int = 0
        self._now: int = 0

    def reset(self) -> None:
        self._heap.clear()
        self._seq = 0
        self._now = 0

    @property
    def now(self) -> int:
        return self._now

    def schedule(self, delay: int, callback: Callable, *args: Any) -> Event:
        """Schedule callback(args) to fire delay µs from now. Returns Event handle."""
        assert delay >= 0, f"Negative delay: {delay}"
        ev = Event(self._now + delay, self._seq, callback, args)
        self._seq += 1
        heapq.heappush(self._heap, ev)
        return ev

    def cancel(self, event: Event) -> None:
        event.cancelled = True

    def has_events(self) -> bool:
        self._prune()
        return bool(self._heap)

    def _prune(self) -> None:
        while self._heap and self._heap[0].cancelled:
            heapq.heappop(self._heap)

    def step(self) -> int | None:
        """
        Process the next non-cancelled event.
        Returns the virtual timestamp of the processed event, or None if queue empty.
        """
        self._prune()
        if not self._heap:
            return None
        ev = heapq.heappop(self._heap)
        self._now = ev.time
        ev.callback(*ev.args)
        return ev.time

    def run_until(self, limit: int) -> int:
        """Run all events up to and including virtual time limit. Returns events processed."""
        count = 0
        while True:
            self._prune()
            if not self._heap or self._heap[0].time > limit:
                break
            self.step()
            count += 1
        return count

    def run_all(self, max_events: int = 1_000_000) -> int:
        """Run all events up to max_events. Returns events processed."""
        count = 0
        while self.has_events() and count < max_events:
            self.step()
            count += 1
        return count
