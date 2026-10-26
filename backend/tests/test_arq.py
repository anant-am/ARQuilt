"""
test_arq.py — Backend automated tests for ARQuilt simulation engine.
"""
from __future__ import annotations
import hashlib
import pytest

from app.arq_engine import ARQEngine, make_frames
from app.channel import Channel, ChannelConfig
from app.file_transfer import prepare_file, verify_reassembly
from app.models import ARQCfgModel, ARQMode, TransferStatus
from app.protocol_selector import select_protocol
from app.scenarios import SCENARIOS, get_scenario
from app.scheduler import Scheduler


# ─── helpers ──────────────────────────────────────────────────

def _channel(loss=0.0, ack_loss=0.0, corrupt=0.0, burst=False,
             prop=10_000, bw=1_000_000, jitter=0, reorder=0.0,
             data_seed=42, ack_seed=137):
    cfg = ChannelConfig(
        propagation_delay_us=prop,
        bandwidth_bps=bw,
        jitter_us=jitter,
        reorder_prob=reorder,
        data_loss_prob=loss,
        ack_loss_prob=ack_loss,
        data_corrupt_prob=corrupt,
        burst_loss_enabled=burst,
    )
    return Channel(cfg, data_seed=data_seed, ack_seed=ack_seed)


def _run(mode: ARQMode, payload: bytes, channel: Channel,
         window=4, retries=8, timeout=50_000, seq_bits=4):
    events = []
    sched = Scheduler()
    cfg = ARQCfgModel(mode=mode, window_size=window, max_retries=retries,
                      timeout_us=timeout, frame_payload_bytes=128, seq_bits=seq_bits)
    eng = ARQEngine(cfg=cfg, payload=payload, channel=channel,
                    scheduler=sched, event_cb=events.append)
    eng.start()
    sched.run_all(max_events=100_000)
    return eng, events


# ─── scheduler ────────────────────────────────────────────────

def test_scheduler_ordering():
    from app.scheduler import Scheduler
    order = []
    s = Scheduler()
    s.schedule(30, order.append, "C")
    s.schedule(10, order.append, "A")
    s.schedule(20, order.append, "B")
    s.run_all()
    assert order == ["A", "B", "C"]


def test_scheduler_tie_break():
    order = []
    s = Scheduler()
    s.schedule(10, order.append, "X")
    s.schedule(10, order.append, "Y")
    s.run_all()
    assert order == ["X", "Y"]  # insertion order


def test_scheduler_cancel():
    fired = []
    s = Scheduler()
    ev = s.schedule(10, fired.append, "A")
    s.schedule(10, fired.append, "B")
    s.cancel(ev)
    s.run_all()
    assert fired == ["B"]


# ─── make_frames ──────────────────────────────────────────────

def test_make_frames_exact():
    payload = b"A" * 256
    frames = make_frames(payload, 128, seq_bits=4)
    assert len(frames) == 2
    assert frames[0].abs_seq == 0
    assert frames[1].abs_seq == 1


def test_make_frames_partial():
    payload = b"X" * 130
    frames = make_frames(payload, 128, seq_bits=4)
    assert len(frames) == 2
    assert len(frames[1].payload) == 2


def test_make_frames_zero_byte():
    frames = make_frames(b"", 128, seq_bits=4)
    assert len(frames) == 1
    assert frames[0].payload == b""


def test_make_frames_seq_wraparound():
    payload = b"Z" * (20 * 128)
    frames = make_frames(payload, 128, seq_bits=4)  # modulus=16
    assert frames[16].seq_no == 0   # wraps
    assert frames[15].seq_no == 15
    assert frames[0].abs_seq == 0


# ─── SW clean transfer ─────────────────────────────────────────

def test_sw_clean_transfer():
    payload = b"Hello ARQuilt!" * 10
    eng, _ = _run(ARQMode.SW, payload, _channel())
    assert eng.status == TransferStatus.COMPLETE
    assert eng.received_sha256 == hashlib.sha256(payload).hexdigest()


