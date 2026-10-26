"""
arq_engine.py — Unified ARQ simulation engine.

Implements Stop-and-Wait, Go-Back-N and Selective Repeat
through a single parameterised state machine driven by the
discrete-event scheduler.

Sequence numbering:
  - abs_seq  : absolute 0-based frame index (never wraps)
  - seq_no   : wire sequence number (abs_seq % seq_modulus)
  - seq_bits : number of bits for wire sequence number field
  - seq_modulus = 2 ** seq_bits
  - SW: seq_modulus = 2, window = 1
  - GBN: seq_modulus = 2**seq_bits, window <= seq_modulus - 1
  - SR:  seq_modulus >= 2 * window  (enforced)
"""
from __future__ import annotations
import binascii
import hashlib
from dataclasses import dataclass, field
from typing import Callable, Optional

from .channel import Channel, ChannelOutcome
from .models import (
    ARQCfgModel, ARQMode, EventType, SimEvent, TransferStatus
)
from .scheduler import Scheduler


# ──────────────────────────────────────────────────────────────
# Frame record
# ──────────────────────────────────────────────────────────────

@dataclass
class Frame:
    abs_seq: int
    seq_no: int
    payload: bytes
    checksum: int           # CRC32

    # Sender state
    send_time_us: int = 0
    attempts: int = 0
    acked: bool = False
    timer_event = None      # Scheduler Event handle

    # Receiver state
    received: bool = False
    delivered: bool = False


def _crc32(data: bytes) -> int:
    return binascii.crc32(data) & 0xFFFF_FFFF


def make_frames(payload: bytes, frame_payload: int, seq_bits: int) -> list[Frame]:
    """Divide payload into Frame objects."""
    modulus = 2 ** seq_bits
    frames: list[Frame] = []
    offset = 0
    abs_seq = 0
    while offset < len(payload) or abs_seq == 0:
        chunk = payload[offset: offset + frame_payload]
        if not chunk and abs_seq > 0:
            break
        frames.append(Frame(
            abs_seq=abs_seq,
            seq_no=abs_seq % modulus,
            payload=chunk,
            checksum=_crc32(chunk),
        ))
        offset += frame_payload
        abs_seq += 1
        if not payload:   # zero-byte file → one empty frame
            break
    return frames


# ──────────────────────────────────────────────────────────────
# ARQ State Machine
# ──────────────────────────────────────────────────────────────

@dataclass
class ARQStats:
    frames_sent: int = 0
    frames_delivered: int = 0
    acks_received: int = 0
    frames_lost: int = 0
    frames_corrupted: int = 0
    retransmissions: int = 0
    bytes_delivered: int = 0
    control_overhead_bytes: int = 0
    peak_sender_buffer: int = 0
    peak_rx_buffer: int = 0


