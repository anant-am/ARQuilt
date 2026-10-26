"""
scenarios.py — Ten predefined deterministic network scenarios.

Each scenario has a fixed, fully specified configuration and a seed.
Selecting a scenario populates all parameters.
"""
from __future__ import annotations
from typing import Optional
from .models import ARQCfgModel, ARQMode, ChannelCfgModel, ScenarioInfo


def _s(
    sid: str,
    name: str,
    description: str,
    demonstrates: str,
    channel: ChannelCfgModel,
    arq: ARQCfgModel,
    data_seed: int = 42,
    ack_seed: int = 137,
) -> ScenarioInfo:
    return ScenarioInfo(
        id=sid,
        name=name,
        description=description,
        what_it_demonstrates=demonstrates,
        channel=channel,
        arq=arq,
        data_seed=data_seed,
        ack_seed=ack_seed,
    )


SCENARIOS: list[ScenarioInfo] = [

    # ── 1 ──────────────────────────────────────────────────────
    _s(
        "s01", "Clean Low-Delay Network",
        "Low delay, high bandwidth, zero loss. Ideal conditions.",
        "Ordinary packet flow and ACK return without retransmissions. "
        "Demonstrates how quickly data moves when the channel is perfect.",
        channel=ChannelCfgModel(
            propagation_delay_us=5_000,
            bandwidth_bps=10_000_000,
            data_loss_prob=0.0,
            ack_loss_prob=0.0,
        ),
        arq=ARQCfgModel(mode=ARQMode.AUTO, window_size=4, max_retries=5,
                        timeout_us=30_000, frame_payload_bytes=512, seq_bits=4),
        data_seed=1001, ack_seed=1002,
    ),

    # ── 2 ──────────────────────────────────────────────────────
    _s(
        "s02", "High Round-Trip Delay",
        "High propagation delay (200 ms), low bandwidth, negligible loss.",
        "Cost of waiting for ACKs in SW vs. pipelining benefit in GBN/SR. "
        "Shows why window size matters on high-latency links.",
        channel=ChannelCfgModel(
            propagation_delay_us=200_000,
            bandwidth_bps=1_000_000,
            data_loss_prob=0.02,
            ack_loss_prob=0.0,
        ),
        arq=ARQCfgModel(mode=ARQMode.AUTO, window_size=8, max_retries=5,
                        timeout_us=500_000, frame_payload_bytes=512, seq_bits=4),
        data_seed=2001, ack_seed=2002,
    ),

    # ── 3 ──────────────────────────────────────────────────────
    _s(
        "s03", "Random DATA Loss",
        "Moderate independent DATA loss (~20%), low ACK loss.",
        "Timeouts and recovery; difference between GBN (retransmit group) "
        "and SR (retransmit only missing). Shows retransmission overhead.",
        channel=ChannelCfgModel(
            propagation_delay_us=20_000,
            bandwidth_bps=1_000_000,
            data_loss_prob=0.20,
            ack_loss_prob=0.02,
        ),
        arq=ARQCfgModel(mode=ARQMode.AUTO, window_size=4, max_retries=8,
                        timeout_us=80_000, frame_payload_bytes=512, seq_bits=4),
        data_seed=3001, ack_seed=3002,
    ),

    # ── 4 ──────────────────────────────────────────────────────
    _s(
        "s04", "ACK Loss",
        "Low DATA loss, elevated ACK loss (~25%).",
        "A successfully received frame can still be retransmitted when "
        "its ACK is lost. Why duplicate suppression is essential.",
        channel=ChannelCfgModel(
            propagation_delay_us=15_000,
            bandwidth_bps=1_000_000,
            data_loss_prob=0.03,
            ack_loss_prob=0.25,
        ),
        arq=ARQCfgModel(mode=ARQMode.AUTO, window_size=4, max_retries=6,
                        timeout_us=60_000, frame_payload_bytes=512, seq_bits=4),
        data_seed=4001, ack_seed=4002,
    ),

    # ── 5 ──────────────────────────────────────────────────────
    _s(
        "s05", "Burst Loss",
        "Two-state Gilbert-Elliott channel with good/bad periods.",
        "Clusters of losses affect multiple consecutive frames. "
        "Shows GBN/SR recovery behaviour during burst errors.",
        channel=ChannelCfgModel(
            propagation_delay_us=20_000,
            bandwidth_bps=1_000_000,
            data_loss_prob=0.05,
            burst_loss_enabled=True,
            burst_good_loss_prob=0.02,
            burst_bad_loss_prob=0.80,
            burst_good_to_bad_prob=0.08,
            burst_bad_to_good_prob=0.30,
        ),
        arq=ARQCfgModel(mode=ARQMode.AUTO, window_size=4, max_retries=8,
                        timeout_us=80_000, frame_payload_bytes=512, seq_bits=4),
        data_seed=5001, ack_seed=5002,
    ),

    # ── 6 ──────────────────────────────────────────────────────
    _s(
        "s06", "Jitter and Out-of-Order Arrival",
        "Variable propagation delay and reordering probability.",
        "In-order delivery requirements, out-of-order buffering in SR "
        "vs. discard in GBN. Shows protocol behaviour under variable delay.",
        channel=ChannelCfgModel(
            propagation_delay_us=20_000,
            bandwidth_bps=2_000_000,
            jitter_us=15_000,
            reorder_prob=0.15,
            data_loss_prob=0.05,
            ack_loss_prob=0.05,
        ),
        arq=ARQCfgModel(mode=ARQMode.AUTO, window_size=4, max_retries=6,
                        timeout_us=80_000, frame_payload_bytes=512, seq_bits=4),
        data_seed=6001, ack_seed=6002,
    ),

    # ── 7 ──────────────────────────────────────────────────────
    _s(
        "s07", "Limited Receiver Memory",
        "Receiver buffer capacity restricted to 1 frame; sender window = 4.",
        "Feasibility constraints. SR requires a larger receiver buffer; "
        "GBN works with window=1 at receiver. Shows why buffer matters.",
        channel=ChannelCfgModel(
            propagation_delay_us=20_000,
            bandwidth_bps=1_000_000,
            data_loss_prob=0.10,
        ),
        arq=ARQCfgModel(mode=ARQMode.AUTO, window_size=1, max_retries=6,
                        timeout_us=80_000, frame_payload_bytes=512, seq_bits=4),
        data_seed=7001, ack_seed=7002,
    ),

    # ── 8 ──────────────────────────────────────────────────────
    _s(
        "s08", "Corruption and Checksum Recovery",
        "Frame corruption probability ~25% with sufficient retry budget.",
        "Checksum detection, frame rejection and retransmission recovery. "
        "Shows how ARQ recovers from bit errors at the data-link layer.",
        channel=ChannelCfgModel(
            propagation_delay_us=15_000,
            bandwidth_bps=1_000_000,
            data_corrupt_prob=0.25,
            data_loss_prob=0.05,
        ),
        arq=ARQCfgModel(mode=ARQMode.AUTO, window_size=4, max_retries=10,
                        timeout_us=60_000, frame_payload_bytes=512, seq_bits=4),
        data_seed=8001, ack_seed=8002,
    ),

    # ── 9 ──────────────────────────────────────────────────────
    _s(
        "s09", "Two-Hop Router Path",
        "Sender → Router → Receiver with additional forwarding delay.",
        "Additional hop delay, virtual forwarding. Shows how path affects "
        "RTT and why routing matters in multi-hop virtual networks.",
        channel=ChannelCfgModel(
            propagation_delay_us=20_000,
            bandwidth_bps=1_000_000,
            data_loss_prob=0.05,
            ack_loss_prob=0.03,
            router_delay_us=15_000,
            has_router=True,
        ),
        arq=ARQCfgModel(mode=ARQMode.AUTO, window_size=4, max_retries=6,
                        timeout_us=120_000, frame_payload_bytes=512, seq_bits=4),
        data_seed=9001, ack_seed=9002,
    ),

    # ── 10 ─────────────────────────────────────────────────────
    _s(
        "s10", "Guaranteed Failure Demonstration",
        "100% DATA loss, max 2 retries. Transfer CANNOT succeed.",
        "Honest failure handling: exhausted retries, failure banner, "
        "incomplete delivery state. Demonstrates protocol limits clearly.",
        channel=ChannelCfgModel(
            propagation_delay_us=10_000,
            bandwidth_bps=1_000_000,
            data_loss_prob=1.0,
        ),
        arq=ARQCfgModel(mode=ARQMode.SW, window_size=1, max_retries=2,
                        timeout_us=30_000, frame_payload_bytes=512, seq_bits=4),
        data_seed=10001, ack_seed=10002,
    ),

    # ── 11 (Scenario I) ────────────────────────────────────────
    _s(
        "s11", "Sender Memory Limited",
        "Constrained sender window (Ws=2) with high link delay (50 ms).",
        "Demonstrates the severe impact of sender memory constraints on throughput: "
        "even when the channel is clean, low window size prevents filling the bandwidth-delay pipe.",
        channel=ChannelCfgModel(
            propagation_delay_us=50_000,
            bandwidth_bps=5_000_000,
            data_loss_prob=0.01,
            ack_loss_prob=0.0,
        ),
        arq=ARQCfgModel(mode=ARQMode.AUTO, window_size=2, max_retries=5,
                        timeout_us=150_000, frame_payload_bytes=512, seq_bits=4),
        data_seed=11001, ack_seed=11002,
    ),

    # ── 12 (Scenario J) ────────────────────────────────────────
    _s(
        "s12", "Bandwidth Bottleneck",
        "Low transmission bandwidth (250 kbps), low propagation delay (5 ms).",
        "Demonstrates serialization delay dominating link latency. Packets take significant "
        "virtual time to clear the link pipe, bounding maximum goodput to link capacity.",
        channel=ChannelCfgModel(
            propagation_delay_us=5_000,
            bandwidth_bps=250_000,
            data_loss_prob=0.02,
            ack_loss_prob=0.01,
        ),
        arq=ARQCfgModel(mode=ARQMode.AUTO, window_size=4, max_retries=5,
                        timeout_us=90_000, frame_payload_bytes=512, seq_bits=4),
        data_seed=12001, ack_seed=12002,
    ),

    # ── 13 (Scenario K) ────────────────────────────────────────
    _s(
        "s13", "Asymmetric Forward & Reverse Channels",
        "Fast forward DATA link (10 ms, 2% loss), slow lossy reverse ACK path (60 ms, 22% loss).",
        "Demonstrates why reverse channel impairments trigger spurious timeouts and duplicate transmissions "
        "even when the forward data path is nearly flawless.",
        channel=ChannelCfgModel(
            propagation_delay_us=25_000,
            bandwidth_bps=2_000_000,
            data_loss_prob=0.02,
            ack_loss_prob=0.22,
        ),
        arq=ARQCfgModel(mode=ARQMode.AUTO, window_size=4, max_retries=6,
                        timeout_us=120_000, frame_payload_bytes=512, seq_bits=4),
        data_seed=13001, ack_seed=13002,
    ),

    # ── 14 (Scenario L) ────────────────────────────────────────
    _s(
        "s14", "Queue Congestion & Buffer Pressure",
        "Simulates intermittent router queuing delay and tail-drop losses under load.",
        "Shows buffer buildup and packet discards when the transmission queue saturates. "
        "Selective Repeat buffers out-of-order arrivals to absorb burst jitter.",
        channel=ChannelCfgModel(
            propagation_delay_us=20_000,
            bandwidth_bps=1_500_000,
            jitter_us=25_000,
            data_loss_prob=0.12,
            ack_loss_prob=0.05,
            router_delay_us=20_000,
            has_router=True,
        ),
        arq=ARQCfgModel(mode=ARQMode.AUTO, window_size=5, max_retries=7,
                        timeout_us=140_000, frame_payload_bytes=512, seq_bits=4),
        data_seed=14001, ack_seed=14002,
    ),

    # ── 15 (Scenario N) ────────────────────────────────────────
    _s(
        "s15", "Changing Network Conditions",
        "Dynamic two-state Gilbert-Elliott channel with rapid transitions between clear and degraded states.",
        "Demonstrates how protocols adapt when link error rates shift mid-transfer from low loss to severe loss.",
        channel=ChannelCfgModel(
            propagation_delay_us=15_000,
            bandwidth_bps=1_000_000,
            data_loss_prob=0.05,
            burst_loss_enabled=True,
            burst_good_loss_prob=0.01,
            burst_bad_loss_prob=0.75,
            burst_good_to_bad_prob=0.12,
            burst_bad_to_good_prob=0.20,
        ),
        arq=ARQCfgModel(mode=ARQMode.AUTO, window_size=4, max_retries=8,
                        timeout_us=90_000, frame_payload_bytes=512, seq_bits=4),
        data_seed=15001, ack_seed=15002,
    ),

    # ── 16 (Scenario O) ────────────────────────────────────────
    _s(
        "s16", "Duplicate and Delayed Packets",
        "Substantial packet duplication (25% duplicate prob) combined with 30 ms jitter delay.",
        "Demonstrates duplicate frame suppression at the receiver to maintain exact byte fidelity, "
        "and how out-of-order arrivals are handled differently by GBN vs SR.",
        channel=ChannelCfgModel(
            propagation_delay_us=20_000,
            bandwidth_bps=2_000_000,
            jitter_us=30_000,
            data_dup_prob=0.25,
            reorder_prob=0.20,
            data_loss_prob=0.04,
            ack_loss_prob=0.04,
        ),
        arq=ARQCfgModel(mode=ARQMode.AUTO, window_size=4, max_retries=6,
                        timeout_us=120_000, frame_payload_bytes=512, seq_bits=4),
        data_seed=16001, ack_seed=16002,
    ),
]

SCENARIO_MAP: dict[str, ScenarioInfo] = {s.id: s for s in SCENARIOS}


def get_scenario(sid: str) -> ScenarioInfo | None:
    return SCENARIO_MAP.get(sid)