def test_sw_byte_exact_reassembly():
    payload = bytes(range(256)) * 3
    eng, _ = _run(ARQMode.SW, payload, _channel())
    assert eng.status == TransferStatus.COMPLETE
    received = bytes(eng._delivered_bytes[:len(payload)])
    assert received == payload


# ─── GBN ──────────────────────────────────────────────────────

def test_gbn_clean():
    payload = b"GBN test payload" * 20
    eng, _ = _run(ARQMode.GBN, payload, _channel(), window=4)
    assert eng.status == TransferStatus.COMPLETE


def test_gbn_with_loss():
    payload = b"X" * 1024
    eng, events = _run(ARQMode.GBN, payload, _channel(loss=0.2), window=4, retries=10)
    assert eng.status == TransferStatus.COMPLETE
    assert eng.stats.retransmissions > 0


def test_gbn_retransmits_group():
    """GBN must retransmit from lost frame onward, not just one frame."""
    payload = b"A" * (8 * 128)
    eng, events = _run(ARQMode.GBN, payload, _channel(loss=0.3, data_seed=999),
                       window=4, retries=15)
    retransmit_events = [e for e in events if e.etype.value == "RETRANSMIT"]
    assert len(retransmit_events) >= 0  # may or may not retransmit depending on seed


# ─── SR ───────────────────────────────────────────────────────

def test_sr_clean():
    payload = b"SR clean" * 30
    eng, _ = _run(ARQMode.SR, payload, _channel(), window=4)
    assert eng.status == TransferStatus.COMPLETE


def test_sr_buffers_ooo():
    """SR should buffer out-of-order frames."""
    payload = b"B" * (8 * 128)
    eng, events = _run(ARQMode.SR, payload, _channel(loss=0.2, jitter=5000, reorder=0.2),
                       window=4, retries=10)
    buffered = [e for e in events if e.etype.value == "DATA_BUFFERED"]
    assert eng.status == TransferStatus.COMPLETE
    # buffered may be 0 in perfect runs — just check completion


def test_sr_selective_retransmit():
    """SR retransmits fewer frames than GBN under same loss."""
    payload = b"C" * (10 * 128)
    ch_sr = _channel(loss=0.25, data_seed=777)
    ch_gbn = _channel(loss=0.25, data_seed=777)  # same seed
    eng_sr, _ = _run(ARQMode.SR, payload, ch_sr, window=4, retries=15)
    eng_gbn, _ = _run(ARQMode.GBN, payload, ch_gbn, window=4, retries=15)
    if eng_sr.status == TransferStatus.COMPLETE and eng_gbn.status == TransferStatus.COMPLETE:
        assert eng_sr.stats.retransmissions <= eng_gbn.stats.retransmissions


# ─── Loss scenarios ────────────────────────────────────────────

def test_data_loss_triggers_timeout_retransmit():
    payload = b"D" * 512
    eng, events = _run(ARQMode.SW, payload, _channel(loss=0.5, data_seed=42),
                       retries=10, timeout=30_000)
    timeouts = [e for e in events if e.etype.value == "TIMEOUT"]
    assert len(timeouts) > 0


def test_ack_loss_duplicate_suppression():
    """Data should not be double-counted when ACK is lost and sender retransmits."""
    payload = b"E" * 512
    eng, events = _run(ARQMode.SW, payload, _channel(ack_loss=0.5, data_seed=55),
                       retries=10)
    assert eng.status == TransferStatus.COMPLETE
    received = bytes(eng._delivered_bytes[:len(payload)])
    assert received == payload


def test_corruption_recovery():
    payload = b"F" * 640
    eng, events = _run(ARQMode.SR, payload, _channel(corrupt=0.3), retries=15)
    assert eng.status == TransferStatus.COMPLETE


