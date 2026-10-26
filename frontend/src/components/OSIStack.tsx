// OSIStack.tsx — Interactive OSI / Internet protocol stack visualizer

import React from 'react';
import { Layers, ShieldCheck, Cpu, Network, Radio, Binary, FileText } from 'lucide-react';
import { useAppState } from '../store/store';
import type { EventType } from '../types';

interface LayerDef {
  num: number;
  name: string;
  pdu: string;
  icon: React.ReactNode;
  description: string;
  arquiltRole: string;
}

const LAYERS: LayerDef[] = [
  {
    num: 7,
    name: 'Application Layer',
    pdu: 'Data / File',
    icon: <FileText className="w-4 h-4 text-emerald-400" />,
    description: 'File upload, chunking, and final reconstructed SHA-256 verification.',
    arquiltRole: 'Source payload & byte-exact destination file reconstruction'
  },
  {
    num: 4,
    name: 'Transport Layer',
    pdu: 'Segment / ARQ',
    icon: <Cpu className="w-4 h-4 text-indigo-400" />,
    description: 'Reliable delivery, flow control, sequence numbering, timeout management, sliding windows.',
    arquiltRole: 'Stop-and-Wait / Go-Back-N / Selective Repeat state machine'
  },
  {
    num: 3,
    name: 'Network Layer',
    pdu: 'Packet',
    icon: <Network className="w-4 h-4 text-purple-400" />,
    description: 'Virtual IP addressing, routing hops (Sender → Router → Receiver).',
    arquiltRole: 'Two-hop store-and-forward routing in Scenario S09'
  },
  {
    num: 2,
    name: 'Data Link Layer',
    pdu: 'Frame',
    icon: <ShieldCheck className="w-4 h-4 text-cyan-400" />,
    description: 'Frame encapsulation, CRC-16 checksum verification, corrupt frame discard.',
    arquiltRole: 'Frame header encoding, CRC checksum calculation & error check'
  },
  {
    num: 1,
    name: 'Physical Layer',
    pdu: 'Bits / Signals',
    icon: <Radio className="w-4 h-4 text-amber-400" />,
    description: 'Channel bandwidth, propagation delay, bit errors, jitter, and packet loss.',
    arquiltRole: 'Channel model (Gilbert-Elliott burst loss, random bit flips, RTT)'
  },
];

function getActiveLayer(lastEvent?: EventType): number {
  if (!lastEvent) return 4;
  if (lastEvent === 'FILE_REASSEMBLED' || lastEvent === 'INTEGRITY_CHECK') return 7;
  if (lastEvent === 'TIMEOUT' || lastEvent === 'RETRANSMIT' || lastEvent === 'WINDOW_UPDATE') return 4;
  if (lastEvent === 'ROUTER_FORWARD') return 3;
  if (lastEvent === 'DATA_CORRUPTED' || lastEvent === 'ACK_CORRUPTED' || lastEvent === 'FRAME_ASSEMBLED') return 2;
  if (lastEvent === 'DATA_LOST' || lastEvent === 'ACK_LOST' || lastEvent === 'DATA_SENT' || lastEvent === 'ACK_SENT') return 1;
  return 4;
}

export function OSIStack() {
  const { state } = useAppState();
  const lastEvent = state.events[state.events.length - 1];
  const activeLayer = getActiveLayer(lastEvent?.etype);

  return (
    <div className="card p-4 bg-slate-900 border-slate-800 flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <Layers className="w-4 h-4 text-indigo-400" />
          Protocol Stack Encapsulation
        </h3>
        <span className="text-[11px] text-slate-500 font-mono">OSI & TCP/IP Model</span>
      </div>

      <div className="space-y-2">
        {LAYERS.map(layer => {
          const isActive = activeLayer === layer.num;
          return (
            <div
              key={layer.num}
              className={`p-2.5 rounded-lg border transition-all duration-300 flex items-start gap-3 ${
                isActive
                  ? 'bg-indigo-950/60 border-indigo-500/80 shadow-md shadow-indigo-500/10'
                  : 'bg-slate-950/40 border-slate-800/60 opacity-80'
              }`}
            >
              <div className={`p-2 rounded-lg mt-0.5 ${isActive ? 'bg-indigo-600/30 ring-1 ring-indigo-400' : 'bg-slate-900'}`}>
                {layer.icon}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-200">
                      Layer {layer.num}: {layer.name}
                    </span>
                    <span className="badge badge-slate text-[10px] font-mono">
                      {layer.pdu}
                    </span>
                  </div>
                  {isActive && (
                    <span className="badge badge-green text-[10px] animate-pulse">
                      ACTIVE PROCESSING
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-400 mt-1 line-clamp-1">
                  {layer.description}
                </p>

                <div className="text-[11px] text-indigo-300/80 font-mono mt-0.5">
                  → {layer.arquiltRole}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