class ARQEngine:
    """
    Unified ARQ state machine for SW / GBN / SR.

    Parameters
    ----------
    cfg          : ARQ configuration
    payload      : raw file bytes
    channel      : Channel instance (pre-seeded)
    scheduler    : Scheduler instance
    event_cb     : called with each SimEvent as it fires
    transfer_id  : used in events
    """

    ACK_BYTES = 20  # fixed ACK size for serialization

    def __init__(
        self,
        cfg: ARQCfgModel,
        payload: bytes,
        channel: Channel,
        scheduler: Scheduler,
        event_cb: Callable[[SimEvent], None],
        transfer_id: str = "T1",
    ) -> None:
        self.cfg = cfg
        self.payload = payload
        self.channel = channel
        self.scheduler = scheduler
        self.emit = event_cb
        self.transfer_id = transfer_id

        # Validate window / modulus constraints
        self.seq_modulus = 2 ** cfg.seq_bits
        if cfg.mode == ARQMode.SW:
            self.window = 1
        elif cfg.mode == ARQMode.GBN:
            self.window = min(cfg.window_size, self.seq_modulus - 1)
        else:  # SR
            # seq_modulus must be >= 2 * window
            max_w = self.seq_modulus // 2
            self.window = min(cfg.window_size, max_w)

        self.frames = make_frames(payload, cfg.frame_payload_bytes, cfg.seq_bits)
        self.total_frames = len(self.frames)

        # Sender state
        self._send_base: int = 0   # oldest unacked abs_seq
        self._next_send: int = 0   # next frame to send
        self._event_id_counter: int = 0

        # Receiver state
        self._rx_base: int = 0     # next expected abs_seq
        self._rx_buffer: dict[int, Frame] = {}   # abs_seq → Frame (SR buffering)
        self._delivered_bytes: bytearray = bytearray()

        # Stats
        self.stats = ARQStats()
        self.status: TransferStatus = TransferStatus.PENDING
        self.start_us: int = 0
        self.end_us: int = 0
        self.received_sha256: Optional[str] = None
        self.failure_reason: Optional[str] = None

    # ──────────────────────────────────────────────────────────
    # Public entry point
    # ──────────────────────────────────────────────────────────

    def start(self) -> None:
        self.channel._data_tx_busy_until_us = 0
        self.channel._ack_tx_busy_until_us = 0
        self.status = TransferStatus.RUNNING
        self.start_us = self.scheduler.now
        self._emit_ev(EventType.TRANSFER_START, explanation=
                      f"Transfer {self.transfer_id} starting. Mode={self.cfg.mode.value} "
                      f"window={self.window} frames={self.total_frames}")
        self._try_send_window()

    # ──────────────────────────────────────────────────────────
    # Sender: send logic
    # ──────────────────────────────────────────────────────────

    def _try_send_window(self) -> None:
        """Attempt to send frames within the current window."""
        while (self._next_send < self.total_frames and
               self._next_send < self._send_base + self.window):
            self._send_frame(self._next_send)
            self._next_send += 1

    def _send_frame(self, abs_seq: int, retransmit: bool = False) -> None:
        frame = self.frames[abs_seq]
        frame.attempts += 1
        frame.send_time_us = self.scheduler.now

        if retransmit:
            self.stats.retransmissions += 1
            etype = EventType.RETRANSMIT
        else:
            self.stats.frames_sent += 1
            etype = EventType.DATA_SENT

        frame_bytes = len(frame.payload) + 30  # header overhead
        outcome, delay = self.channel.transmit_data(frame_bytes, self.scheduler.now)

        # Update peak sender buffer
        unacked = self._next_send - self._send_base
        self.stats.peak_sender_buffer = max(self.stats.peak_sender_buffer, unacked)

        self._emit_ev(
            etype, abs_seq=abs_seq, seq_no=frame.seq_no, attempt=frame.attempts,
            payload_bytes=frame_bytes,
            window_base=self._send_base, window_size=self.window,
            sender_state=f"TX window=[{self._send_base}..{self._send_base + self.window - 1}], in-flight unacked={unacked}",
            receiver_state=f"Awaiting frame #{self._rx_base}",
            protocol_rule=f"{'Retransmission attempt' if retransmit else 'Initial transmission'} governed by {self.cfg.mode.value} protocol",
            explanation=(
                f"Frame {abs_seq} (seq={frame.seq_no}) "
                f"{'re' if retransmit else ''}sent, attempt={frame.attempts}"
            )
        )

        # Schedule delivery or loss at receiver
        if outcome == ChannelOutcome.LOST:
            self.scheduler.schedule(delay, self._on_data_lost, abs_seq)
        elif outcome == ChannelOutcome.CORRUPTED:
            self.scheduler.schedule(delay, self._on_data_corrupted, abs_seq)
        elif outcome == ChannelOutcome.DUPLICATE:
            self.scheduler.schedule(delay, self._on_data_arrived, abs_seq, False)
            self.scheduler.schedule(delay + 1, self._on_data_arrived, abs_seq, False)
        else:
            self.scheduler.schedule(delay, self._on_data_arrived, abs_seq, True)

        # Start/restart per-frame timeout
        if frame.timer_event is not None:
            self.scheduler.cancel(frame.timer_event)
        frame.timer_event = self.scheduler.schedule(
            self.cfg.timeout_us, self._on_timeout, abs_seq
        )

    # ──────────────────────────────────────────────────────────
    # Receiver: data arrival handlers
    # ──────────────────────────────────────────────────────────

    def _on_data_arrived(self, abs_seq: int, good: bool) -> None:
        if self.status != TransferStatus.RUNNING:
            return
        frame = self.frames[abs_seq]

        # Duplicate at receiver (already delivered)
        if abs_seq < self._rx_base:
            self._emit_ev(
                EventType.DATA_DUPLICATE, abs_seq=abs_seq,
                seq_no=frame.seq_no, attempt=frame.attempts,
                sender_state=f"Awaiting ACK for base={self._send_base}",
                receiver_state=f"Frame #{abs_seq} already delivered (rx_base={self._rx_base}). Discarding duplicate payload.",
                protocol_rule="Duplicate suppression: receiver ignores duplicate data bytes to prevent file corruption, but sends fresh ACK to advance sender.",
                explanation=f"Frame {abs_seq} duplicate — already delivered, sending ACK again"
            )
            self._send_ack(abs_seq)
            return

        if abs_seq == self._rx_base:
            # In-order arrival
            self.stats.frames_delivered += 1
            self.stats.bytes_delivered += len(frame.payload)
            self._delivered_bytes.extend(frame.payload)
            frame.delivered = True
            self._rx_base += 1

            self._emit_ev(
                EventType.DATA_DELIVERED, abs_seq=abs_seq,
                seq_no=frame.seq_no, attempt=frame.attempts,
                payload_bytes=len(frame.payload),
                loss_point=1.0,
                sender_state=f"Window base={self._send_base}",
                receiver_state=f"Frame #{abs_seq} verified and accepted. Reassembly buffer base advanced to {self._rx_base}.",
                protocol_rule="In-order frame delivered to transport layer reassembly stream.",
                explanation=f"Frame {abs_seq} delivered in-order"
            )

            # SR: advance base through any already-buffered frames
            if self.cfg.mode == ARQMode.SR:
                while self._rx_base in self._rx_buffer:
                    bf = self._rx_buffer.pop(self._rx_base)
                    self.stats.frames_delivered += 1
                    self.stats.bytes_delivered += len(bf.payload)
                    self._delivered_bytes.extend(bf.payload)
                    bf.delivered = True
                    self._rx_base += 1
                    self._emit_ev(
                        EventType.FRAME_ASSEMBLED, abs_seq=bf.abs_seq,
                        seq_no=bf.seq_no,
                        sender_state=f"Window base={self._send_base}",
                        receiver_state=f"Buffered frame #{bf.abs_seq} assembled. Rx base={self._rx_base}",
                        protocol_rule="Selective Repeat drains contiguous buffered frames into application stream",
                        explanation=f"Buffered frame {bf.abs_seq} assembled in-order"
                    )

            self._send_ack(abs_seq)
            self._check_complete()

        elif abs_seq > self._rx_base:
            # Out-of-order
            if self.cfg.mode == ARQMode.SR:
                # SR: buffer it
                rx_buf_size = self.window
                if abs_seq - self._rx_base < rx_buf_size:
                    if abs_seq not in self._rx_buffer:
                        self._rx_buffer[abs_seq] = frame
                        self.stats.peak_rx_buffer = max(
                            self.stats.peak_rx_buffer, len(self._rx_buffer))
                        self._emit_ev(
                            EventType.DATA_BUFFERED, abs_seq=abs_seq,
                            seq_no=frame.seq_no, attempt=frame.attempts,
                            rx_buffer_used=len(self._rx_buffer),
                            loss_point=1.0,
                            sender_state=f"Window base={self._send_base}",
                            receiver_state=f"Frame #{abs_seq} is out-of-order (expected #{self._rx_base}). Buffered in SR receive window ({len(self._rx_buffer)}/{self.window}).",
                            protocol_rule="Selective Repeat allows out-of-order buffering within receive window and returns selective ACK.",
                            explanation=f"Frame {abs_seq} buffered OOO (SR mode)"
                        )
                    self._send_ack(abs_seq)
                else:
                    # Outside receive window — discard
                    self._emit_ev(
                        EventType.DATA_LOST, abs_seq=abs_seq,
                        seq_no=frame.seq_no,
                        loss_point=1.0,
                        failure_type="BUFFER_OVERFLOW",
                        sender_state=f"Window base={self._send_base}",
                        receiver_state=f"Frame #{abs_seq} outside receiver window [{self._rx_base}..{self._rx_base + self.window - 1}] — discarded",
                        protocol_rule="Receiver window full: frames arriving beyond window capacity are dropped.",
                        explanation=f"Frame {abs_seq} outside rx window — discarded"
                    )
            else:
                # GBN: discard, send ACK for last in-order
                self._emit_ev(
                    EventType.DATA_OUT_OF_ORDER, abs_seq=abs_seq,
                    seq_no=frame.seq_no, attempt=frame.attempts,
                    loss_point=0.9,
                    sender_state=f"Window base={self._send_base}",
                    receiver_state=f"Frame #{abs_seq} arrived OOO. GBN receiver only accepts contiguous frame #{self._rx_base}. Frame discarded.",
                    protocol_rule="Go-Back-N discard rule: receiver drops all out-of-order frames and repeats cumulative ACK for highest contiguous frame.",
                    explanation=f"Frame {abs_seq} OOO — GBN/SW discards, re-ACKing {self._rx_base - 1}"
                )
                if self._rx_base > 0:
                    self._send_ack(self._rx_base - 1)

    def _on_data_lost(self, abs_seq: int) -> None:
        if self.status != TransferStatus.RUNNING:
            return
        self.stats.frames_lost += 1
        frame = self.frames[abs_seq]
        self._emit_ev(
            EventType.DATA_LOST, abs_seq=abs_seq,
            seq_no=frame.seq_no, attempt=frame.attempts,
            loss_point=0.5,
            failure_type="DATA_LOSS",
            sender_state=f"Frame #{abs_seq} in flight; sender waiting for ACK or timeout ({self.cfg.timeout_us // 1000}ms)",
            receiver_state=f"Frame #{abs_seq} was lost before reaching receiver; receiver waiting at base={self._rx_base}",
            protocol_rule=f"Channel attenuation or noise dropped frame #{abs_seq}. Sender timer will expire and trigger retransmission.",
            explanation=f"Frame {abs_seq} LOST in channel at attempt {frame.attempts}"
        )

    def _on_data_corrupted(self, abs_seq: int) -> None:
        if self.status != TransferStatus.RUNNING:
            return
        self.stats.frames_corrupted += 1
        frame = self.frames[abs_seq]
        self._emit_ev(
            EventType.DATA_CORRUPTED, abs_seq=abs_seq,
            seq_no=frame.seq_no, attempt=frame.attempts,
            loss_point=0.88,
            failure_type="CRC_CORRUPTION",
            sender_state=f"Awaiting ACK for frame #{abs_seq}",
            receiver_state=f"Received frame #{abs_seq} but CRC32 checksum failed! Corrupted data discarded without sending ACK.",
            protocol_rule="Layer 2 Data Link CRC verification failed; receiver silently discards damaged frames to force sender timeout.",
            explanation=f"Frame {abs_seq} CORRUPTED — checksum failed, discarded at receiver"
        )
        # Receiver discards; no ACK

    # ──────────────────────────────────────────────────────────
    # ACK path
    # ──────────────────────────────────────────────────────────

    def _send_ack(self, abs_seq: int) -> None:
        frame = self.frames[abs_seq]
        self.stats.control_overhead_bytes += self.ACK_BYTES
        self._emit_ev(
            EventType.ACK_SENT, abs_seq=abs_seq,
            seq_no=frame.seq_no, ack_no=frame.seq_no,
            sender_state=f"Awaiting ACK for base={self._send_base}",
            receiver_state=f"Dispatched ACK for frame #{abs_seq} (ack_no={frame.seq_no})",
            protocol_rule=f"Receiver issues {'cumulative' if self.cfg.mode in (ARQMode.SW, ARQMode.GBN) else 'selective'} ACK back to sender",
            explanation=f"ACK for frame {abs_seq} (seq={frame.seq_no}) sent"
        )

        outcome, delay = self.channel.transmit_ack(self.ACK_BYTES, self.scheduler.now)
        if outcome == ChannelOutcome.LOST:
            self.scheduler.schedule(delay, self._on_ack_lost, abs_seq)
        elif outcome == ChannelOutcome.CORRUPTED:
            self.scheduler.schedule(delay, self._on_ack_lost, abs_seq)  # treat same as lost
        else:
            self.scheduler.schedule(delay, self._on_ack_arrived, abs_seq)

    def _on_ack_arrived(self, abs_seq: int) -> None:
        if self.status != TransferStatus.RUNNING:
            return
        frame = self.frames[abs_seq]
        self.stats.acks_received += 1

        self._emit_ev(
            EventType.ACK_DELIVERED, abs_seq=abs_seq,
            seq_no=frame.seq_no, ack_no=frame.seq_no,
            loss_point=0.0,
            window_base=self._send_base,
            sender_state=f"ACK received for frame #{abs_seq}. Cancelling frame timer.",
            receiver_state=f"Rx base={self._rx_base}",
            protocol_rule=f"ACK verified at sender. Window base moves forward.",
            explanation=f"ACK for frame {abs_seq} received by sender"
        )

        if frame.acked:
            return  # duplicate ACK — ignore (already acked)

        frame.acked = True
        if frame.timer_event is not None:
            self.scheduler.cancel(frame.timer_event)
            frame.timer_event = None

        if self.cfg.mode in (ARQMode.SW, ARQMode.GBN):
            # Cumulative ACK: advance window base up to abs_seq
            if abs_seq >= self._send_base:
                for i in range(self._send_base, abs_seq + 1):
                    self.frames[i].acked = True
                self._send_base = abs_seq + 1
        else:
            # SR: selective — just mark this frame acked
            # advance base over consecutive acked frames
            while (self._send_base < self.total_frames and
                   self.frames[self._send_base].acked):
                self._send_base += 1

        self._emit_ev(
            EventType.WINDOW_UPDATE, window_base=self._send_base,
            window_size=self.window,
            sender_state=f"Sliding window updated: base={self._send_base}, window size={self.window}",
            receiver_state=f"Rx base={self._rx_base}",
            protocol_rule="Window slide: sender slides past all acknowledged frames and sends new available frames.",
            explanation=f"Sender window advanced to base={self._send_base}"
        )

        # Send new frames that now fit in window
        self._try_send_window()
        self._check_complete()

    def _on_ack_lost(self, abs_seq: int) -> None:
        if self.status != TransferStatus.RUNNING:
            return
        frame = self.frames[abs_seq]
        self._emit_ev(
            EventType.ACK_LOST, abs_seq=abs_seq,
            seq_no=frame.seq_no,
            loss_point=0.5,
            failure_type="ACK_LOSS",
            sender_state=f"Window base={self._send_base}. ACK lost in flight, sender timeout ticking.",
            receiver_state=f"Frame #{abs_seq} was accepted, but return ACK was dropped by channel.",
            protocol_rule="Reverse channel packet loss dropped ACK. Sender will timeout and retransmit; receiver must suppress duplicates.",
            explanation=f"ACK for frame {abs_seq} LOST — sender will timeout"
        )

    # ──────────────────────────────────────────────────────────
    # Timeout and retransmission
    # ──────────────────────────────────────────────────────────

    def _on_timeout(self, abs_seq: int) -> None:
        if self.status != TransferStatus.RUNNING:
            return
        frame = self.frames[abs_seq]
        if frame.acked:
            return

        rule = (
            f"Go-Back-N timeout: sender rewinds to base={self._send_base} and retransmits entire unacknowledged sequence"
            if self.cfg.mode == ARQMode.GBN
            else f"Selective Repeat timeout: sender retransmits only unacknowledged frame #{abs_seq}"
        )
        self._emit_ev(
            EventType.TIMEOUT, abs_seq=abs_seq,
            seq_no=frame.seq_no, attempt=frame.attempts,
            failure_type="TIMEOUT",
            sender_state=f"Timer ({self.cfg.timeout_us // 1000}ms) expired for unacknowledged frame #{abs_seq} (attempt {frame.attempts}/{self.cfg.max_retries})",
            receiver_state=f"Waiting at rx_base={self._rx_base}",
            protocol_rule=rule,
            explanation=f"Timeout on frame {abs_seq} after attempt {frame.attempts}"
        )

        if frame.attempts >= self.cfg.max_retries:
            self.status = TransferStatus.FAILED
            self.end_us = self.scheduler.now
            self.failure_reason = (
                f"Frame {abs_seq} exceeded max retries ({self.cfg.max_retries})"
            )
            self._emit_ev(
                EventType.TRANSFER_FAILED,
                abs_seq=abs_seq,
                failure_type="RETRY_EXHAUSTION",
                sender_state=f"Frame #{abs_seq} reached maximum retry limit ({self.cfg.max_retries}). Aborting transfer.",
                receiver_state=f"Transfer unrecoverable: missing frame #{abs_seq}.",
                protocol_rule="Retry budget exhausted: channel impairment is too severe to sustain reliable transfer.",
                explanation=f"TRANSFER FAILED: {self.failure_reason}"
            )
            return

        if self.cfg.mode == ARQMode.GBN:
            # Retransmit from abs_seq all the way to next_send - 1
            for i in range(abs_seq, self._next_send):
                if not self.frames[i].acked:
                    self._send_frame(i, retransmit=True)
        else:
            # SW or SR: retransmit only this frame
            self._send_frame(abs_seq, retransmit=True)

    # ──────────────────────────────────────────────────────────
    # Completion check
    # ──────────────────────────────────────────────────────────

    def _check_complete(self) -> None:
        if self._rx_base >= self.total_frames and self.status == TransferStatus.RUNNING:
            self.status = TransferStatus.COMPLETE
            self.end_us = self.scheduler.now

            # Hash check
            received = bytes(self._delivered_bytes[: len(self.payload)])
            self.received_sha256 = hashlib.sha256(received).hexdigest()
            original_sha256 = hashlib.sha256(self.payload).hexdigest()
            integrity_ok = (self.received_sha256 == original_sha256)

            self._emit_ev(EventType.FILE_REASSEMBLED,
                          explanation=f"All {self.total_frames} frames received and reassembled")
            self._emit_ev(EventType.INTEGRITY_CHECK,
                          extra={"original_sha256": original_sha256,
                                 "received_sha256": self.received_sha256,
                                 "integrity_ok": integrity_ok},
                          explanation=(
                              f"SHA-256 {'MATCH ✓' if integrity_ok else 'MISMATCH ✗'}: "
                              f"{self.received_sha256[:16]}…"
                          ))
            self._emit_ev(EventType.TRANSFER_COMPLETE,
                          explanation=(
                              f"Transfer {self.transfer_id} COMPLETE "
                              f"({'VERIFIED' if integrity_ok else 'INTEGRITY FAIL'})"
                          ))

    # ──────────────────────────────────────────────────────────
    # Event emission helper
    # ──────────────────────────────────────────────────────────

    def _emit_ev(
        self,
        etype: EventType,
        abs_seq: int | None = None,
        seq_no: int | None = None,
        attempt: int = 1,
        payload_bytes: int | None = None,
        ack_no: int | None = None,
        window_base: int | None = None,
        window_size: int | None = None,
        rx_buffer_used: int | None = None,
        explanation: str = "",
        extra: dict | None = None,
        loss_point: float | None = None,
        failure_type: str | None = None,
        sender_state: str | None = None,
        receiver_state: str | None = None,
        protocol_rule: str | None = None,
    ) -> None:
        self._event_id_counter += 1
        ev = SimEvent(
            event_id=self._event_id_counter,
            vtime_us=self.scheduler.now,
            etype=etype,
            seq_no=seq_no,
            abs_seq=abs_seq,
            attempt=attempt,
            payload_bytes=payload_bytes,
            ack_no=ack_no,
            window_base=window_base,
            window_size=window_size,
            rx_buffer_used=rx_buffer_used,
            explanation=explanation,
            loss_point=loss_point,
            failure_type=failure_type,
            sender_state=sender_state,
            receiver_state=receiver_state,
            protocol_rule=protocol_rule,
            extra=extra or {},
        )
        self.emit(ev)

    # ──────────────────────────────────────────────────────────
    # Metrics for protocol selector
    # ──────────────────────────────────────────────────────────

    def goodput_bps(self) -> float:
        duration = max(1, self.end_us - self.start_us)
        return (self.stats.bytes_delivered * 8) / (duration / 1_000_000)

    def duration_us(self) -> int:
        return max(0, self.end_us - self.start_us)