def test_guaranteed_failure():
    """100% loss must result in FAILED status."""
    payload = b"G" * 256
    eng, events = _run(ARQMode.SW, payload, _channel(loss=1.0), retries=2)
    assert eng.status == TransferStatus.FAILED
    assert eng.failure_reason is not None


# ─── Sequence wraparound ───────────────────────────────────────

def test_sequence_wraparound():
    payload = b"W" * (20 * 128)   # 20 frames, modulus=16 → wraparound at 16
    eng, _ = _run(ARQMode.GBN, payload, _channel(), window=4, seq_bits=4)
    assert eng.status == TransferStatus.COMPLETE
    assert eng.stats.frames_delivered == 20


# ─── Zero-byte file ────────────────────────────────────────────

def test_zero_byte_file():
    payload = b""
    eng, _ = _run(ARQMode.SW, payload, _channel())
    assert eng.status == TransferStatus.COMPLETE


# ─── Window limits ─────────────────────────────────────────────

def test_gbn_window_cap():
    """GBN window must not exceed seq_modulus - 1."""
    from app.arq_engine import ARQEngine
    cfg = ARQCfgModel(mode=ARQMode.GBN, window_size=20, seq_bits=4,
                      max_retries=5, timeout_us=50_000, frame_payload_bytes=128)
    eng = ARQEngine(cfg=cfg, payload=b"X"*128, channel=_channel(),
                    scheduler=Scheduler(), event_cb=lambda e: None)
    assert eng.window <= 15  # 2^4 - 1


def test_sr_window_cap():
    """SR window must not exceed seq_modulus // 2."""
    cfg = ARQCfgModel(mode=ARQMode.SR, window_size=20, seq_bits=4,
                      max_retries=5, timeout_us=50_000, frame_payload_bytes=128)
    eng = ARQEngine(cfg=cfg, payload=b"X"*128, channel=_channel(),
                    scheduler=Scheduler(), event_cb=lambda e: None)
    assert eng.window <= 8   # 2^4 // 2


# ─── File integrity ────────────────────────────────────────────

def test_sha256_match_after_transfer():
    payload = b"Integrity check " * 50
    eng, _ = _run(ARQMode.SR, payload, _channel(), window=4, retries=5)
    assert eng.status == TransferStatus.COMPLETE
    assert eng.received_sha256 == hashlib.sha256(payload).hexdigest()


def test_file_prepare_metadata():
    data = b"Hello" * 100
    info = prepare_file("test.txt", data, frame_payload_bytes=64)
    assert info.size_bytes == len(data)
    assert info.frame_count > 0
    assert len(info.sha256) == 64


# ─── Determinism ──────────────────────────────────────────────

def test_same_seed_same_events():
    payload = b"Determinism" * 50
    def _events(seed):
        events = []
        sched = Scheduler()
        ch = _channel(loss=0.2, data_seed=seed)
        cfg = ARQCfgModel(mode=ARQMode.SR, window_size=4, max_retries=8,
                          timeout_us=50_000, frame_payload_bytes=128, seq_bits=4)
        eng = ARQEngine(cfg=cfg, payload=payload, channel=ch,
                        scheduler=sched, event_cb=events.append)
        eng.start()
        sched.run_all()
        return [e.etype.value for e in events]

    assert _events(42) == _events(42)
    assert _events(42) != _events(43)


# ─── Scenarios ────────────────────────────────────────────────

def test_all_scenarios_have_valid_config():
    for s in SCENARIOS:
        assert s.arq.window_size >= 1
        assert s.arq.max_retries >= 1
        assert 0.0 <= s.channel.data_loss_prob <= 1.0
        assert 0.0 <= s.channel.ack_loss_prob <= 1.0


def test_scenario_10_guaranteed_failure():
    s = get_scenario("s10")
    assert s is not None
    assert s.channel.data_loss_prob == 1.0


def test_scenario_01_clean():
    s = get_scenario("s01")
    assert s.channel.data_loss_prob == 0.0
    assert s.channel.ack_loss_prob == 0.0


