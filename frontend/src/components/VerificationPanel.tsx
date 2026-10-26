// VerificationPanel.tsx — File Reassembly Quilt, SHA-256 verification, and report download

import React, { useState } from 'react';
import { ShieldCheck, Download, CheckCircle2, XCircle, FileCheck, Layers, Hash, Sparkles } from 'lucide-react';
import { useAppState } from '../store/store';
import { api } from '../api';
import type { FrameInfo } from '../types';

interface VerificationPanelProps {
  onSelectFrame?: (frame: FrameInfo, status: string) => void;
}

export function VerificationPanel({ onSelectFrame }: VerificationPanelProps) {
  const { state } = useAppState();
  const summary = state.summary;
  const fileInfo = state.fileInfo;
  const [downloading, setDownloading] = useState(false);

  if (!fileInfo) return null;

  // Build a status map for each frame based on events
  const frameStatusMap = new Map<number, { status: 'delivered' | 'retransmitted' | 'pending' | 'failed'; attempts: number }>();
  
  for (let i = 0; i < fileInfo.frame_count; i++) {
    frameStatusMap.set(i, { status: 'pending', attempts: 0 });
  }

  state.events.forEach(e => {
    if (e.abs_seq !== undefined && frameStatusMap.has(e.abs_seq)) {
      const cur = frameStatusMap.get(e.abs_seq)!;
      cur.attempts = Math.max(cur.attempts, e.attempt);
      if (e.etype === 'DATA_DELIVERED') {
        cur.status = cur.attempts > 1 ? 'retransmitted' : 'delivered';
      }
    }
  });

  const isComplete = summary !== null;
  const integrityOk = summary?.integrity_ok ?? false;
  const isFailed = summary?.status === 'FAILED';

  const handleExportJson = async () => {
    if (!state.sessionId) return;
    try {
      setDownloading(true);
      const report = await api.exportReport(state.sessionId);
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `arquilt_report_${state.sessionId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export report', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="card p-6 bg-slate-900 border-slate-800 flex flex-col gap-6 shadow-xl">
      {/* Title & Status */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className={`p-3 rounded-xl ${integrityOk ? 'bg-emerald-500/20 text-emerald-400' : isFailed ? 'bg-red-500/20 text-red-400' : 'bg-indigo-500/20 text-indigo-400'}`}>
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              File Quilt Reassembly & Integrity
              {integrityOk && (
                <span className="badge badge-green text-xs font-semibold">
                  100% BYTE PERFECT
                </span>
              )}
              {isFailed && (
                <span className="badge badge-red text-xs font-semibold">
                  TRANSFER FAILED
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-400">
              Visual frame reconstruction, cryptographic hash verification, and performance summary
            </p>
          </div>
        </div>

        {isComplete && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportJson}
              disabled={downloading}
              className="btn btn-primary bg-indigo-600 hover:bg-indigo-500 text-xs px-3 py-2 flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              {downloading ? 'Exporting...' : 'Export JSON Report'}
            </button>
          </div>
        )}
      </div>

      {/* SHA-256 Comparison Card */}
      <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800/80 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Hash className="w-3.5 h-3.5 text-indigo-400" />
            Cryptographic SHA-256 Verification
          </span>
          {isComplete && (
            <div className="flex items-center gap-1.5">
              {integrityOk ? (
                <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> Hashes Match Exactly
                </span>
              ) : (
                <span className="text-xs font-semibold text-red-400 flex items-center gap-1">
                  <XCircle className="w-4 h-4" /> Verification Incomplete / Failed
                </span>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
          <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-800">
            <div className="text-slate-400 text-[11px] font-sans mb-1">Source File SHA-256:</div>
            <div className="text-indigo-300 break-all select-all font-semibold">
              {fileInfo.sha256}
            </div>
          </div>

          <div className={`p-3 rounded-lg border ${integrityOk ? 'bg-emerald-950/30 border-emerald-800/60' : 'bg-slate-900/90 border-slate-800'}`}>
            <div className="text-slate-400 text-[11px] font-sans mb-1">Reconstructed File SHA-256:</div>
            <div className={`break-all select-all font-semibold ${integrityOk ? 'text-emerald-300' : 'text-slate-400'}`}>
              {summary?.received_sha256 || (isComplete ? 'None (Incomplete transfer)' : 'Awaiting transfer completion...')}
            </div>
          </div>
        </div>
      </div>

      {/* Reassembly Quilt Grid */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            Frame Reassembly Quilt Grid ({fileInfo.frame_count} Tiles)
          </h3>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-emerald-500 inline-block" /> Delivered First Try
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-amber-500 inline-block" /> Retransmitted
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-slate-800 border border-slate-700 inline-block" /> Pending
            </span>
          </div>
        </div>

        <div className="grid grid-cols-6 sm:grid-cols-10 md:grid-cols-12 lg:grid-cols-16 gap-1.5 p-3 rounded-xl bg-slate-950/80 border border-slate-800 max-h-56 overflow-y-auto">
          {fileInfo.frames.map((frame) => {
            const info = frameStatusMap.get(frame.abs_seq) || { status: 'pending', attempts: 0 };
            let tileBg = 'bg-slate-800/60 border-slate-700/60 text-slate-500';
            if (info.status === 'delivered') tileBg = 'bg-emerald-600/30 border-emerald-500/60 text-emerald-300';
            if (info.status === 'retransmitted') tileBg = 'bg-amber-600/30 border-amber-500/60 text-amber-300';

            return (
              <button
                key={frame.abs_seq}
                onClick={() => onSelectFrame?.(frame, info.status)}
                className={`p-2 rounded-lg border text-center font-mono text-xs font-semibold transition-all hover:scale-105 cursor-pointer ${tileBg}`}
                title={`Frame #${frame.abs_seq} (seq=${frame.seq_no}) — Attempts: ${info.attempts || 1}`}
              >
                #{frame.abs_seq}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
