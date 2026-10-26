// api.ts — HTTP and WebSocket API client

import type {
  FileInfo, ScenarioInfo, SelectionResult,
  SimEvent, TransferSummary,
} from './types';

const BASE = '/api';

async function _json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetch(`${BASE}/health`).then(r => _json<{ status: string }>(r)),

  scenarios: () => fetch(`${BASE}/scenarios`).then(r => _json<ScenarioInfo[]>(r)),

  uploadFile: async (file: File, framePayloadBytes = 512) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('frame_payload_bytes', String(framePayloadBytes));
    const res = await fetch(`${BASE}/files/upload`, { method: 'POST', body: fd });
    return _json<{ file_id: string; file_info: FileInfo }>(res);
  },

  loadDemo: (framePayloadBytes = 512) =>
    fetch(`${BASE}/files/demo?frame_payload_bytes=${framePayloadBytes}`, { method: 'POST' })
      .then(r => _json<{ file_id: string; file_info: FileInfo }>(r)),

  selectProtocol: (fileId: string, scenarioId: string, probeFrameCount = 20) =>
    fetch(`${BASE}/select?file_id=${fileId}&scenario_id=${scenarioId}&probe_frame_count=${probeFrameCount}`, {
      method: 'POST',
    }).then(r => _json<SelectionResult>(r)),

  createSimulation: (body: {
    file_id: string;
    scenario_id: string;
    mode: string;
    selection_result?: SelectionResult | null;
    override_window?: number | null;
    override_retries?: number | null;
    override_seed?: number | null;
  }) =>
    fetch(`${BASE}/simulations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => _json<{ session_id: string }>(r)),

  pauseSim: (id: string) =>
    fetch(`${BASE}/simulations/${id}/pause`, { method: 'POST' }).then(r => _json(r)),
  resumeSim: (id: string) =>
    fetch(`${BASE}/simulations/${id}/resume`, { method: 'POST' }).then(r => _json(r)),
  stepSim: (id: string) =>
    fetch(`${BASE}/simulations/${id}/step`, { method: 'POST' }).then(r => _json(r)),
  cancelSim: (id: string) =>
    fetch(`${BASE}/simulations/${id}/cancel`, { method: 'POST' }).then(r => _json(r)),

  getSummary: (id: string) =>
    fetch(`${BASE}/simulations/${id}/summary`).then(r => _json<TransferSummary>(r)),

  getEvents: (id: string, sinceId = 0) =>
    fetch(`${BASE}/simulations/${id}/events?since_id=${sinceId}`).then(r => _json<SimEvent[]>(r)),

  exportReport: (id: string) =>
    fetch(`${BASE}/simulations/${id}/export`).then(r => r.json()),

  getExportUrl: (id: string) =>
    `${BASE}/simulations/${id}/export`,
};

export interface SimSocketController {
  close: () => void;
  sendSpeed: (speed: number) => void;
}

// WebSocket helper with event batching & automatic recovery without browser refresh
export function openSimSocket(
  sessionId: string,
  onEventsBatch: (events: SimEvent[]) => void,
  onSummary: (s: TransferSummary) => void,
  onStatusChange?: (status: 'connected' | 'reconnecting' | 'disconnected') => void,
): SimSocketController {
  const isHttps = window.location.protocol === 'https:';
  const proto = isHttps ? 'wss:' : 'ws:';
  let isClosedManually = false;
  let isTerminalState = false;
  let ws: WebSocket | null = null;
  let lastEventId = 0;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Event batching queue to prevent UI lockup
  let eventBuffer: SimEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function flushEvents() {
    if (eventBuffer.length > 0) {
      const batch = [...eventBuffer];
      eventBuffer = [];
      onEventsBatch(batch);
    }
  }

  function connect() {
    if (isClosedManually || isTerminalState) return;

    const wsUrl = `${proto}//${window.location.hostname}:8000/ws/${sessionId}${lastEventId > 0 ? `?since_id=${lastEventId}` : ''}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      reconnectAttempts = 0;
      onStatusChange?.('connected');
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === 'SUMMARY') {
          isTerminalState = true;
          flushEvents();
          onSummary(data.data as TransferSummary);
        } else {
          const ev = data as SimEvent;
          if (ev.event_id) {
            lastEventId = Math.max(lastEventId, ev.event_id);
          }
          eventBuffer.push(ev);

          // Flush every 35ms or immediately if buffer gets large
          if (!flushTimer) {
            flushTimer = setTimeout(() => {
              flushTimer = null;
              flushEvents();
            }, 35);
          }
          if (eventBuffer.length >= 20) {
            if (flushTimer) clearTimeout(flushTimer);
            flushTimer = null;
            flushEvents();
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = (event: CloseEvent) => {
      flushEvents();
      if (isClosedManually || isTerminalState || event.code === 1000) {
        onStatusChange?.('connected');
        return;
      }
      if (reconnectAttempts < 5) {
        reconnectAttempts++;
        onStatusChange?.('reconnecting');
        const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 4000);
        reconnectTimer = setTimeout(connect, delay);
      } else {
        onStatusChange?.('disconnected');
      }
    };

    ws.onerror = () => {
      try {
        ws?.close();
      } catch {
        // ignore
      }
    };
  }

  connect();

  return {
    close: () => {
      isClosedManually = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (flushTimer) clearTimeout(flushTimer);
      flushEvents();
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    },
    sendSpeed: (speed: number) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'SPEED', speed }));
        } catch {
          // ignore
        }
      }
    },
  };
}