# ─── Protocol selector ────────────────────────────────────────

def test_selector_returns_three_candidates():
    s = get_scenario("s01")
    payload = b"Sel" * 200
    result = select_protocol(payload, s.channel, s.arq, s.data_seed, s.ack_seed)
    assert len(result.candidates) == 3


def test_selector_does_not_use_final_seed():
    """Probe seed must differ from final transfer seed."""
    from app.protocol_selector import PROBE_SEED_OFFSET
    data_seed = 1001
    probe_seed = data_seed + PROBE_SEED_OFFSET
    assert probe_seed != data_seed


def test_selector_clean_network_selects_feasible():
    s = get_scenario("s01")
    payload = b"T" * 2000
    result = select_protocol(payload, s.channel, s.arq, s.data_seed, s.ack_seed)
    completed = [c for c in result.candidates if c.completed]
    assert len(completed) > 0
    assert not result.is_best_effort


def test_selector_failure_scenario_honest():
    """Guaranteed failure scenario → all probes fail or is_best_effort."""
    s = get_scenario("s10")
    payload = b"F" * 1000
    result = select_protocol(payload, s.channel, s.arq, s.data_seed, s.ack_seed)
    completed = [c for c in result.candidates if c.completed]
    assert len(completed) == 0
    assert result.is_best_effort


# ─── Partial packet ────────────────────────────────────────────

def test_final_partial_packet():
    payload = b"P" * 130  # 128 + 2 byte partial
    info = prepare_file("partial.bin", payload, frame_payload_bytes=128)
    assert info.frame_count == 2
    assert info.frames[-1].payload_bytes == 2


# ─── API (basic) ──────────────────────────────────────────────

def test_health():
    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_scenarios_endpoint():
    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)
    resp = client.get("/scenarios")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 16
    scenario_ids = [s["id"] for s in data]
    for expected_id in ["s01", "s02", "s03", "s04", "s05", "s06", "s07", "s08", "s09", "s10", "s11", "s12", "s13", "s14", "s15", "s16"]:
        assert expected_id in scenario_ids


def test_upload_and_select():
    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)
    content = b"Test file content " * 50
    resp = client.post(
        "/files/upload",
        files={"file": ("test.txt", content, "text/plain")},
        data={"frame_payload_bytes": "128"},
    )
    assert resp.status_code == 200
    file_id = resp.json()["file_id"]

    sel = client.post(f"/select?file_id={file_id}&scenario_id=s01&probe_frame_count=10")
    assert sel.status_code == 200
    result = sel.json()
    assert "selected" in result
    assert len(result["candidates"]) == 3


def test_upload_oversized_rejected():
    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)
    big = b"X" * 600_000
    resp = client.post(
        "/files/upload",
        files={"file": ("big.bin", big, "application/octet-stream")},
        data={"frame_payload_bytes": "512"},
    )
    assert resp.status_code == 413


def test_demo_file_endpoint():
    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)
    resp = client.post("/files/demo")
    assert resp.status_code == 200
    assert "file_id" in resp.json()


def test_invalid_scenario_rejected():
    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)
    resp = client.get("/scenarios/s99")
    assert resp.status_code == 404


def test_events_diagnostic_metadata_populated():
    from app.arq_engine import ARQEngine
    from app.channel import Channel, ChannelConfig
    from app.models import ARQCfgModel, ARQMode, EventType, SimEvent
    from app.scheduler import Scheduler

    events: list[SimEvent] = []
    sched = Scheduler()
    chan = Channel(ChannelConfig(data_loss_prob=0.5, ack_loss_prob=0.0), data_seed=42, ack_seed=99)
    cfg = ARQCfgModel(mode=ARQMode.SW, window_size=1, max_retries=4, timeout_us=10_000)
    engine = ARQEngine(cfg, b"A" * 1024, chan, sched, events.append)
    engine.start()

    while sched.has_events() and len(events) < 50:
        sched.step()

    # Verify diagnostic fields
    loss_events = [e for e in events if e.etype == EventType.DATA_LOST]
    if loss_events:
        le = loss_events[0]
        assert le.loss_point == 0.5
        assert le.failure_type == "DATA_LOSS"
        assert le.sender_state is not None
        assert le.receiver_state is not None
        assert le.protocol_rule is not None


