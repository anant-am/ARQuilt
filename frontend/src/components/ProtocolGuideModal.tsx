// ProtocolGuideModal.tsx — Comprehensive network protocol theory and educational reference modal

import React from 'react';
import { X, BookOpen, Layers, CheckCircle2, ShieldAlert, Cpu, Sparkles } from 'lucide-react';

interface ProtocolGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProtocolGuideModal({ isOpen, onClose }: ProtocolGuideModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="card max-w-3xl w-full bg-slate-900 border-slate-700 shadow-2xl p-6 flex flex-col gap-6 my-8 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-600/20 text-indigo-400">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100">
                ARQ Protocol Theory & Demonstration Guide
              </h2>
              <p className="text-xs text-slate-400">
                Automatic Repeat reQuest error-control principles in modern computer networking
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

        {/* Protocol Comparison Table */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-indigo-400" />
            1. Protocol Architecture Comparison
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border border-slate-800 rounded-lg overflow-hidden">
              <thead className="bg-slate-950 text-slate-300 font-semibold border-b border-slate-800">
                <tr>
                  <th className="p-2.5">Feature</th>
                  <th className="p-2.5 text-blue-400">Stop-and-Wait (SW)</th>
                  <th className="p-2.5 text-purple-400">Go-Back-N (GBN)</th>
                  <th className="p-2.5 text-emerald-400">Selective Repeat (SR)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans text-slate-300">
                <tr>
                  <td className="p-2.5 font-medium text-slate-400">Sender Window (Ws)</td>
                  <td className="p-2.5">1</td>
                  <td className="p-2.5">W &gt; 1 (e.g. 4)</td>
                  <td className="p-2.5">W &gt; 1 (e.g. 4)</td>
                </tr>
                <tr>
                  <td className="p-2.5 font-medium text-slate-400">Receiver Window (Wr)</td>
                  <td className="p-2.5">1</td>
                  <td className="p-2.5">1 (in-order only)</td>
                  <td className="p-2.5">W &gt; 1 (buffers out-of-order)</td>
                </tr>
                <tr>
                  <td className="p-2.5 font-medium text-slate-400">Max Sequence Number (Bits)</td>
                  <td className="p-2.5">Ws + Wr = 2 (1 bit: 0,1)</td>
                  <td className="p-2.5">2^m &gt; Ws (e.g. 3 bits: 0..7)</td>
                  <td className="p-2.5">Ws + Wr &le; 2^m (Ws &le; 2^(m-1))</td>
                </tr>
                <tr>
                  <td className="p-2.5 font-medium text-slate-400">ACK Type</td>
                  <td className="p-2.5">Individual ACK</td>
                  <td className="p-2.5">Cumulative ACK</td>
                  <td className="p-2.5">Selective ACK (Individual)</td>
                </tr>
                <tr>
                  <td className="p-2.5 font-medium text-slate-400">On Loss / Timeout</td>
                  <td className="p-2.5">Retransmit 1 packet</td>
                  <td className="p-2.5">Retransmit entire window (N packets)</td>
                  <td className="p-2.5">Retransmit ONLY the missing packet</td>
                </tr>
                <tr>
                  <td className="p-2.5 font-medium text-slate-400">Buffer Overhead</td>
                  <td className="p-2.5">Minimal (1 frame)</td>
                  <td className="p-2.5">Sender buffer only</td>
                  <td className="p-2.5">Both Sender & Receiver buffers</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Key Concepts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-1.5">
            <h4 className="font-bold text-slate-200 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Bandwidth-Delay Product (BDP)
            </h4>
            <p className="text-slate-400 leading-relaxed">
              BDP = Bandwidth × RTT. In long-delay or high-bandwidth links, Stop-and-Wait wastes over 90% of capacity because the sender spends most of its time waiting for ACKs. Pipelined protocols (GBN and SR) fill the link pipe by keeping multiple packets in flight.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-1.5">
            <h4 className="font-bold text-slate-200 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              Sequence Number Wraparound
            </h4>
            <p className="text-slate-400 leading-relaxed">
              Finite sequence numbers wrap around modulo 2^m. In Selective Repeat, the sender window size cannot exceed half the sequence space (Ws ≤ 2^(m-1)); otherwise, the receiver cannot distinguish between a new packet and a duplicate from the previous cycle.
            </p>
          </div>
        </div>

        {/* Calibration & Selection Algorithm */}
        <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-700/50 text-xs flex flex-col gap-2">
          <h4 className="font-bold text-indigo-300 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            Automatic Protocol Selection Algorithm
          </h4>
          <p className="text-slate-300 leading-relaxed">
            ARQuilt runs a mini probe test on the active channel using 20 probe frames for each candidate protocol (SW, GBN, SR). It evaluates candidate performance across goodput, retransmission ratio, buffer pressure, and completion rate to compute an objective score:
          </p>
          <div className="p-2 rounded bg-slate-950/80 font-mono text-[11px] text-indigo-300 border border-slate-800">
            Score = 0.40 × (Goodput / Theoretical Max) + 0.35 × (1 - Retransmit Ratio) + 0.15 × (1 - Buffer Pressure) + 0.10 × Completion
          </div>
        </div>

        <div className="flex justify-end border-t border-slate-800 pt-3">
          <button onClick={onClose} className="btn btn-primary text-xs px-4 py-2">
            Got it, Back to Simulation
          </button>
        </div>
      </div>
    </div>
  );
}
