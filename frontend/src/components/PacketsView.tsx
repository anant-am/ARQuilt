// PacketsView.tsx — Packet breakdown and chunking inspection (Phase 2)

import React from 'react';
import { Package, Hash, ArrowRight, Layers, FileText, CheckCircle2 } from 'lucide-react';
import { useAppState } from '../store/store';
import type { FrameInfo } from '../types';

interface PacketsViewProps {
  onSelectFrame?: (frame: FrameInfo) => void;
  onProceed: () => void;
}

export function PacketsView({ onSelectFrame, onProceed }: PacketsViewProps) {
  const { state } = useAppState();
  const fileInfo = state.fileInfo;

  if (!fileInfo) return null;

  return (
    <div className="card p-6 bg-slate-900 border-slate-800 flex flex-col gap-6 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-indigo-500/20 text-indigo-400">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              File Packetization & Frame Assembly
              <span className="badge badge-blue text-xs font-semibold">
                {fileInfo.frame_count} FRAMES GENERATED
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              The application layer file has been fragmented into transport PDUs with CRC-16 checksums
            </p>
          </div>
        </div>

        <button
          onClick={onProceed}
          className="btn btn-primary bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/20"
        >
          <span>Select ARQ Protocol</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* File summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex flex-col gap-1">
          <span className="text-slate-400">Filename:</span>
          <span className="text-slate-200 font-semibold truncate">{fileInfo.filename}</span>
        </div>
        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex flex-col gap-1">
          <span className="text-slate-400">Total Size:</span>
          <span className="text-slate-200 font-semibold font-mono">
            {fileInfo.size_bytes.toLocaleString()} bytes
          </span>
        </div>
        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex flex-col gap-1">
          <span className="text-slate-400">Payload per Frame:</span>
          <span className="text-indigo-400 font-semibold font-mono">
            {fileInfo.payload_size} bytes
          </span>
        </div>
        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex flex-col gap-1">
          <span className="text-slate-400">Total Frames:</span>
          <span className="text-emerald-400 font-semibold font-mono">
            {fileInfo.frame_count} frames
          </span>
        </div>
      </div>

      {/* SHA-256 Hash */}
      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center justify-between text-xs font-mono">
        <span className="text-slate-400 font-sans flex items-center gap-1.5">
          <Hash className="w-3.5 h-3.5 text-indigo-400" />
          Pre-Transmission SHA-256:
        </span>
        <span className="text-indigo-300 font-semibold select-all break-all">{fileInfo.sha256}</span>
      </div>

      {/* Frame Tiles Grid */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            Click Any Frame to Inspect Header Fields
          </span>
          <span className="text-xs text-slate-500">
            Sequence window mod 8 (0..7)
          </span>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-8 md:grid-cols-12 gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800 max-h-64 overflow-y-auto">
          {fileInfo.frames.map((frame) => (
            <button
              key={frame.abs_seq}
              onClick={() => onSelectFrame?.(frame)}
              className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-500 hover:bg-slate-800 transition-all text-center flex flex-col items-center gap-1 cursor-pointer"
            >
              <span className="text-[10px] text-slate-400 font-sans">Frame</span>
              <span className="font-bold text-slate-100 font-mono text-sm">#{frame.abs_seq}</span>
              <span className="text-[10px] text-indigo-300 font-mono">seq={frame.seq_no}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