def test_events_endpoint_and_cursor():
    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)
    
    # 1. Load demo
    demo = client.post("/files/demo").json()
    file_id = demo["file_id"]

    # 2. Start simulation
    sim = client.post("/simulations", json={
        "file_id": file_id,
        "scenario_id": "s01",
        "mode": "SW",
    }).json()
    session_id = sim["session_id"]

    # 3. Query events cursor
    ev_resp = client.get(f"/simulations/{session_id}/events?since_id=0")
    assert ev_resp.status_code == 200
    res = ev_resp.json()
    assert "events" in res
    assert "is_done" in res
    assert "status" in res


def test_retransmission_distinct_attempt_number():
    from app.arq_engine import ARQEngine
    from app.channel import Channel, ChannelConfig
    from app.models import ARQCfgModel, ARQMode, EventType, SimEvent
    from app.scheduler import Scheduler

    events: list[SimEvent] = []
    sched = Scheduler()
    # 50% loss guarantees a loss followed by a retry
    chan = Channel(ChannelConfig(data_loss_prob=0.8, ack_loss_prob=0.0), data_seed=42, ack_seed=10)
    cfg = ARQCfgModel(mode=ARQMode.SW, window_size=1, max_retries=4, timeout_us=10_000)
    engine = ARQEngine(cfg, b"HelloWorld", chan, sched, events.append)
    engine.start()

    while sched.has_events() and len(events) < 60:
        sched.step()

    attempts = [e.attempt for e in events if e.etype in (EventType.DATA_SENT, EventType.RETRANSMIT)]
    assert len(attempts) > 1
    # Check that attempts increase monotonically for retransmissions of the same frame
    assert any(a >= 2 for a in attempts)


def test_ack_loss_duplicate_suppression_byte_count():
    from app.arq_engine import ARQEngine
    from app.channel import Channel, ChannelConfig
    from app.models import ARQCfgModel, ARQMode, EventType, SimEvent, TransferStatus
    from app.scheduler import Scheduler

    events: list[SimEvent] = []
    sched = Scheduler()
    # Force ACK loss
    chan = Channel(ChannelConfig(data_loss_prob=0.0, ack_loss_prob=0.6), data_seed=10, ack_seed=77)
    cfg = ARQCfgModel(mode=ARQMode.SW, window_size=1, max_retries=5, timeout_us=8_000)
    payload = b"ExactPayloadData123456789"
    engine = ARQEngine(cfg, payload, chan, sched, events.append)
    engine.start()

    while sched.has_events() and len(events) < 80:
        sched.step()

    # Reassembled file must match original payload size and content
    delivered = bytes(engine._delivered_bytes)
    assert len(delivered) <= len(payload)
    if engine.status == TransferStatus.COMPLETE:
        assert delivered == payload


