"""
channel.py — Virtual network channel with deterministic randomness.

Simulates DATA and ACK transmission with:
  - Propagation delay
  - Serialization delay (based on frame length and bandwidth)
  - Independent loss probability for data and ack
  - Corruption probability
  - Optional reordering (jitter)
  - Optional duplication
  - Two-state burst-loss (Gilbert-Elliott model)
"""
from __future__ import annotations
import random
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Callable, Optional


class ChannelOutcome(Enum):
    DELIVERED = auto()
    LOST = auto()
    CORRUPTED = auto()
    DUPLICATE = auto()


@dataclass
class ChannelConfig:
    # Delays (µs)
    propagation_delay_us: int = 10_000          # 10 ms one-way
    bandwidth_bps: int = 1_000_000              # 1 Mbps
    jitter_us: int = 0                          # max additional jitter
    reorder_prob: float = 0.0                   # probability of extra delay

    # Loss
    data_loss_prob: float = 0.0
    ack_loss_prob: float = 0.0

    # Corruption
    data_corrupt_prob: float = 0.0
    ack_corrupt_prob: float = 0.0

    # Burst loss (Gilbert-Elliott two-state Markov)
    burst_loss_enabled: bool = False
    burst_good_loss_prob: float = 0.0
    burst_bad_loss_prob: float = 0.85
    burst_good_to_bad_prob: float = 0.05
    burst_bad_to_good_prob: float = 0.25

    # Duplication
    data_dup_prob: float = 0.0

    # Router hop additional delay (µs)
    router_delay_us: int = 0

    def serialization_delay_us(self, frame_bytes: int) -> int:
        bits = frame_bytes * 8
        return int((bits / self.bandwidth_bps) * 1_000_000)


class Channel:
    """
    Stateful virtual channel.  Call reset() before each experiment.
    Uses two independent RNG streams: one for data path, one for ack path.
    """

    def __init__(self, cfg: ChannelConfig, data_seed: int = 42, ack_seed: int = 137) -> None:
        self.cfg = cfg
        self._data_rng = random.Random(data_seed)
        self._ack_rng = random.Random(ack_seed)
        self._burst_state: str = "good"   # "good" | "bad"
        self._burst_rng = random.Random(data_seed ^ 0xDEAD)
        self._data_tx_busy_until_us: int = 0
        self._ack_tx_busy_until_us: int = 0

    def reset(self, data_seed: int | None = None, ack_seed: int | None = None) -> None:
        if data_seed is not None:
            self._data_rng = random.Random(data_seed)
            self._burst_rng = random.Random(data_seed ^ 0xDEAD)
        else:
            self._data_rng.seed(self._data_rng.randint(0, 2**32))
        if ack_seed is not None:
            self._ack_rng = random.Random(ack_seed)
        self._burst_state = "good"
        self._data_tx_busy_until_us = 0
        self._ack_tx_busy_until_us = 0

    def _update_burst_state(self) -> None:
        if self._burst_state == "good":
            if self._burst_rng.random() < self.cfg.burst_good_to_bad_prob:
                self._burst_state = "bad"
        else:
            if self._burst_rng.random() < self.cfg.burst_bad_to_good_prob:
                self._burst_state = "good"

    def _effective_data_loss_prob(self) -> float:
        if not self.cfg.burst_loss_enabled:
            return self.cfg.data_loss_prob
        self._update_burst_state()
        if self._burst_state == "bad":
            return self.cfg.burst_bad_loss_prob
        return self.cfg.burst_good_loss_prob

    def data_delay_us(self, frame_bytes: int) -> int:
        """Returns nominal one-way delay for a data frame without link queueing."""
        base = self.cfg.propagation_delay_us + self.cfg.serialization_delay_us(frame_bytes)
        jitter = self._data_rng.randint(0, self.cfg.jitter_us) if self.cfg.jitter_us > 0 else 0
        reorder = (self.cfg.propagation_delay_us // 2
                   if self._data_rng.random() < self.cfg.reorder_prob else 0)
        return base + jitter + reorder + self.cfg.router_delay_us

    def ack_delay_us(self, ack_bytes: int = 20) -> int:
        """Returns nominal one-way delay for an ACK frame without link queueing."""
        base = self.cfg.propagation_delay_us + self.cfg.serialization_delay_us(ack_bytes)
        jitter = self._ack_rng.randint(0, self.cfg.jitter_us) if self.cfg.jitter_us > 0 else 0
        return base + jitter + self.cfg.router_delay_us

    def transmit_data(self, frame_bytes: int, now_us: int = 0) -> tuple[ChannelOutcome, int]:
        """
        Simulate data transmission on a FIFO link with physical serialization queueing.
        Returns (outcome, delay_from_now_us).
        """
        tx_start = max(now_us, self._data_tx_busy_until_us)
        ser_delay = self.cfg.serialization_delay_us(frame_bytes)
        self._data_tx_busy_until_us = tx_start + ser_delay

        prop_delay = self.cfg.propagation_delay_us + self.cfg.router_delay_us
        jitter = self._data_rng.randint(0, self.cfg.jitter_us) if self.cfg.jitter_us > 0 else 0
        reorder = (self.cfg.propagation_delay_us // 2
                   if self._data_rng.random() < self.cfg.reorder_prob else 0)

        arrival_us = self._data_tx_busy_until_us + prop_delay + jitter + reorder
        delay = max(1, arrival_us - now_us)

        loss_p = self._effective_data_loss_prob()
        r = self._data_rng.random()
        if r < loss_p:
            return ChannelOutcome.LOST, delay
        r2 = self._data_rng.random()
        if r2 < self.cfg.data_corrupt_prob:
            return ChannelOutcome.CORRUPTED, delay
        r3 = self._data_rng.random()
        if r3 < self.cfg.data_dup_prob:
            return ChannelOutcome.DUPLICATE, delay
        return ChannelOutcome.DELIVERED, delay

    def transmit_ack(self, ack_bytes: int = 20, now_us: int = 0) -> tuple[ChannelOutcome, int]:
        """
        Simulate ACK transmission on a FIFO reverse link with serialization queueing.
        Returns (outcome, delay_from_now_us).
        """
        tx_start = max(now_us, self._ack_tx_busy_until_us)
        ser_delay = self.cfg.serialization_delay_us(ack_bytes)
        self._ack_tx_busy_until_us = tx_start + ser_delay

        prop_delay = self.cfg.propagation_delay_us + self.cfg.router_delay_us
        jitter = self._ack_rng.randint(0, self.cfg.jitter_us) if self.cfg.jitter_us > 0 else 0

        arrival_us = self._ack_tx_busy_until_us + prop_delay + jitter
        delay = max(1, arrival_us - now_us)

        r = self._ack_rng.random()
        if r < self.cfg.ack_loss_prob:
            return ChannelOutcome.LOST, delay
        r2 = self._ack_rng.random()
        if r2 < self.cfg.ack_corrupt_prob:
            return ChannelOutcome.CORRUPTED, delay
        return ChannelOutcome.DELIVERED, delay

