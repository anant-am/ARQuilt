// PacketInspector.tsx — Detailed inspector for inspecting individual frame and packet bytes

import React from 'react';
import { X, Binary, ShieldCheck, Hash, Cpu, ArrowRight } from 'lucide-react';
import type { FrameInfo } from '../types';

interface PacketInspectorProps {
  frame: FrameInfo | null;
  status?: string;
  onClose: () => void;
}

export function PacketInspector({ frame, status, onClose }: PacketInspectorProps) {
  if (!frame) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="card max-w-lg w-full bg-slate-900 border-slate-700 shadow-2xl p-6 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-indigo-600/20 text-indigo-400">
              <Binary className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-100 text-sm">
                Packet Inspector — Frame #{frame.abs_seq}
              </h3>
              <p className="text-xs text-slate-400">
                Layer 2 Data Link & Layer 4 Transport PDU Structure
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Header Anatomy */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Frame Header Fields (16-byte protocol encapsulation)
          </span>
          <div className="grid grid-cols-4 gap-2 text-center text-xs font-mono">
            <div className="bg-slate-950 p-2 rounded border border-indigo-500/40">
              <div className="text-[10px] text-indigo-400 font-sans">SEQ_NO (3b)</div>
              <div className="font-bold text-slate-100 mt-1">{frame.seq_no}</div>
            </div>
            <div className="bg-slate-950 p-2 rounded border border-purple-500/40">
              <div className="text-[10px] text-purple-400 font-sans">ABS_SEQ</div>
              <div className="font-bold text-slate-100 mt-1">{frame.abs_seq}</div>
            </div>
            <div className="bg-slate-950 p-2 rounded border border-cyan-500/40">
              <div className="text-[10px] text-cyan-400 font-sans">PAYLOAD</div>
              <div className="font-bold text-slate-100 mt-1">{frame.payload_bytes} B</div>
            </div>
            <div className="bg-slate-950 p-2 rounded border border-emerald-500/40">
              <div className="text-[10px] text-emerald-400 font-sans">CHECKSUM</div>
              <div className="font-bold text-slate-100 mt-1">{frame.checksum}</div>
            </div>
          </div>
        </div>

        {/* Checksum & Status Info */}
        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Integrity CRC Checksum:
            </span>
            <span className="font-mono text-emerald-400 font-semibold">{frame.checksum}</span>
          </div>
          {status && (
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Current Simulation Status:</span>
              <span className="badge badge-blue capitalize">{status}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="btn btn-ghost text-xs">
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
}