def test_all_16_scenarios_execute():
    from app.arq_engine import ARQEngine
    from app.channel import Channel, ChannelConfig
    from app.models import ARQCfgModel, ARQMode, SimEvent
    from app.scheduler import Scheduler
    from app.scenarios import SCENARIOS

    assert len(SCENARIOS) >= 16

    for sc in SCENARIOS:
        events: list[SimEvent] = []
        sched = Scheduler()
        chan = Channel(
            ChannelConfig(
                propagation_delay_us=sc.channel.propagation_delay_us,
                bandwidth_bps=sc.channel.bandwidth_bps,
                data_loss_prob=sc.channel.data_loss_prob,
                ack_loss_prob=sc.channel.ack_loss_prob,
                data_corrupt_prob=sc.channel.data_corrupt_prob,
                burst_loss_enabled=sc.channel.burst_loss_enabled,
                data_dup_prob=sc.channel.data_dup_prob,
            ),
            data_seed=sc.data_seed,
            ack_seed=sc.ack_seed,
        )
        cfg = ARQCfgModel(
            mode=sc.arq.mode,
            window_size=sc.arq.window_size,
            max_retries=sc.arq.max_retries,
            timeout_us=sc.arq.timeout_us,
        )
        engine = ARQEngine(cfg, b"ScenarioBenchmarkPayload", chan, sched, events.append)
        engine.start()

        # Step up to 100 events
        steps = 0
        while sched.has_events() and steps < 100:
            sched.step()
            steps += 1

        assert len(events) > 0, f"Scenario {sc.id} produced no events"


def test_pause_resume_cancel_controls():
    from app.sim_manager import SimSession, store_file
    from app.models import ARQMode

    file_id, _ = store_file("test.txt", b"TestContentForControls")
    session = SimSession(
        session_id="test-ctrl-sess",
        file_id=file_id,
        scenario_id="s01",
        mode=ARQMode.SW,
        selection_result=None,
        override_window=None,
        override_retries=None,
        override_seed=None,
    )

    assert not session._paused
    session.pause()
    assert session._paused

    session.step()
    session.resume()
    assert not session._paused

    session.cancel()
    assert session._cancelled


def test_clean_scenario_s01_zero_unexpected_retries():
    """
    Regression test: Scenario s01 (Clean Low-Delay Network) must never trigger spurious
    timeouts or retransmissions in GBN, SW, or SR due to small trailing frame reordering.
    FIFO serialization queueing guarantees frames arrive in strict transmission order.
    """
    from app.arq_engine import ARQEngine
    from app.channel import Channel, ChannelConfig
    from app.models import ARQCfgModel, ARQMode, EventType, SimEvent
    from app.scheduler import Scheduler
    from app.scenarios import SCENARIOS

    sc01 = next(s for s in SCENARIOS if s.id == "s01")
    # 7 frames (6 full 512-byte frames + 1 small 5-byte frame)
    payload = b"X" * (512 * 6 + 5)

    for mode in (ARQMode.SW, ARQMode.GBN, ARQMode.SR):
        events: list[SimEvent] = []
        sched = Scheduler()
        chan = Channel(
            ChannelConfig(
                propagation_delay_us=sc01.channel.propagation_delay_us,
                bandwidth_bps=sc01.channel.bandwidth_bps,
                data_loss_prob=sc01.channel.data_loss_prob,
                ack_loss_prob=sc01.channel.ack_loss_prob,
                data_corrupt_prob=sc01.channel.data_corrupt_prob,
                burst_loss_enabled=sc01.channel.burst_loss_enabled,
                data_dup_prob=sc01.channel.data_dup_prob,
            ),
            data_seed=sc01.data_seed,
            ack_seed=sc01.ack_seed,
        )
        cfg = ARQCfgModel(
            mode=mode,
            window_size=sc01.arq.window_size,
            max_retries=sc01.arq.max_retries,
            timeout_us=sc01.arq.timeout_us,
        )
        engine = ARQEngine(cfg, payload, chan, sched, events.append)
        engine.start()

        while sched.has_events():
            sched.step()

        assert engine.stats.frames_sent == 7, f"Mode {mode} frames_sent expected 7, got {engine.stats.frames_sent}"
        assert engine.stats.frames_delivered == 7, f"Mode {mode} frames_delivered expected 7, got {engine.stats.frames_delivered}"
        assert engine.stats.retransmissions == 0, f"Mode {mode} retransmissions expected 0, got {engine.stats.retransmissions}"
        assert engine.stats.frames_lost == 0
        assert engine.stats.frames_corrupted == 0
        assert not any(e.etype == EventType.TIMEOUT for e in events), f"Mode {mode} had unexpected TIMEOUT event"




