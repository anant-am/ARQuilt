"""
sim_manager.py — In-memory simulation session manager.

Stores file data, orchestrates the ARQ engine run, and yields
simulation events to WebSocket clients. Supports pause/resume/step/reset/cancel.
"""
from __future__ import annotations
import asyncio
import hashlib
import io
import uuid
from typing import AsyncIterator, Optional

from .arq_engine import ARQEngine
from .channel import Channel, ChannelConfig
from .file_transfer import prepare_file, verify_reassembly
from .models import (
    ARQCfgModel, ARQMode, FileInfo, SelectionResult, SimConfig,
    SimEvent, TransferStatus, TransferSummary, ChannelCfgModel,
)
from .protocol_selector import select_protocol
from .scenarios import get_scenario
from .scheduler import Scheduler


# ─────────────────────────────────────────────────────────────
# In-memory file store (keyed by file_id)
# ─────────────────────────────────────────────────────────────
_files: dict[str, tuple[bytes, FileInfo]] = {}


def store_file(filename: str, data: bytes, frame_payload_bytes: int = 512) -> tuple[str, FileInfo]:
    file_id = str(uuid.uuid4())
    info = prepare_file(filename, data, frame_payload_bytes)
    _files[file_id] = (data, info)
    return file_id, info


def get_file(file_id: str) -> tuple[bytes, FileInfo] | None:
    return _files.get(file_id)


def _build_channel(ccfg: ChannelCfgModel, data_seed: int, ack_seed: int) -> Channel:
    cfg = ChannelConfig(
        propagation_delay_us=ccfg.propagation_delay_us,
        bandwidth_bps=ccfg.bandwidth_bps,
        jitter_us=ccfg.jitter_us,
        reorder_prob=ccfg.reorder_prob,
        data_loss_prob=ccfg.data_loss_prob,
        ack_loss_prob=ccfg.ack_loss_prob,
        data_corrupt_prob=ccfg.data_corrupt_prob,
        ack_corrupt_prob=ccfg.ack_corrupt_prob,
        burst_loss_enabled=ccfg.burst_loss_enabled,
        burst_good_loss_prob=ccfg.burst_good_loss_prob,
        burst_bad_loss_prob=ccfg.burst_bad_loss_prob,
        burst_good_to_bad_prob=ccfg.burst_good_to_bad_prob,
        burst_bad_to_good_prob=ccfg.burst_bad_to_good_prob,
        data_dup_prob=ccfg.data_dup_prob,
        router_delay_us=ccfg.router_delay_us,
    )
    return Channel(cfg, data_seed=data_seed, ack_seed=ack_seed)


# ─────────────────────────────────────────────────────────────
# Simulation session
# ─────────────────────────────────────────────────────────────

