"""
models.py — Pydantic schemas for events, configuration and API responses.
"""
from __future__ import annotations
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field


# ──────────────────────────────────────────────────────────────
# Enums
# ──────────────────────────────────────────────────────────────

class ARQMode(str, Enum):
    SW = "SW"
    GBN = "GBN"
    SR = "SR"
    AUTO = "AUTO"


class EventType(str, Enum):
    # Data path
    DATA_SENT = "DATA_SENT"
    DATA_DELIVERED = "DATA_DELIVERED"
    DATA_LOST = "DATA_LOST"
    DATA_CORRUPTED = "DATA_CORRUPTED"
    DATA_DUPLICATE = "DATA_DUPLICATE"
    DATA_OUT_OF_ORDER = "DATA_OUT_OF_ORDER"
    DATA_BUFFERED = "DATA_BUFFERED"
    # ACK path
    ACK_SENT = "ACK_SENT"
    ACK_DELIVERED = "ACK_DELIVERED"
    ACK_LOST = "ACK_LOST"
    ACK_CORRUPTED = "ACK_CORRUPTED"
    # Control
    TIMEOUT = "TIMEOUT"
    RETRANSMIT = "RETRANSMIT"
    WINDOW_UPDATE = "WINDOW_UPDATE"
    BUFFER_UPDATE = "BUFFER_UPDATE"
    # Transfer lifecycle
    TRANSFER_START = "TRANSFER_START"
    TRANSFER_COMPLETE = "TRANSFER_COMPLETE"
    TRANSFER_FAILED = "TRANSFER_FAILED"
    FRAME_ASSEMBLED = "FRAME_ASSEMBLED"
    FILE_REASSEMBLED = "FILE_REASSEMBLED"
    INTEGRITY_CHECK = "INTEGRITY_CHECK"
    # Calibration
    CALIBRATION_START = "CALIBRATION_START"
    CALIBRATION_COMPLETE = "CALIBRATION_COMPLETE"
    # OSI
    OSI_LAYER = "OSI_LAYER"
    # Router
    ROUTER_FORWARD = "ROUTER_FORWARD"


class TransferStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    COMPLETE = "COMPLETE"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


# ──────────────────────────────────────────────────────────────
# Simulation Events (streamed over WebSocket)
# ──────────────────────────────────────────────────────────────

class SimEvent(BaseModel):
    event_id: int
    vtime_us: int                    # virtual timestamp in µs
    etype: EventType
    seq_no: Optional[int] = None     # frame sequence number (wire)
    abs_seq: Optional[int] = None    # absolute frame index
    attempt: int = 1
    src: str = "sender"
    dst: str = "receiver"
    payload_bytes: Optional[int] = None
    ack_no: Optional[int] = None
    window_base: Optional[int] = None
    window_size: Optional[int] = None
    rx_buffer_used: Optional[int] = None
    explanation: str = ""
    loss_point: Optional[float] = None # 0.0 to 1.0 along transmission path
    failure_type: Optional[str] = None # DATA_LOSS, ACK_LOSS, CRC_CORRUPTION, TIMEOUT, etc.
    sender_state: Optional[str] = None
    receiver_state: Optional[str] = None
    protocol_rule: Optional[str] = None
    extra: dict[str, Any] = Field(default_factory=dict)


# ──────────────────────────────────────────────────────────────
# Channel & ARQ Configuration
# ──────────────────────────────────────────────────────────────

class ChannelCfgModel(BaseModel):
    propagation_delay_us: int = 10_000
    bandwidth_bps: int = 1_000_000
    jitter_us: int = 0
    reorder_prob: float = 0.0
    data_loss_prob: float = 0.0
    ack_loss_prob: float = 0.0
    data_corrupt_prob: float = 0.0
    ack_corrupt_prob: float = 0.0
    burst_loss_enabled: bool = False
    burst_good_loss_prob: float = 0.0
    burst_bad_loss_prob: float = 0.85
    burst_good_to_bad_prob: float = 0.05
    burst_bad_to_good_prob: float = 0.25
    data_dup_prob: float = 0.0
    router_delay_us: int = 0
    has_router: bool = False


class ARQCfgModel(BaseModel):
    mode: ARQMode = ARQMode.SW
    window_size: int = 4
    max_retries: int = 5
    timeout_us: int = 50_000
    frame_payload_bytes: int = 512
    seq_bits: int = 4              # sequence number space = 2^seq_bits


class SimConfig(BaseModel):
    arq: ARQCfgModel = Field(default_factory=ARQCfgModel)
    channel: ChannelCfgModel = Field(default_factory=ChannelCfgModel)
    data_seed: int = 42
    ack_seed: int = 137
    transfer_id: str = "T1"


# ──────────────────────────────────────────────────────────────
# File / Frame
# ──────────────────────────────────────────────────────────────

class FrameInfo(BaseModel):
    abs_seq: int
    seq_no: int          # wire seq (modular)
    payload_bytes: int
    checksum: str        # hex CRC32

class FileInfo(BaseModel):
    filename: str
    size_bytes: int
    sha256: str
    frame_count: int
    payload_size: int
    frames: list[FrameInfo] = Field(default_factory=list)


# ──────────────────────────────────────────────────────────────
# Protocol selection
# ──────────────────────────────────────────────────────────────

class CandidateMetrics(BaseModel):
    mode: ARQMode
    completed: bool
    duration_us: int
    goodput_bps: float
    retransmitted_bytes: int
    control_overhead_bytes: int
    peak_sender_buffer: int
    peak_rx_buffer: int
    integrity_ok: bool
    score: float
    score_breakdown: dict[str, float] = Field(default_factory=dict)
    failure_reason: Optional[str] = None


class SelectionResult(BaseModel):
    candidates: list[CandidateMetrics]
    selected: ARQMode
    is_best_effort: bool = False
    explanation: str = ""


# ──────────────────────────────────────────────────────────────
# Transfer summary
# ──────────────────────────────────────────────────────────────

class TransferSummary(BaseModel):
    transfer_id: str
    status: TransferStatus
    frames_sent: int = 0
    frames_delivered: int = 0
    acks_received: int = 0
    frames_lost: int = 0
    frames_corrupted: int = 0
    retransmissions: int = 0
    bytes_delivered: int = 0
    duration_us: int = 0
    goodput_bps: float = 0.0
    original_sha256: str = ""
    received_sha256: Optional[str] = None
    integrity_ok: Optional[bool] = None
    failure_reason: Optional[str] = None
    arq_mode: Optional[ARQMode] = None
    events: list[SimEvent] = Field(default_factory=list)


# ──────────────────────────────────────────────────────────────
# API request/response
# ──────────────────────────────────────────────────────────────

class ScenarioInfo(BaseModel):
    id: str
    name: str
    description: str
    what_it_demonstrates: str
    channel: ChannelCfgModel
    arq: ARQCfgModel
    data_seed: int
    ack_seed: int


class PrepareRequest(BaseModel):
    filename: str
    frame_payload_bytes: int = 512


class PrepareResponse(BaseModel):
    file_info: FileInfo


class SelectRequest(BaseModel):
    file_id: str
    scenario_id: str
    probe_frame_count: int = 20


class StartTransferRequest(BaseModel):
    file_id: str
    scenario_id: str
    mode: ARQMode = ARQMode.AUTO
    selection_result: Optional[SelectionResult] = None
    override_window: Optional[int] = None
    override_retries: Optional[int] = None
    override_seed: Optional[int] = None
