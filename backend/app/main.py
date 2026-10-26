"""
main.py — FastAPI application with HTTP routes and WebSocket event streaming.
"""
from __future__ import annotations
import json
import asyncio
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .models import (
    ARQMode, SelectionResult, StartTransferRequest, TransferStatus,
)
from .protocol_selector import select_protocol
from .scenarios import SCENARIOS, get_scenario
from .sim_manager import create_session, get_file, get_session, store_file

# ─────────────────────────────────────────────────────────────
app = FastAPI(title="ARQuilt Simulation API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_FILE_BYTES = 500_000  # 500 KB limit for demo


# ─────────────────────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "ARQuilt"}


# ─────────────────────────────────────────────────────────────
# Scenarios
# ─────────────────────────────────────────────────────────────
@app.get("/scenarios")
async def list_scenarios():
    return [s.model_dump() for s in SCENARIOS]


@app.get("/scenarios/{scenario_id}")
async def get_scenario_detail(scenario_id: str):
    s = get_scenario(scenario_id)
    if s is None:
        raise HTTPException(404, f"Scenario '{scenario_id}' not found")
    return s.model_dump()


# ─────────────────────────────────────────────────────────────
# File upload & preparation
# ─────────────────────────────────────────────────────────────
@app.post("/files/upload")
async def upload_file(
    file: UploadFile = File(...),
    frame_payload_bytes: int = Form(512),
):
    if frame_payload_bytes < 64 or frame_payload_bytes > 8192:
        raise HTTPException(400, "frame_payload_bytes must be 64–8192")

    data = await file.read()
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(413, f"File too large. Max {MAX_FILE_BYTES} bytes.")

    filename = file.filename or "upload.bin"
    file_id, info = store_file(filename, data, frame_payload_bytes)
    return {"file_id": file_id, "file_info": info.model_dump()}


@app.post("/files/demo")
async def load_demo_file(frame_payload_bytes: int = 512):
    """Load the bundled demo text file."""
    demo_text = DEMO_FILE_CONTENT
    data = demo_text.encode("utf-8")
    file_id, info = store_file("arquilt_demo.txt", data, frame_payload_bytes)
    return {"file_id": file_id, "file_info": info.model_dump()}


@app.get("/files/{file_id}")
async def get_file_info(file_id: str):
    rec = get_file(file_id)
    if rec is None:
        raise HTTPException(404, "File not found")
    _, info = rec
    return info.model_dump()


# ─────────────────────────────────────────────────────────────
# Protocol calibration / auto-selection
# ─────────────────────────────────────────────────────────────
@app.post("/select")
async def run_selection(
    file_id: str,
    scenario_id: str,
    probe_frame_count: int = 20,
):
    rec = get_file(file_id)
    if rec is None:
        raise HTTPException(404, "File not found")
    payload, _ = rec

    scenario = get_scenario(scenario_id)
    if scenario is None:
        raise HTTPException(404, f"Scenario '{scenario_id}' not found")

    result = select_protocol(
        payload=payload,
        channel_cfg=scenario.channel,
        base_arq=scenario.arq,
        data_seed=scenario.data_seed,
        ack_seed=scenario.ack_seed,
        probe_frame_count=probe_frame_count,
    )
    return result.model_dump()


# ─────────────────────────────────────────────────────────────
# Simulation control
# ─────────────────────────────────────────────────────────────
@app.post("/simulations")
async def create_simulation(req: StartTransferRequest):
    rec = get_file(req.file_id)
    if rec is None:
        raise HTTPException(404, "File not found")

    scenario = get_scenario(req.scenario_id)
    if scenario is None:
        raise HTTPException(404, f"Scenario '{req.scenario_id}' not found")

    try:
        sess = create_session(
            file_id=req.file_id,
            scenario_id=req.scenario_id,
            mode=req.mode,
            selection_result=req.selection_result,
            override_window=req.override_window,
            override_retries=req.override_retries,
            override_seed=req.override_seed,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    return {"session_id": sess.session_id}


@app.post("/simulations/{session_id}/pause")
async def pause_sim(session_id: str):
    sess = get_session(session_id)
    if sess is None:
        raise HTTPException(404, "Session not found")
    sess.pause()
    return {"status": "paused"}


@app.post("/simulations/{session_id}/resume")
async def resume_sim(session_id: str):
    sess = get_session(session_id)
    if sess is None:
        raise HTTPException(404, "Session not found")
    sess.resume()
    return {"status": "resumed"}


@app.post("/simulations/{session_id}/step")
async def step_sim(session_id: str):
    sess = get_session(session_id)
    if sess is None:
        raise HTTPException(404, "Session not found")
    sess.step()
    return {"status": "stepped"}


@app.post("/simulations/{session_id}/cancel")
async def cancel_sim(session_id: str):
    sess = get_session(session_id)
    if sess is None:
        raise HTTPException(404, "Session not found")
    sess.cancel()
    return {"status": "cancelled"}


@app.get("/simulations/{session_id}/summary")
async def get_summary(session_id: str):
    sess = get_session(session_id)
    if sess is None:
        raise HTTPException(404, "Session not found")
    return sess.summary().model_dump()


async def _run_session_background(sess):
    try:
        async for _ in sess.run_and_stream():
            pass
    except Exception:
        pass


@app.get("/simulations/{session_id}/events")
async def get_events(session_id: str, since_id: int = 0):
    sess = get_session(session_id)
    if sess is None:
        raise HTTPException(404, "Session not found")
    if not sess._started:
        asyncio.create_task(_run_session_background(sess))
    events = sess.get_events_since(since_id)
    return {
        "session_id": session_id,
        "is_done": sess.is_done(),
        "status": sess.status,
        "events": [e.model_dump() for e in events],
    }



@app.get("/simulations/{session_id}/export")
async def export_report(session_id: str):
    sess = get_session(session_id)
    if sess is None:
        raise HTTPException(404, "Session not found")
    summary = sess.summary()
    scenario = get_scenario(sess.scenario_id)
    report = {
        "session_id": session_id,
        "scenario": scenario.model_dump() if scenario else {},
        "summary": summary.model_dump(),
        "selection": sess.selection_result.model_dump() if sess.selection_result else None,
        "event_count": len(sess.events),
        "events_sample": [e.model_dump() for e in sess.events[:200]],
    }
    return JSONResponse(content=report, headers={
        "Content-Disposition": f'attachment; filename="arquilt_{session_id[:8]}.json"'
    })


# ─────────────────────────────────────────────────────────────
# WebSocket — stream simulation events with reconnection support
# ─────────────────────────────────────────────────────────────
@app.websocket("/ws/{session_id}")
async def websocket_stream(
    websocket: WebSocket,
    session_id: str,
    since_id: int = 0,
):
    await websocket.accept()

    sess = get_session(session_id)
    if sess is None:
        await websocket.send_json({"error": "Session not found"})
        await websocket.close()
        return

    # Listen for control messages from client in background
    async def _listen():
        try:
            while True:
                msg = await websocket.receive_text()
                try:
                    cmd = json.loads(msg)
                    action = cmd.get("action", "")
                    if action == "pause":
                        sess.pause()
                    elif action == "resume":
                        sess.resume()
                    elif action == "step":
                        sess.step()
                    elif action == "set_speed":
                        speed = float(cmd.get("speed", 1.0))
                        sess.set_speed(speed)
                    elif action == "cancel":
                        sess.cancel()
                except Exception:
                    pass
        except WebSocketDisconnect:
            pass  # Do not cancel session on disconnect; allow reconnect

    listen_task = asyncio.create_task(_listen())

    try:
        async for event in sess.run_and_stream(since_id=since_id):
            try:
                await websocket.send_json(event.model_dump())
            except Exception:
                break

        # Send final summary
        try:
            await websocket.send_json({
                "type": "SUMMARY",
                "data": sess.summary().model_dump(),
            })
        except Exception:
            pass

    finally:
        listen_task.cancel()
        try:
            await websocket.close(code=1000)
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────
# Bundled demo file content
# ─────────────────────────────────────────────────────────────
DEMO_FILE_CONTENT = """\
ARQuilt — Interactive ARQ Simulation Lab
========================================
Demo File for Academic Demonstration

This file is used to demonstrate how ARQ (Automatic Repeat reQuest) protocols
work in a virtual network simulation environment.

WHAT IS ARQ?
------------
ARQ protocols are error-control methods for data transmission over unreliable
networks. When a packet is lost, corrupted, or delayed, the sender retransmits
it based on acknowledgements (ACKs) from the receiver.

THREE PROTOCOLS DEMONSTRATED:
------------------------------
1. Stop-and-Wait (SW)
   - Send one frame, wait for ACK before sending the next.
   - Window size = 1. Simple but inefficient on high-latency links.
   - Good for simple, low-bandwidth scenarios.

2. Go-Back-N (GBN)
   - Send up to W frames before requiring an ACK.
   - Receiver only accepts in-order frames.
   - On timeout/error, sender retransmits from the oldest unacknowledged frame.
   - More efficient than SW, but wastes bandwidth retransmitting good frames.

3. Selective Repeat (SR)
   - Send up to W frames, receiver buffers out-of-order frames.
   - Only missing frames are retransmitted (selective retransmission).
   - Most efficient use of bandwidth, but requires larger receiver buffer.

KEY CONCEPTS VISUALISED:
------------------------
- Sequence numbers & wraparound
- Sliding window (sender and receiver)
- Cumulative vs selective acknowledgements
- Propagation delay & serialisation delay
- Packet loss, corruption, duplication
- Timeout and retransmission
- Duplicate suppression
- SHA-256 integrity verification

OSI MODEL LAYERS INVOLVED:
---------------------------
Layer 7 (Application)   : Original file, final reassembly
Layer 6 (Presentation)  : Payload encoding, integrity hash
Layer 5 (Session)       : Transfer session identity
Layer 4 (Transport)     : ARQ mode, sequence numbers, windows, timers
Layer 3 (Network)       : Virtual IP addressing, optional router hop
Layer 2 (Data Link)     : Frame encapsulation, MAC addressing, CRC checksum
Layer 1 (Physical)      : Bit-rate, serialisation delay, propagation, jitter

PREDEFINED SCENARIOS:
---------------------
S01 Clean Network         - Zero loss, low delay
S02 High RTT              - Long propagation delay
S03 Random DATA Loss      - 20% packet loss
S04 ACK Loss              - 25% ACK loss
S05 Burst Loss            - Gilbert-Elliott two-state model
S06 Jitter & Reordering   - Variable delay, out-of-order frames
S07 Limited Receiver RAM  - Receiver window = 1
S08 Corruption            - 25% bit-error corruption rate
S09 Two-Hop Router        - Sender -> Router -> Receiver
S10 Guaranteed Failure    - 100% loss, shows honest failure handling

The simulation is deterministic: given the same scenario seed,
the same sequence of events is reproduced every time.
This makes the demonstration reproducible for live academic audiences.

Hash of this file is computed by SHA-256 and verified at the end of
every successful transfer to confirm byte-perfect delivery.

ARQuilt — Built for clear, accurate, beautiful network education.
"""
