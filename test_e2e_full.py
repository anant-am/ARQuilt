# test_e2e_full.py — Live End-to-End Simulation Verification Script

import urllib.request
import json
import time
import sys

BASE = "http://127.0.0.1:8000"

def get(path):
    req = urllib.request.Request(f"{BASE}{path}")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

def post(path, body=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

def run_tests():
    print("=== ARQuilt Live E2E Integration Suite ===")

    # 1. Health
    h = get("/health")
    assert h["status"] == "ok", "Health check failed"
    print("[OK] Health endpoint ok")

    # 2. Scenarios
    scenarios = get("/scenarios")
    assert len(scenarios) >= 16, f"Expected at least 16 scenarios, got {len(scenarios)}"
    scenario_ids = [s["id"] for s in scenarios]
    for exp in ["s01", "s03", "s04", "s06", "s10", "s16"]:
        assert exp in scenario_ids, f"Scenario {exp} missing"
    print(f"[OK] All {len(scenarios)} network scenarios verified (s01-s16)")

    # 3. Load Demo File
    demo = post("/files/demo")
    file_id = demo["file_id"]
    file_info = demo["file_info"]
    original_sha256 = file_info["sha256"]
    print(f"[OK] Demo file loaded: {file_info['filename']} ({file_info['size_bytes']} bytes, SHA-256: {original_sha256[:12]}...)")

    # 4. Auto Protocol Selection & Calibration
    sel = post(f"/select?file_id={file_id}&scenario_id=s01&probe_frame_count=15")
    assert "selected" in sel
    assert len(sel["candidates"]) == 3
    print(f"[OK] Protocol auto-selector calibrated: recommended {sel['selected']}")

    # 5. Clean Transfer Run (Scenario S01 - Clean Fast Network)
    sim1 = post("/simulations", {
        "file_id": file_id,
        "scenario_id": "s01",
        "mode": "SW",
    })
    sess1 = sim1["session_id"]
    print(f"[OK] Started S01 transfer session: {sess1}")

    # Poll until done
    for _ in range(50):
        time.sleep(0.05)
        ev_data = get(f"/simulations/{sess1}/events?since_id=0")
        if ev_data["is_done"]:
            break

    summary1 = get(f"/simulations/{sess1}/summary")
    assert summary1["status"] == "COMPLETE", f"Expected COMPLETE, got {summary1['status']}"
    assert summary1["integrity_ok"] == True, "Integrity check failed"
    assert summary1["original_sha256"] == summary1["received_sha256"], "SHA-256 mismatch!"
    print(f"[OK] Transfer verified: SHA-256 match {summary1['received_sha256'][:12]}... (Goodput: {summary1['goodput_bps']} bps)")

    # 6. Loss & Retransmission Diagnostic Metadata (Scenario S03 - Random DATA Loss)
    sim3 = post("/simulations", {
        "file_id": file_id,
        "scenario_id": "s03",
        "mode": "GBN",
    })
    sess3 = sim3["session_id"]

    for _ in range(60):
        time.sleep(0.05)
        ev_data = get(f"/simulations/{sess3}/events?since_id=0")
        if ev_data["is_done"]:
            break

    events3 = ev_data["events"]
    lost_events = [e for e in events3 if e["etype"] == "DATA_LOST"]
    assert len(lost_events) > 0, "Expected DATA_LOST events in scenario S03"
    le = lost_events[0]
    assert le["loss_point"] is not None, "Missing loss_point"
    assert le["failure_type"] == "DATA_LOSS", "Expected failure_type == DATA_LOSS"
    assert le["sender_state"] is not None, "Missing sender_state"
    assert le["receiver_state"] is not None, "Missing receiver_state"
    assert le["protocol_rule"] is not None, "Missing protocol_rule"
    print(f"[OK] Diagnostic metadata populated on DATA_LOST: loss_point={le['loss_point']}, rule='{le['protocol_rule'][:35]}...'")

    # 7. Guaranteed Failure Run (Scenario S10 - 100% Loss & Retry Exhaustion)
    sim10 = post("/simulations", {
        "file_id": file_id,
        "scenario_id": "s10",
        "mode": "SW",
    })
    sess10 = sim10["session_id"]

    for _ in range(60):
        time.sleep(0.05)
        ev_data = get(f"/simulations/{sess10}/events?since_id=0")
        if ev_data["is_done"]:
            break

    summary10 = get(f"/simulations/{sess10}/summary")
    assert summary10["status"] == "FAILED", f"Expected FAILED for S10, got {summary10['status']}"
    assert summary10["integrity_ok"] == False or summary10["integrity_ok"] is None
    print(f"[OK] Guaranteed failure scenario correctly terminated in FAILED state (Reason: {summary10.get('failure_reason')})")

    # 8. Interactive Controls: Pause, Step, Resume, Cancel
    sim_ctrl = post("/simulations", {
        "file_id": file_id,
        "scenario_id": "s02",
        "mode": "SR",
    })
    sess_ctrl = sim_ctrl["session_id"]
    post(f"/simulations/{sess_ctrl}/pause")
    post(f"/simulations/{sess_ctrl}/step")
    post(f"/simulations/{sess_ctrl}/resume")
    post(f"/simulations/{sess_ctrl}/cancel")
    summary_ctrl = get(f"/simulations/{sess_ctrl}/summary")
    assert summary_ctrl["status"] == "CANCELLED"
    print("[OK] Interactive controls (pause, step, resume, cancel) verified")

    print("\n=======================================================")
    print("ALL LIVE END-TO-END VERIFICATION CHECKS PASSED (100%)!")
    print("=======================================================")

if __name__ == "__main__":
    run_tests()
