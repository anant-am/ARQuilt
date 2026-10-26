// types.ts — Shared TypeScript types matching backend Pydantic models

export type ARQMode = 'SW' | 'GBN' | 'SR' | 'AUTO';

export type EventType =
  | 'DATA_SENT' | 'DATA_DELIVERED' | 'DATA_LOST' | 'DATA_CORRUPTED'
  | 'DATA_DUPLICATE' | 'DATA_OUT_OF_ORDER' | 'DATA_BUFFERED'
  | 'ACK_SENT' | 'ACK_DELIVERED' | 'ACK_LOST' | 'ACK_CORRUPTED'
  | 'TIMEOUT' | 'RETRANSMIT' | 'WINDOW_UPDATE' | 'BUFFER_UPDATE'
  | 'TRANSFER_START' | 'TRANSFER_COMPLETE' | 'TRANSFER_FAILED'
  | 'FRAME_ASSEMBLED' | 'FILE_REASSEMBLED' | 'INTEGRITY_CHECK'
  | 'CALIBRATION_START' | 'CALIBRATION_COMPLETE' | 'OSI_LAYER' | 'ROUTER_FORWARD';

export type TransferStatus = 'PENDING' | 'RUNNING' | 'PAUSED' | 'COMPLETE' | 'FAILED' | 'CANCELLED';

export interface SimEvent {
  event_id: number;
  vtime_us: number;
  etype: EventType;
  seq_no?: number;
  abs_seq?: number;
  attempt: number;
  src: string;
  dst: string;
  payload_bytes?: number;
  ack_no?: number;
  window_base?: number;
  window_size?: number;
  rx_buffer_used?: number;
  explanation: string;
  loss_point?: number;
  failure_type?: string;
  sender_state?: string;
  receiver_state?: string;
  protocol_rule?: string;
  extra: Record<string, unknown>;
}

export interface FrameInfo {
  abs_seq: number;
  seq_no: number;
  payload_bytes: number;
  checksum: string;
}

export interface FileInfo {
  filename: string;
  size_bytes: number;
  sha256: string;
  frame_count: number;
  payload_size: number;
  frames: FrameInfo[];
}

export interface ChannelCfg {
  propagation_delay_us: number;
  bandwidth_bps: number;
  jitter_us: number;
  reorder_prob: number;
  data_loss_prob: number;
  ack_loss_prob: number;
  data_corrupt_prob: number;
  ack_corrupt_prob: number;
  burst_loss_enabled: boolean;
  data_dup_prob: number;
  router_delay_us: number;
  has_router: boolean;
}

export interface ARQCfg {
  mode: ARQMode;
  window_size: number;
  max_retries: number;
  timeout_us: number;
  frame_payload_bytes: number;
  seq_bits: number;
}

export interface ScenarioInfo {
  id: string;
  name: string;
  description: string;
  what_it_demonstrates: string;
  channel: ChannelCfg;
  arq: ARQCfg;
  data_seed: number;
  ack_seed: number;
}

export interface CandidateMetrics {
  mode: ARQMode;
  completed: boolean;
  duration_us: number;
  goodput_bps: number;
  retransmitted_bytes: number;
  control_overhead_bytes: number;
  peak_sender_buffer: number;
  peak_rx_buffer: number;
  integrity_ok: boolean;
  score: number;
  score_breakdown: Record<string, number>;
  failure_reason?: string;
}

export interface SelectionResult {
  candidates: CandidateMetrics[];
  selected: ARQMode;
  is_best_effort: boolean;
  explanation: string;
}

export interface TransferSummary {
  transfer_id: string;
  status: TransferStatus;
  frames_sent: number;
  frames_delivered: number;
  acks_received: number;
  frames_lost: number;
  frames_corrupted: number;
  retransmissions: number;
  bytes_delivered: number;
  duration_us: number;
  goodput_bps: number;
  original_sha256: string;
  received_sha256?: string;
  integrity_ok?: boolean;
  failure_reason?: string;
  arq_mode?: ARQMode;
}

// ── App state phases ──────────────────────────────────────────
export type AppPhase =
  | 'FILE_SELECT'
  | 'PACKETS'
  | 'ARQ_SELECTION'
  | 'TRANSFER'
  | 'VERIFICATION';

// ── Animated packet for network view ─────────────────────────
export type PacketState =
  | 'in-flight' | 'delivered' | 'lost' | 'corrupted'
  | 'ack-flight' | 'ack-delivered' | 'ack-lost'
  | 'retransmit' | 'buffered' | 'timeout';

export interface AnimatedPacket {
  id: string;
  abs_seq: number;
  seq_no: number;
  state: PacketState;
  attempt: number;
  direction: 'forward' | 'backward';
  createdAt: number;
  loss_point?: number;
  failure_type?: string;
  explanation?: string;
  sender_state?: string;
  receiver_state?: string;
  protocol_rule?: string;
  vtime_us?: number;
  eventId?: number;
}
