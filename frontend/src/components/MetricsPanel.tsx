// MetricsPanel.tsx — Live real-time network and protocol metrics

import React from 'react';
import { Send, CheckCheck, AlertOctagon, Flame, Cpu, Gauge, Clock, ShieldCheck } from 'lucide-react';
import { useAppState } from '../store/store';

export function MetricsPanel() {
  const { state } = useAppState();
  const events = state.events;
  const summary = state.summary;

  // Compute live metrics from events
  const originalFramesSent = summary?.frames_sent ?? events.filter(e => e.etype === 'DATA_SENT').length;
  const retransmitCount = summary?.retransmissions ?? events.filter(e => e.etype === 'RETRANSMIT').length;
  const totalWireAttempts = originalFramesSent + retransmitCount;
  const deliveredSet = new Set(events.filter(e => e.etype === 'DATA_DELIVERED' && e.abs_seq !== undefined).map(e => e.abs_seq));
  const deliveredCount = summary?.frames_delivered ?? deliveredSet.size;
  const lostCount = summary?.frames_lost ?? events.filter(e => e.etype === 'DATA_LOST' || e.etype === 'ACK_LOST').length;
  const corruptedCount = summary?.frames_corrupted ?? events.filter(e => e.etype === 'DATA_CORRUPTED' || e.etype === 'ACK_CORRUPTED').length;
  const acksReceived = summary?.acks_received ?? events.filter(e => e.etype === 'ACK_DELIVERED').length;

  const totalFrames = state.fileInfo?.frame_count || 1;
  const retxRate = totalWireAttempts > 0 ? ((retransmitCount / totalWireAttempts) * 100).toFixed(1) : '0.0';
  
  // Goodput calculation
  const goodputKbps = summary 
    ? (summary.goodput_bps / 1000).toFixed(1)
    : events.length > 0 && events[events.length - 1].vtime_us > 0
      ? (((deliveredCount * (state.fileInfo?.payload_size || 512) * 8) / (events[events.length - 1].vtime_us / 1000000)) / 1000).toFixed(1)
      : '0.0';

  const lastVTimeMs = events.length > 0 
    ? (events[events.length - 1].vtime_us / 1000).toFixed(1)
    : '0.0';

  // Last known window state
  const lastWinEvent = [...events].reverse().find(e => e.window_base !== undefined || e.window_size !== undefined);
  const winBase = lastWinEvent?.window_base ?? 0;
  const winSize = lastWinEvent?.window_size ?? (state.scenario?.arq.window_size ?? 1);

  return (
    <div className="card p-4 bg-slate-900 border-slate-800 flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <Gauge className="w-4 h-4 text-indigo-400" />
          Live Transmission Telemetry
        </h3>
        <span className="badge badge-blue text-[11px]">
          {state.selectedMode} Protocol
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Total Attempts on Wire */}
        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Attempts (Wire)</span>
            <Send className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="text-xl font-bold font-mono text-slate-100">{totalWireAttempts}</div>
          <div className="text-[11px] text-slate-400">{originalFramesSent} orig + {retransmitCount} retx</div>
        </div>

        {/* Unique Delivered */}
        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Delivered</span>
            <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold font-mono text-emerald-400">{deliveredCount}</div>
          <div className="text-[11px] text-slate-400">Target: {totalFrames} frames</div>
        </div>

        {/* Retransmissions */}
        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Retries</span>
            <Flame className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-xl font-bold font-mono text-amber-400">{retransmitCount}</div>
          <div className="text-[11px] text-slate-400">Rate: {retxRate}%</div>
        </div>

        {/* Losses & Corruptions */}
        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Loss / Corrupt</span>
            <AlertOctagon className="w-3.5 h-3.5 text-red-400" />
          </div>
          <div className="text-xl font-bold font-mono text-red-400">
            {lostCount} <span className="text-xs font-normal text-slate-400">/ {corruptedCount} err</span>
          </div>
          <div className="text-[11px] text-slate-400">Channel impairments</div>
        </div>

        {/* Goodput */}
        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Effective Goodput</span>
            <Gauge className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-xl font-bold font-mono text-cyan-400">
            {goodputKbps} <span className="text-xs font-normal text-slate-400">kbps</span>
          </div>
          <div className="text-[11px] text-slate-400">Net useful throughput</div>
        </div>

        {/* Virtual Elapsed Time */}
        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Sim Time</span>
            <Clock className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="text-xl font-bold font-mono text-purple-400">
            {lastVTimeMs} <span className="text-xs font-normal text-slate-400">ms</span>
          </div>
          <div className="text-[11px] text-slate-400">Network simulation clock</div>
        </div>

        {/* Sliding Window State */}
        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Sliding Window</span>
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="text-xl font-bold font-mono text-indigo-300">
            W={winSize}
          </div>
          <div className="text-[11px] text-slate-400">Base seq: {winBase}</div>
        </div>

        {/* ACKs Received */}
        <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>ACKs Received</span>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold font-mono text-emerald-300">{acksReceived}</div>
          <div className="text-[11px] text-slate-400">Feedback packets</div>
        </div>
      </div>
    </div>
  );
}
