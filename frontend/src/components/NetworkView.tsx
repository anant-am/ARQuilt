// NetworkView.tsx — Authentic Animated ARQ Simulation Canvas
// Clear packet routes, unmistakable packet loss at loss point, distinct attempt identities,
// directional DATA and ACK rails, and interactive inspection on click.

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SimEvent, PacketState } from '../types';
import { useAppState } from '../store/store';

const CANVAS_W = 760;
const CANVAS_H = 270;

const SENDER_X = 85;
const SENDER_W = 85;
const RECV_X = 675;
const RECV_W = 85;
const ROUTER_X = 380;
const ROUTER_W = 80;

// Directional rail Y coordinates
const DATA_LANE_Y = 110;
const ACK_LANE_Y = 160;

export interface VisualAttempt {
  key: string;              // unique per attempt: tx-${abs_seq}-${attempt} or ack-${abs_seq}-${attempt}
  abs_seq: number;
  seq_no: number;
  attempt: number;
  direction: 'forward' | 'backward';
  state: PacketState;
  startX: number;
  targetX: number;
  y: number;
  lossPoint?: number;
  failureType?: string;
  explanation: string;
  event: SimEvent;
  createdAt: number;
  durationMs: number;
}

export interface LossMarker {
  id: string;
  x: number;
  y: number;
  label: string;
  sublabel: string;
  color: string;
  event: SimEvent;
  createdAt: number;
}

export interface TimeoutIndicator {
  id: string;
  seq_no: number;
  abs_seq: number;
  attempt: number;
  event: SimEvent;
  createdAt: number;
}

interface NetworkViewProps {
  events: SimEvent[];
  hasRouter: boolean;
  isRunning: boolean;
  onSelectEvent?: (e: SimEvent) => void;
}