class SimSession:
    """Manages a single simulation run with pause/resume/step/cancel."""

    MAX_EVENTS = 50_000  # cap per run

    def __init__(
        self,
        session_id: str,
        file_id: str,
        scenario_id: str,
        mode: ARQMode,
        selection_result: Optional[SelectionResult],
        override_window: Optional[int],
        override_retries: Optional[int],
        override_seed: Optional[int],
    ) -> None:
        self.session_id = session_id
        self.file_id = file_id
        self.scenario_id = scenario_id
        self.override_seed = override_seed

        rec = get_file(file_id)
        if rec is None:
            raise ValueError(f"File {file_id} not found")
        self.payload, self.file_info = rec

        scenario = get_scenario(scenario_id)
        if scenario is None:
            raise ValueError(f"Scenario {scenario_id} not found")
        self.scenario = scenario

        # Resolve final mode
        effective_mode = mode
        if mode == ARQMode.AUTO:
            if selection_result is not None:
                effective_mode = selection_result.selected
            else:
                effective_mode = ARQMode.GBN  # fallback

        # Build ARQ config
        arq = ARQCfgModel(
            mode=effective_mode,
            window_size=override_window or scenario.arq.window_size,
            max_retries=override_retries or scenario.arq.max_retries,
            timeout_us=scenario.arq.timeout_us,
            frame_payload_bytes=scenario.arq.frame_payload_bytes,
            seq_bits=scenario.arq.seq_bits,
        )

        data_seed = override_seed if override_seed is not None else scenario.data_seed
        ack_seed = scenario.ack_seed

        self.events: list[SimEvent] = []
        self._paused = False
        self._cancelled = False
        self._step_mode = False
        self._step_event = asyncio.Event()
        self._started = False
        self._speed = 1.0

        self.scheduler = Scheduler()
        channel = _build_channel(scenario.channel, data_seed, ack_seed)

        self.engine = ARQEngine(
            cfg=arq,
            payload=self.payload,
            channel=channel,
            scheduler=self.scheduler,
            event_cb=self.events.append,
            transfer_id=session_id,
        )
        self.selection_result = selection_result
        self.status = TransferStatus.PENDING

    # ─── controls ──────────────────────────────────────────────
    def pause(self) -> None:
        self._paused = True

    def resume(self) -> None:
        self._paused = False
        self._step_event.set()

    def step(self) -> None:
        """Advance by one event when paused in step mode."""
        self._step_mode = True
        self._step_event.set()

    def cancel(self) -> None:
        self._cancelled = True
        self.status = TransferStatus.CANCELLED
        self._paused = False
        self._step_event.set()

    def set_speed(self, speed: float) -> None:
        self._speed = max(0.1, min(10.0, speed))

    def is_done(self) -> bool:
        return self.status in (
            TransferStatus.COMPLETE,
            TransferStatus.FAILED,
            TransferStatus.CANCELLED,
        ) or self.engine.status in (
            TransferStatus.COMPLETE,
            TransferStatus.FAILED,
            TransferStatus.CANCELLED,
        )

    def get_events_since(self, since_id: int = 0) -> list[SimEvent]:
        return [e for e in self.events if e.event_id > since_id]

    # ─── async event generator ─────────────────────────────────
    async def run_and_stream(self, since_id: int = 0) -> AsyncIterator[SimEvent]:
        """
        Run the simulation and yield events as they are produced.
        Supports cursor-based catchup (since_id) and reconnection.
        Respects pause/resume/step/cancel.
        """
        if not self._started:
            self._started = True
            self.status = TransferStatus.RUNNING
            self.engine.start()

        # Emit any existing events since since_id first
        emitted_idx = 0
        while emitted_idx < len(self.events):
            ev = self.events[emitted_idx]
            emitted_idx += 1
            if ev.event_id > since_id:
                yield ev

        if self.is_done():
            self.status = self.engine.status if not self._cancelled else TransferStatus.CANCELLED
            return

        event_count = 0
        while True:
            if self._cancelled:
                self.status = TransferStatus.CANCELLED
                break

            # Pause handling
            if self._paused:
                self._step_event.clear()
                await self._step_event.wait()
                if self._step_mode:
                    self._step_mode = False
                    self._paused = True

            # Advance the scheduler one step
            if self.scheduler.has_events():
                self.scheduler.step()
                event_count += 1
                if event_count > self.MAX_EVENTS:
                    break
            else:
                # No more events
                break

            # Yield any newly produced events
            while emitted_idx < len(self.events):
                ev = self.events[emitted_idx]
                emitted_idx += 1
                if ev.event_id > since_id:
                    yield ev

            # Check terminal states
            if self.engine.status in (
                TransferStatus.COMPLETE,
                TransferStatus.FAILED,
                TransferStatus.CANCELLED,
            ):
                while emitted_idx < len(self.events):
                    ev = self.events[emitted_idx]
                    emitted_idx += 1
                    if ev.event_id > since_id:
                        yield ev
                break

            # Cooperative pacing delay based on simulation speed (12ms at 1.0x)
            delay = 0.012 / max(0.25, self._speed)
            await asyncio.sleep(delay)

        self.status = self.engine.status if not self._cancelled else TransferStatus.CANCELLED

    # ─── summary ───────────────────────────────────────────────
    def summary(self) -> TransferSummary:
        eng = self.engine
        duration = eng.duration_us()
        goodput = eng.goodput_bps() if eng.status == TransferStatus.COMPLETE else 0.0
        received_sha = eng.received_sha256
        integrity = None
        if received_sha is not None:
            orig_sha = self.file_info.sha256
            integrity = received_sha == orig_sha

        return TransferSummary(
            transfer_id=self.session_id,
            status=self.status if self.status != TransferStatus.PENDING else eng.status,
            frames_sent=eng.stats.frames_sent,
            frames_delivered=eng.stats.frames_delivered,
            acks_received=eng.stats.acks_received,
            frames_lost=eng.stats.frames_lost,
            frames_corrupted=eng.stats.frames_corrupted,
            retransmissions=eng.stats.retransmissions,
            bytes_delivered=eng.stats.bytes_delivered,
            duration_us=duration,
            goodput_bps=goodput,
            original_sha256=self.file_info.sha256,
            received_sha256=received_sha,
            integrity_ok=integrity,
            failure_reason=eng.failure_reason,
            arq_mode=eng.cfg.mode,
        )


# ─────────────────────────────────────────────────────────────
# Session registry
# ─────────────────────────────────────────────────────────────
_sessions: dict[str, SimSession] = {}


def create_session(
    file_id: str,
    scenario_id: str,
    mode: ARQMode,
    selection_result: Optional[SelectionResult],
    override_window: Optional[int],
    override_retries: Optional[int],
    override_seed: Optional[int],
) -> SimSession:
    sid = str(uuid.uuid4())
    sess = SimSession(
        session_id=sid,
        file_id=file_id,
        scenario_id=scenario_id,
        mode=mode,
        selection_result=selection_result,
        override_window=override_window,
        override_retries=override_retries,
        override_seed=override_seed,
    )
    _sessions[sid] = sess
    return sess


def get_session(session_id: str) -> SimSession | None:
    return _sessions.get(session_id)
