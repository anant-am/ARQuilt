"""
protocol_selector.py — Explainable ARQ protocol recommendation.

Runs a probe experiment with each of the three ARQ modes using
an independent random seed (never the same seed as the final transfer).
Scores candidates and returns a ranked SelectionResult.

Weights (documented defaults):
  goodput            40 %
  completion_time    25 %
  retransmit_eff     20 %
  buffer_usage       10 %
  control_overhead    5 %
"""
from __future__ import annotations
from typing import Optional

from .arq_engine import ARQEngine
from .channel import Channel, ChannelConfig
from .models import (
    ARQCfgModel, ARQMode, CandidateMetrics, ChannelCfgModel,
    SelectionResult, SimEvent, TransferStatus,
)
from .scheduler import Scheduler


# Scoring weights (must sum to 1.0)
WEIGHTS = {
    "goodput": 0.40,
    "completion_time": 0.25,
    "retransmit_eff": 0.20,
    "buffer_usage": 0.10,
    "control_overhead": 0.05,
}

# Probe uses a seed offset so it NEVER overlaps with any final transfer seed
PROBE_SEED_OFFSET = 999_999


def _chan_cfg_to_obj(ccfg: ChannelCfgModel, data_seed: int, ack_seed: int) -> Channel:
    from .channel import ChannelConfig
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


def _run_probe(
    mode: ARQMode,
    probe_payload: bytes,
    channel_cfg: ChannelCfgModel,
    base_arq: ARQCfgModel,
    data_seed: int,
    ack_seed: int,
) -> CandidateMetrics:
    """Run one probe experiment and return measured metrics."""
    events: list[SimEvent] = []
    sched = Scheduler()
    chan = _chan_cfg_to_obj(channel_cfg, data_seed, ack_seed)

    # Build per-mode ARQ config
    arq_cfg = ARQCfgModel(
        mode=mode,
        window_size=base_arq.window_size,
        max_retries=base_arq.max_retries,
        timeout_us=base_arq.timeout_us,
        frame_payload_bytes=base_arq.frame_payload_bytes,
        seq_bits=base_arq.seq_bits,
    )
    if mode == ARQMode.SW:
        arq_cfg.window_size = 1

    engine = ARQEngine(
        cfg=arq_cfg,
        payload=probe_payload,
        channel=chan,
        scheduler=sched,
        event_cb=events.append,
        transfer_id=f"probe_{mode.value}",
    )
    engine.start()
    sched.run_all(max_events=200_000)

    completed = engine.status == TransferStatus.COMPLETE
    dur = engine.duration_us()
    goodput = engine.goodput_bps() if completed else 0.0
    total_bytes = len(probe_payload)
    retransmit_ratio = (
        engine.stats.retransmissions / max(1, engine.stats.frames_sent)
    )
    retransmit_eff = max(0.0, 1.0 - retransmit_ratio)

    return CandidateMetrics(
        mode=mode,
        completed=completed,
        duration_us=dur,
        goodput_bps=goodput,
        retransmitted_bytes=engine.stats.retransmissions * arq_cfg.frame_payload_bytes,
        control_overhead_bytes=engine.stats.control_overhead_bytes,
        peak_sender_buffer=engine.stats.peak_sender_buffer,
        peak_rx_buffer=engine.stats.peak_rx_buffer,
        integrity_ok=completed,
        score=0.0,
        failure_reason=engine.failure_reason,
    )


def _score(m: CandidateMetrics, all_metrics: list[CandidateMetrics]) -> tuple[float, dict[str, float]]:
    """Compute normalised score [0..1] for a candidate."""
    if not m.completed:
        return 0.0, {}

    completed = [x for x in all_metrics if x.completed]
    if not completed:
        return 0.0, {}

    # Goodput: higher is better
    max_gp = max(x.goodput_bps for x in completed) or 1.0
    gp_norm = m.goodput_bps / max_gp

    # Completion time: lower is better
    min_dur = min(x.duration_us for x in completed) or 1
    max_dur = max(x.duration_us for x in completed) or 1
    if max_dur == min_dur:
        time_norm = 1.0
    else:
        time_norm = 1.0 - (m.duration_us - min_dur) / (max_dur - min_dur)

    # Retransmit efficiency: lower retransmissions is better
    max_retr = max(x.retransmitted_bytes for x in completed) or 1
    retr_norm = 1.0 - (m.retransmitted_bytes / max_retr)

    # Buffer usage: lower peak rx is better
    max_buf = max(x.peak_rx_buffer for x in completed) or 1
    buf_norm = 1.0 - (m.peak_rx_buffer / max_buf)

    # Control overhead: lower is better
    max_ctrl = max(x.control_overhead_bytes for x in completed) or 1
    ctrl_norm = 1.0 - (m.control_overhead_bytes / max_ctrl)

    breakdown = {
        "goodput": gp_norm * WEIGHTS["goodput"],
        "completion_time": time_norm * WEIGHTS["completion_time"],
        "retransmit_eff": retr_norm * WEIGHTS["retransmit_eff"],
        "buffer_usage": buf_norm * WEIGHTS["buffer_usage"],
        "control_overhead": ctrl_norm * WEIGHTS["control_overhead"],
    }
    total = sum(breakdown.values())
    return total, breakdown