export function NetworkView({ events, hasRouter, isRunning, onSelectEvent }: NetworkViewProps) {
  const { state, dispatch } = useAppState();
  const speed = state.speed || 1;

  // Active attempts currently on screen
  const [attempts, setAttempts] = useState<VisualAttempt[]>([]);
  const [lossMarkers, setLossMarkers] = useState<LossMarker[]>([]);
  const [timeouts, setTimeouts] = useState<TimeoutIndicator[]>([]);

  // Track the highest event_id processed to avoid reprocessing on re-render
  const lastProcessedEventIdRef = useRef<number>(0);

  // Animation duration scaled by playback speed (clamp between 300ms and 2400ms)
  const animDurationMs = useMemo(() => {
    return Math.max(300, Math.min(2400, Math.round(1100 / speed)));
  }, [speed]);

  const selectEvent = (ev: SimEvent) => {
    if (onSelectEvent) {
      onSelectEvent(ev);
    } else {
      dispatch({ type: 'SET_SELECTED_EVENT', event: ev });
    }
  };

  // Process incoming events deterministically
  useEffect(() => {
    if (events.length === 0) {
      // Simulation reset
      setAttempts([]);
      setLossMarkers([]);
      setTimeouts([]);
      lastProcessedEventIdRef.current = 0;
      return;
    }

    const unprocessed = events.filter(e => e.event_id > lastProcessedEventIdRef.current);
    if (unprocessed.length === 0) return;

    lastProcessedEventIdRef.current = Math.max(...events.map(e => e.event_id));

    const now = Date.now();
    const newAttempts: VisualAttempt[] = [];
    const newMarkers: LossMarker[] = [];
    const newTimeouts: TimeoutIndicator[] = [];

    // Calculate midpoint or loss coordinate
    const txStartX = SENDER_X + SENDER_W / 2 + 5;
    const txTargetX = RECV_X - RECV_W / 2 - 5;
    const ackStartX = RECV_X - RECV_W / 2 - 5;
    const ackTargetX = SENDER_X + SENDER_W / 2 + 5;

    const defaultLossX = hasRouter ? ROUTER_X : CANVAS_W / 2;

    for (const ev of unprocessed) {
      const absSeq = ev.abs_seq ?? ev.seq_no ?? 0;
      const seqNo = ev.seq_no ?? absSeq;
      const attemptNum = ev.attempt || 1;

      // 1. DATA TRANSMISSION (Original or Retransmit)
      if (ev.etype === 'DATA_SENT' || ev.etype === 'RETRANSMIT') {
        const key = `tx-${absSeq}-${attemptNum}`;
        newAttempts.push({
          key,
          abs_seq: absSeq,
          seq_no: seqNo,
          attempt: attemptNum,
          direction: 'forward',
          state: ev.etype === 'RETRANSMIT' ? 'retransmit' : 'in-flight',
          startX: txStartX,
          targetX: txTargetX,
          y: DATA_LANE_Y,
          explanation: ev.explanation,
          event: ev,
          createdAt: now,
          durationMs: animDurationMs,
        });
      }

      // 2. DATA LOSS (Must drop at loss point without reaching receiver)
      else if (ev.etype === 'DATA_LOST') {
        const key = `tx-${absSeq}-${attemptNum}`;
        const lossFrac = ev.loss_point ?? 0.5;
        const lossX = txStartX + (txTargetX - txStartX) * lossFrac;

        newAttempts.push({
          key: `${key}-lost`,
          abs_seq: absSeq,
          seq_no: seqNo,
          attempt: attemptNum,
          direction: 'forward',
          state: 'lost',
          startX: txStartX,
          targetX: lossX,
          y: DATA_LANE_Y,
          lossPoint: lossFrac,
          failureType: 'DATA_LOSS',
          explanation: ev.explanation,
          event: ev,
          createdAt: now,
          durationMs: Math.round(animDurationMs * lossFrac),
        });

        newMarkers.push({
          id: `marker-loss-${ev.event_id}`,
          x: lossX,
          y: DATA_LANE_Y - 20,
          label: `DATA LOST`,
          sublabel: `#${absSeq} (Try #${attemptNum})`,
          color: '#ef4444',
          event: ev,
          createdAt: now,
        });
      }

      // 3. DATA CORRUPTED (Arrives at receiver but fails CRC check)
      else if (ev.etype === 'DATA_CORRUPTED') {
        const key = `tx-${absSeq}-${attemptNum}-corrupt`;
        newAttempts.push({
          key,
          abs_seq: absSeq,
          seq_no: seqNo,
          attempt: attemptNum,
          direction: 'forward',
          state: 'corrupted',
          startX: txStartX,
          targetX: txTargetX,
          y: DATA_LANE_Y,
          failureType: 'CRC_CORRUPTION',
          explanation: ev.explanation,
          event: ev,
          createdAt: now,
          durationMs: animDurationMs,
        });

        newMarkers.push({
          id: `marker-corrupt-${ev.event_id}`,
          x: txTargetX - 10,
          y: DATA_LANE_Y - 20,
          label: `CRC ERROR`,
          sublabel: `Checksum Mismatch`,
          color: '#f97316',
          event: ev,
          createdAt: now,
        });
      }

      // 4. DATA DELIVERED
      else if (ev.etype === 'DATA_DELIVERED') {
        const key = `tx-${absSeq}-${attemptNum}-deliv`;
        newAttempts.push({
          key,
          abs_seq: absSeq,
          seq_no: seqNo,
          attempt: attemptNum,
          direction: 'forward',
          state: 'delivered',
          startX: txStartX,
          targetX: txTargetX,
          y: DATA_LANE_Y,
          explanation: ev.explanation,
          event: ev,
          createdAt: now,
          durationMs: animDurationMs,
        });
      }

      // 5. DATA BUFFERED (Selective Repeat out-of-order)
      else if (ev.etype === 'DATA_BUFFERED') {
        const key = `tx-${absSeq}-${attemptNum}-buf`;
        newAttempts.push({
          key,
          abs_seq: absSeq,
          seq_no: seqNo,
          attempt: attemptNum,
          direction: 'forward',
          state: 'buffered',
          startX: txStartX,
          targetX: txTargetX,
          y: DATA_LANE_Y,
          explanation: ev.explanation,
          event: ev,
          createdAt: now,
          durationMs: animDurationMs,
        });
      }

      // 6. ACK TRANSMISSION (Reverse path)
      else if (ev.etype === 'ACK_SENT') {
        const ackNo = ev.ack_no ?? seqNo;
        const key = `ack-${ackNo}-${attemptNum}`;
        newAttempts.push({
          key,
          abs_seq: ackNo,
          seq_no: ackNo,
          attempt: attemptNum,
          direction: 'backward',
          state: 'ack-flight',
          startX: ackStartX,
          targetX: ackTargetX,
          y: ACK_LANE_Y,
          explanation: ev.explanation,
          event: ev,
          createdAt: now,
          durationMs: animDurationMs,
        });
      }

      // 7. ACK LOSS (Drops along reverse channel)
      else if (ev.etype === 'ACK_LOST') {
        const ackNo = ev.ack_no ?? seqNo;
        const lossFrac = ev.loss_point ?? 0.5;
        const lossX = ackStartX - (ackStartX - ackTargetX) * lossFrac;

        newAttempts.push({
          key: `ack-${ackNo}-${attemptNum}-lost`,
          abs_seq: ackNo,
          seq_no: ackNo,
          attempt: attemptNum,
          direction: 'backward',
          state: 'ack-lost',
          startX: ackStartX,
          targetX: lossX,
          y: ACK_LANE_Y,
          lossPoint: lossFrac,
          failureType: 'ACK_LOSS',
          explanation: ev.explanation,
          event: ev,
          createdAt: now,
          durationMs: Math.round(animDurationMs * lossFrac),
        });

        newMarkers.push({
          id: `marker-ack-loss-${ev.event_id}`,
          x: lossX,
          y: ACK_LANE_Y + 24,
          label: `ACK LOST`,
          sublabel: `ACK #${ackNo}`,
          color: '#ef4444',
          event: ev,
          createdAt: now,
        });
      }

      // 8. ACK DELIVERED (Reaches sender)
      else if (ev.etype === 'ACK_DELIVERED') {
        const ackNo = ev.ack_no ?? seqNo;
        const key = `ack-${ackNo}-${attemptNum}-deliv`;
        newAttempts.push({
          key,
          abs_seq: ackNo,
          seq_no: ackNo,
          attempt: attemptNum,
          direction: 'backward',
          state: 'ack-delivered',
          startX: ackStartX,
          targetX: ackTargetX,
          y: ACK_LANE_Y,
          explanation: ev.explanation,
          event: ev,
          createdAt: now,
          durationMs: animDurationMs,
        });
      }

      // 9. TIMEOUT (Fires at Sender)
      else if (ev.etype === 'TIMEOUT') {
        newTimeouts.push({
          id: `timeout-${ev.event_id}`,
          seq_no: seqNo,
          abs_seq: absSeq,
          attempt: attemptNum,
          event: ev,
          createdAt: now,
        });
      }

      // 10. TRANSFER_COMPLETE (Clear remaining in-flight animations on wire)
      else if (ev.etype === 'TRANSFER_COMPLETE') {
        newAttempts.length = 0;
        setAttempts([]);
      }
    }

    // Merge state with retention limits (keep up to 25 recent attempts, 10 markers, 5 timeouts)
    if (newAttempts.length > 0) {
      setAttempts(prev => [...prev.slice(-18), ...newAttempts]);
    }
    if (newMarkers.length > 0) {
      setLossMarkers(prev => [...prev.slice(-8), ...newMarkers]);
    }
    if (newTimeouts.length > 0) {
      setTimeouts(prev => [...prev.slice(-4), ...newTimeouts]);
    }
  }, [events, animDurationMs, hasRouter]);

  // When transfer completes, immediately clear remaining in-flight/hovering packets
  useEffect(() => {
    if (state.summary) {
      if (state.summary.status === 'COMPLETE') {
        setAttempts([]);
        setTimeouts([]);
      } else {
        setAttempts(prev => prev.filter(a => a.state === 'lost' || a.state === 'ack-lost'));
      }
    }
  }, [state.summary]);

  // Periodic cleanup of expired visual items
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setAttempts(prev => prev.filter(a => {
        const graceMs = (a.state === 'lost' || a.state === 'ack-lost') ? 600 : 300;
        return now - a.createdAt < a.durationMs + graceMs;
      }));
      setLossMarkers(prev => prev.filter(m => now - m.createdAt < 3600));
      setTimeouts(prev => prev.filter(t => now - t.createdAt < 2500));
    }, 250);
    return () => clearInterval(interval);
  }, []);

  // Compute node activity flags from recent events
  const recentLoss = events.slice(-15).some(e => e.etype === 'DATA_LOST' || e.etype === 'ACK_LOST');
  const recentCorrupt = events.slice(-10).some(e => e.etype === 'DATA_CORRUPTED');
  const recentDeliv = events.slice(-8).some(e => e.etype === 'DATA_DELIVERED');
  const recentAck = events.slice(-8).some(e => e.etype === 'ACK_DELIVERED');

  return (
    <div className="w-full relative select-none">
      <svg
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        className="w-full h-auto rounded-xl bg-slate-950 border border-slate-800 shadow-2xl overflow-hidden"
        style={{ maxHeight: 270 }}
      >
        {/* Background Network Grid Pattern */}
        <defs>
          <pattern id="net-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#1e293b" strokeWidth="0.6" strokeOpacity="0.4" />
          </pattern>
          <linearGradient id="dataGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.8" />
          </linearGradient>
          <linearGradient id="ackGrad" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0.8" />
          </linearGradient>
        </defs>
        <rect width={CANVAS_W} height={CANVAS_H} fill="url(#net-grid)" />

        {/* Channel Loss & Distortion Zone Area */}
        <g opacity={0.6}>
          <rect
            x={hasRouter ? ROUTER_X - 60 : CANVAS_W / 2 - 75}
            y={50}
            width={hasRouter ? 120 : 150}
            height={170}
            rx={10}
            fill="#ef4444"
            fillOpacity={recentLoss ? 0.08 : 0.02}
            stroke="#ef4444"
            strokeWidth={1}
            strokeDasharray="4 4"
            strokeOpacity={recentLoss ? 0.4 : 0.15}
          />
          <text
            x={hasRouter ? ROUTER_X : CANVAS_W / 2}
            y={68}
            textAnchor="middle"
            fill="#94a3b8"
            fontSize={9}
            fontWeight="bold"
            letterSpacing={1}
          >
            VIRTUAL CHANNEL LOSS ZONE
          </text>
        </g>

        {/* ── Forward DATA Rail (Top) ─────────────────────────── */}
        <g>
          <line
            x1={SENDER_X + SENDER_W / 2}
            y1={DATA_LANE_Y}
            x2={RECV_X - RECV_W / 2}
            y2={DATA_LANE_Y}
            stroke="#334155"
            strokeWidth={3}
            strokeDasharray="6 4"
          />
          <text
            x={CANVAS_W / 2}
            y={DATA_LANE_Y - 9}
            textAnchor="middle"
            fill="#64748b"
            fontSize={8}
            letterSpacing={2}
            fontWeight="bold"
          >
            FORWARD DATA PATH →
          </text>
        </g>

        {/* ── Reverse ACK Rail (Bottom) ────────────────────────── */}
        <g>
          <line
            x1={RECV_X - RECV_W / 2}
            y1={ACK_LANE_Y}
            x2={SENDER_X + SENDER_W / 2}
            y2={ACK_LANE_Y}
            stroke="#1e3a5f"
            strokeWidth={3}
            strokeDasharray="6 4"
          />
          <text
            x={CANVAS_W / 2}
            y={ACK_LANE_Y + 16}
            textAnchor="middle"
            fill="#0284c7"
            fontSize={8}
            letterSpacing={2}
            fontWeight="bold"
            opacity={0.8}
          >
            ← REVERSE ACK PATH
          </text>
        </g>

        {/* ── Sender Node ───────────────────────────────────────── */}
        <g
          className="cursor-pointer"
          onClick={() => {
            const lastTx = events.filter(e => e.src === 'sender').pop();
            if (lastTx) selectEvent(lastTx);
          }}
        >
          <rect
            x={SENDER_X - SENDER_W / 2}
            y={70}
            width={SENDER_W}
            height={130}
            rx={10}
            fill="#0f172a"
            stroke={isRunning ? '#6366f1' : '#334155'}
            strokeWidth={2}
          />
          <text x={SENDER_X} y={92} textAnchor="middle" fill="#e2e8f0" fontSize={11} fontWeight="bold">
            SENDER
          </text>
          <text x={SENDER_X} y={106} textAnchor="middle" fill="#6366f1" fontSize={8} fontWeight="semibold">
            (TX NODE)
          </text>
          <line x1={SENDER_X - 35} y1={118} x2={SENDER_X + 35} y2={118} stroke="#1e293b" />
          <text x={SENDER_X} y={134} textAnchor="middle" fill="#94a3b8" fontSize={9}>
            Mode: <tspan fill="#38bdf8" fontWeight="bold">{state.selectedMode}</tspan>
          </text>
          <text x={SENDER_X} y={150} textAnchor="middle" fill="#94a3b8" fontSize={9}>
            Win: <tspan fill="#a78bfa">{state.scenario?.arq.window_size ?? 4}</tspan>
          </text>
          <text x={SENDER_X} y={175} textAnchor="middle" fill={recentAck ? '#10b981' : '#64748b'} fontSize={8} fontWeight="bold">
            {recentAck ? 'ACK RECEIVED' : isRunning ? 'TRANSMITTING' : 'IDLE'}
          </text>
        </g>

        {/* ── Router Node (Optional) ────────────────────────────── */}
        {hasRouter && (
          <g>
            <rect
              x={ROUTER_X - ROUTER_W / 2}
              y={70}
              width={ROUTER_W}
              height={130}
              rx={10}
              fill="#0f172a"
              stroke="#8b5cf6"
              strokeWidth={1.5}
            />
            <text x={ROUTER_X} y={92} textAnchor="middle" fill="#e2e8f0" fontSize={11} fontWeight="bold">
              ROUTER
            </text>
            <text x={ROUTER_X} y={106} textAnchor="middle" fill="#8b5cf6" fontSize={8} fontWeight="semibold">
              (HOP 1)
            </text>
            <line x1={ROUTER_X - 30} y1={118} x2={ROUTER_X + 30} y2={118} stroke="#1e293b" />
            <text x={ROUTER_X} y={142} textAnchor="middle" fill="#a78bfa" fontSize={8}>
              Buffer Queued
            </text>
            <text x={ROUTER_X} y={160} textAnchor="middle" fill="#64748b" fontSize={8}>
              Fwd Delay
            </text>
          </g>
        )}

        {/* ── Receiver Node ─────────────────────────────────────── */}
        <g
          className="cursor-pointer"
          onClick={() => {
            const lastRx = events.filter(e => e.dst === 'receiver' || e.src === 'receiver').pop();
            if (lastRx) selectEvent(lastRx);
          }}
        >
          <rect
            x={RECV_X - RECV_W / 2}
            y={70}
            width={RECV_W}
            height={130}
            rx={10}
            fill="#0f172a"
            stroke={recentCorrupt ? '#f97316' : recentDeliv ? '#10b981' : '#334155'}
            strokeWidth={2}
          />
          <text x={RECV_X} y={92} textAnchor="middle" fill="#e2e8f0" fontSize={11} fontWeight="bold">
            RECEIVER
          </text>
          <text x={RECV_X} y={106} textAnchor="middle" fill="#10b981" fontSize={8} fontWeight="semibold">
            (RX NODE)
          </text>
          <line x1={RECV_X - 35} y1={118} x2={RECV_X + 35} y2={118} stroke="#1e293b" />
          <text x={RECV_X} y={134} textAnchor="middle" fill="#94a3b8" fontSize={9}>
            Delivered
          </text>
          <text x={RECV_X} y={152} textAnchor="middle" fill="#34d399" fontSize={13} fontWeight="bold" fontFamily="monospace">
            {state.summary?.frames_delivered ?? events.filter(e => e.etype === 'DATA_DELIVERED').length}
          </text>
          <text
            x={RECV_X}
            y={175}
            textAnchor="middle"
            fill={recentCorrupt ? '#f97316' : recentDeliv ? '#10b981' : '#64748b'}
            fontSize={8}
            fontWeight="bold"
          >
            {recentCorrupt ? 'CRC REJECT' : recentDeliv ? 'DELIVERY OK' : 'LISTENING'}
          </text>
        </g>

        {/* ── Timeout Radar Pulses at Sender ────────────────────── */}
        <AnimatePresence>
          {timeouts.map(t => (
            <g
              key={t.id}
              className="cursor-pointer"
              onClick={() => selectEvent(t.event)}
            >
              <motion.circle
                cx={SENDER_X}
                cy={DATA_LANE_Y}
                r={22}
                fill="none"
                stroke="#f59e0b"
                strokeWidth={2}
                initial={{ scale: 0.5, opacity: 1 }}
                animate={{ scale: [1, 2.2], opacity: [1, 0] }}
                transition={{ duration: 1.2, repeat: 2, ease: 'easeOut' }}
              />
              <motion.g
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <rect
                  x={SENDER_X - 42}
                  y={DATA_LANE_Y - 48}
                  width={84}
                  height={20}
                  rx={4}
                  fill="#78350f"
                  stroke="#f59e0b"
                  strokeWidth={1}
                />
                <text
                  x={SENDER_X}
                  y={DATA_LANE_Y - 35}
                  textAnchor="middle"
                  fill="#fef3c7"
                  fontSize={8}
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  TIMEOUT #{t.abs_seq}
                </text>
              </motion.g>
            </g>
          ))}
        </AnimatePresence>

        {/* ── Active Packet Animations ──────────────────────────── */}
        <AnimatePresence>
          {attempts.map(att => {
            const isForward = att.direction === 'forward';
            const isLost = att.state === 'lost';
            const isCorrupt = att.state === 'corrupted';
            const isAckLost = att.state === 'ack-lost';
            const isRetry = att.state === 'retransmit';

            // Distinct theme colors
            let strokeColor = isForward ? '#6366f1' : '#10b981';
            let fillColor = isForward ? '#4338ca' : '#047857';

            if (isRetry) {
              strokeColor = '#f59e0b';
              fillColor = '#b45309';
            } else if (isLost || isAckLost) {
              strokeColor = '#ef4444';
              fillColor = '#b91c1c';
            } else if (isCorrupt) {
              strokeColor = '#f97316';
              fillColor = '#c2410c';
            } else if (att.state === 'buffered') {
              strokeColor = '#06b6d4';
              fillColor = '#0e7490';
            }

            const durationSec = att.durationMs / 1000;

            return (
              <motion.g
                key={att.key}
                initial={{ x: att.startX, opacity: 0, scale: 0.5 }}
                animate={{
                  x: att.targetX,
                  opacity: (isLost || isAckLost) ? [1, 1, 0.8, 0] : 1,
                  scale: (isLost || isAckLost) ? [1, 1, 1.3, 0] : isCorrupt ? [1, 1, 1.2] : 1,
                }}
                transition={{
                  x: { duration: durationSec, ease: 'linear' },
                  opacity: (isLost || isAckLost) ? { duration: durationSec + 0.5, times: [0, 0.7, 0.9, 1] } : { duration: 0.2 },
                  scale: (isLost || isAckLost) ? { duration: durationSec + 0.5, times: [0, 0.7, 0.85, 1] } : { duration: 0.2 },
                }}
                exit={{ opacity: 0, scale: 0 }}
                className="cursor-pointer"
                onClick={() => selectEvent(att.event)}
              >
                {/* Packet / ACK Capsule */}
                <circle
                  cx={0}
                  cy={att.y}
                  r={isForward ? 13 : 11}
                  fill={fillColor}
                  fillOpacity={0.85}
                  stroke={strokeColor}
                  strokeWidth={2}
                />

                {/* Packet Label */}
                <text
                  x={0}
                  y={att.y + 3.5}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize={8}
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  {isForward ? `#${att.abs_seq}` : `A${att.abs_seq}`}
                </text>

                {/* Attempt Badge on Retransmissions */}
                {att.attempt > 1 && (
                  <g>
                    <rect
                      x={-14}
                      y={att.y - (isForward ? 22 : 20)}
                      width={28}
                      height={10}
                      rx={3}
                      fill="#78350f"
                      stroke="#f59e0b"
                      strokeWidth={0.8}
                    />
                    <text
                      x={0}
                      y={att.y - (isForward ? 14 : 12)}
                      textAnchor="middle"
                      fill="#fef3c7"
                      fontSize={6.5}
                      fontWeight="bold"
                    >
                      TRY #{att.attempt}
                    </text>
                  </g>
                )}

                {/* Shatter particles at Loss Point */}
                {(isLost || isAckLost) && (
                  <motion.g
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: [0, 1, 0], scale: [0.5, 1.8, 2.4] }}
                    transition={{ delay: durationSec * 0.85, duration: 0.6 }}
                  >
                    <circle cx={-6} cy={att.y - 6} r={2} fill="#ef4444" />
                    <circle cx={6} cy={att.y + 6} r={2} fill="#ef4444" />
                    <circle cx={-5} cy={att.y + 7} r={1.5} fill="#fca5a5" />
                    <circle cx={7} cy={att.y - 5} r={1.5} fill="#fca5a5" />
                  </motion.g>
                )}
              </motion.g>
            );
          })}
        </AnimatePresence>

        {/* ── Persistent Loss & Failure Markers (Clickable) ──────── */}
        <AnimatePresence>
          {lossMarkers.map(m => (
            <motion.g
              key={m.id}
              initial={{ opacity: 0, scale: 0.7, y: -5 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.2 }}
              className="cursor-pointer"
              onClick={() => selectEvent(m.event)}
            >
              {/* Badge Background */}
              <rect
                x={m.x - 45}
                y={m.y}
                width={90}
                height={26}
                rx={6}
                fill="#450a0a"
                stroke={m.color}
                strokeWidth={1.5}
                filter="drop-shadow(0 2px 6px rgba(239, 68, 68, 0.4))"
              />
              <text
                x={m.x}
                y={m.y + 11}
                textAnchor="middle"
                fill="#fca5a5"
                fontSize={8}
                fontWeight="bold"
                letterSpacing={0.5}
              >
                {m.label}
              </text>
              <text
                x={m.x}
                y={m.y + 21}
                textAnchor="middle"
                fill="#fecaca"
                fontSize={7}
                fontFamily="monospace"
              >
                {m.sublabel}
              </text>
            </motion.g>
          ))}
        </AnimatePresence>
      </svg>

      {/* Legend & Hint Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 mt-1 text-[11px] text-slate-400 bg-slate-900/60 rounded-lg border border-slate-800">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" />
            <span>DATA (Forward)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            <span>ACK (Reverse)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
            <span>Retransmission</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
            <span>Packet Loss (Zone)</span>
          </div>
        </div>

        <span className="text-slate-500 font-sans italic">
          💡 Click any packet, ACK, loss marker, or event row to inspect why it happened.
        </span>
      </div>
    </div>
  );
}