def _explain(selected: ARQMode, candidates: list[CandidateMetrics], is_best_effort: bool) -> str:
    cmap = {c.mode: c for c in candidates}
    chosen = cmap.get(selected)
    if chosen is None:
        return "No candidate was selected."

    completed = [c for c in candidates if c.completed]
    failed = [c for c in candidates if not c.completed]

    lines: list[str] = []
    if is_best_effort:
        lines.append(
            f"⚠ No protocol completed successfully under these channel conditions. "
            f"{selected.value} was selected as the least-bad option for a best-effort demonstration."
        )
    else:
        lines.append(
            f"{selected.value} was selected because it achieved the highest composite score "
            f"(goodput 40 %, time 25 %, retransmit efficiency 20 %, buffer 10 %, overhead 5 %)."
        )

    if chosen.completed:
        lines.append(
            f"It completed the probe with {chosen.goodput_bps / 1000:.1f} kbps goodput "
            f"in {chosen.duration_us / 1000:.0f} ms simulated time."
        )
    if chosen.retransmitted_bytes > 0:
        lines.append(
            f"Retransmitted {chosen.retransmitted_bytes} bytes "
            f"({100 * chosen.retransmitted_bytes // max(1, sum(c.retransmitted_bytes + c.goodput_bps for c in candidates if c.completed)):.0f} % overhead)."
        )
    if failed:
        names = ", ".join(c.mode.value for c in failed)
        reasons = "; ".join(
            f"{c.mode.value}: {c.failure_reason or 'probe failed'}" for c in failed
        )
        lines.append(f"Candidates that did not complete: {names}. Reasons: {reasons}.")

    lines.append(
        "Note: probe results estimate suitability — the actual transfer uses "
        "an independent random stream and may differ in detail."
    )
    return " ".join(lines)


def select_protocol(
    payload: bytes,
    channel_cfg: ChannelCfgModel,
    base_arq: ARQCfgModel,
    data_seed: int,
    ack_seed: int,
    probe_frame_count: int = 20,
) -> SelectionResult:
    """
    Run probe experiments for SW, GBN, SR and return SelectionResult.
    Probe uses seed = (data_seed + PROBE_SEED_OFFSET) to ensure independence.
    """
    probe_payload = payload[: probe_frame_count * base_arq.frame_payload_bytes]
    if not probe_payload:
        probe_payload = payload or b"\x00" * base_arq.frame_payload_bytes

    p_data_seed = data_seed + PROBE_SEED_OFFSET
    p_ack_seed = ack_seed + PROBE_SEED_OFFSET

    candidates: list[CandidateMetrics] = []
    for mode in (ARQMode.SW, ARQMode.GBN, ARQMode.SR):
        m = _run_probe(mode, probe_payload, channel_cfg, base_arq,
                       p_data_seed, p_ack_seed)
        candidates.append(m)

    # Score all
    for m in candidates:
        score, breakdown = _score(m, candidates)
        m.score = score
        m.score_breakdown = breakdown

    # Pick winner
    completed = [c for c in candidates if c.completed]
    is_best_effort = len(completed) == 0

    if completed:
        winner = max(completed, key=lambda c: c.score)
    else:
        # No candidate completed — pick by score even among failures
        # (score is 0 for all, so fall back to lowest duration)
        winner = min(candidates, key=lambda c: c.duration_us)

    explanation = _explain(winner.mode, candidates, is_best_effort)

    return SelectionResult(
        candidates=candidates,
        selected=winner.mode,
        is_best_effort=is_best_effort,
        explanation=explanation,
    )
