// WhyThisHappenedInspector.tsx — Compact Event Explanation & Protocol Decision Inspector

import React from 'react';
import { HelpCircle, X, ShieldAlert, Clock, ArrowRight, Activity, CheckCircle2, AlertOctagon } from 'lucide-react';
import type { SimEvent } from '../types';
import { useAppState } from '../store/store';

interface Props {
  event: SimEvent;
  onClose: () => void;
}

export function WhyThisHappenedInspector({ event, onClose }: Props) {
  const { state } = useAppState();
  const arq = state.scenario?.arq;
  const channel = state.scenario?.channel;

  // Determine what would happen if retries are exhausted
  const maxRetries = arq?.max_retries ?? 5;
  const isLossOrTimeout = 
    event.etype === 'DATA_LOST' || 
    event.etype === 'ACK_LOST' || 
    event.etype === 'DATA_CORRUPTED' || 
    event.etype === 'TIMEOUT' ||
    event.etype === 'RETRANSMIT';

  const retriesRemaining = Math.max(0, maxRetries - event.attempt);

  function getFailureTypeDescription(): string {
    if (event.failure_type === 'DATA_LOSS' || event.etype === 'DATA_LOST') {
      return `Transmission attempt #${event.attempt} was dropped in transit by the virtual channel loss model. The frame never reached the receiver buffer.`;
    }
    if (event.failure_type === 'ACK_LOSS' || event.etype === 'ACK_LOST') {
      return `The receiver accepted frame #${event.abs_seq ?? event.seq_no}, but the returning ACK #${event.ack_no ?? event.seq_no} was dropped in transit. The sender remains unaware of delivery.`;
    }
    if (event.failure_type === 'CRC_CORRUPTION' || event.etype === 'DATA_CORRUPTED') {
      return `The frame reached the receiver, but bit corruption was detected via CRC/checksum. The corrupted payload was rejected and discarded.`;
    }
    if (event.etype === 'TIMEOUT') {
      return `The sender's retransmission timer expired before receiving an acknowledgment for outstanding frame #${event.abs_seq ?? event.seq_no}.`;
    }
    if (event.etype === 'RETRANSMIT') {
      return `The sender initiated retransmission attempt #${event.attempt} following an unacknowledged timeout or missing ACK.`;
    }
    if (event.etype === 'DATA_BUFFERED') {
      return `The frame arrived out of order. Selective Repeat buffered it in the receiver window awaiting earlier missing sequence numbers.`;
    }
    if (event.etype === 'DATA_DELIVERED') {
      return `Frame #${event.abs_seq ?? event.seq_no} arrived intact, passed checksum verification, and was delivered to the receiver stream.`;
    }
    if (event.etype === 'ACK_DELIVERED') {
      return `ACK #${event.ack_no ?? event.seq_no} arrived at sender. Sender window base advanced, confirming successful delivery.`;
    }
    return event.explanation || 'Protocol event recorded during simulation.';
  }

  function getNextActionDescription(): string {
    if (event.etype === 'DATA_LOST') {
      return `The sender is waiting for its retransmission timer to expire (${(arq?.timeout_us ?? 50000) / 1000}ms). If no ACK arrives, attempt #${event.attempt + 1} will be launched.`;
    }
    if (event.etype === 'ACK_LOST') {
      return `Because the ACK was lost, the sender's timer will expire. The sender will retransmit frame #${event.abs_seq ?? event.seq_no}. The receiver will recognize the duplicate and re-send the ACK without double-delivering data.`;
    }
    if (event.etype === 'DATA_CORRUPTED') {
      return `Receiver discarded corrupted data. Sender will timeout and retransmit.`;
    }
    if (event.etype === 'TIMEOUT') {
      if (retriesRemaining > 0) {
        return `Sender retransmits frame (attempt #${event.attempt + 1}). Retries remaining: ${retriesRemaining} / ${maxRetries}.`;
      }
      return `Retry limit (${maxRetries}) exhausted! Transfer will abort with TRANSFER_FAILED status.`;
    }
    if (event.etype === 'RETRANSMIT') {
      return `Frame is in flight. Sender restarts timeout timer and awaits acknowledgment.`;
    }
    if (event.etype === 'DATA_BUFFERED') {
      return `Receiver awaits missing prior frames before reassembling and passing data to the application layer.`;
    }
    return 'Simulation engine advances to the next scheduled discrete event.';
  }

  return (
    <div className="bg-slate-900/95 border border-indigo-500/40 rounded-xl p-4 shadow-xl backdrop-blur-md flex flex-col gap-3 text-xs text-slate-200 animate-in fade-in zoom-in-95 duration-150">
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-indigo-400" />
          <span className="font-bold text-sm text-white">Why Did This Happen?</span>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800/60">
            Event #{event.event_id}
          </span>
          <span className="text-slate-400 font-mono text-[11px]">
            @ {(event.vtime_us / 1000).toFixed(2)}ms
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title="Close explanation"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Grid of Key Diagnostic Fields */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 font-mono text-[11px]">
        <div>
          <span className="text-slate-500 block text-[10px] uppercase font-sans">Concerned Entity</span>
          <span className="text-indigo-300 font-semibold">
            {event.abs_seq !== undefined ? `Frame #${event.abs_seq}` : event.ack_no !== undefined ? `ACK #${event.ack_no}` : event.etype}
          </span>
          {event.seq_no !== undefined && <span className="text-slate-400 text-[10px] ml-1">(seq={event.seq_no})</span>}
        </div>
        <div>
          <span className="text-slate-500 block text-[10px] uppercase font-sans">Attempt #</span>
          <span className={event.attempt > 1 ? 'text-amber-400 font-bold' : 'text-slate-200'}>
            Try #{event.attempt} / Max {maxRetries}
          </span>
        </div>
        <div>
          <span className="text-slate-500 block text-[10px] uppercase font-sans">Event Type</span>
          <span className="font-semibold text-white">{event.etype}</span>
        </div>
        <div>
          <span className="text-slate-500 block text-[10px] uppercase font-sans">Direction</span>
          <span className="text-slate-300">{event.src} → {event.dst}</span>
        </div>
      </div>

      {/* Primary Explanation Box */}
      <div className="flex gap-2.5 p-3 rounded-lg bg-slate-950/90 border border-slate-800">
        {isLossOrTimeout ? (
          <ShieldAlert className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        ) : (
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-white text-[12px]">Diagnostic Analysis</span>
          <p className="text-slate-300 leading-relaxed font-sans">{getFailureTypeDescription()}</p>
        </div>
      </div>

      {/* State Transitions & Protocol Rule */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
        {/* Protocol Rule */}
        <div className="bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/60 flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-slate-400 font-semibold text-[10px] uppercase">
            <Activity className="w-3.5 h-3.5 text-indigo-400" />
            <span>Protocol Rule Applied</span>
          </div>
          <span className="text-slate-200 font-sans">
            {event.protocol_rule || `${state.selectedMode} ARQ state machine transition rule`}
          </span>
        </div>

        {/* Sender / Receiver States */}
        <div className="bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/60 flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-slate-400 font-semibold text-[10px] uppercase">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Node States</span>
          </div>
          <div className="text-slate-300 font-mono text-[10px] flex flex-col gap-0.5">
            <span>TX: <strong className="text-indigo-300">{event.sender_state || 'ACTIVE'}</strong></span>
            <span>RX: <strong className="text-emerald-300">{event.receiver_state || 'IDLE'}</strong></span>
          </div>
        </div>
      </div>

      {/* Next Protocol Step */}
      <div className="p-2.5 rounded-lg bg-indigo-950/30 border border-indigo-800/40 flex items-start gap-2">
        <ArrowRight className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-indigo-200 text-[11px]">What Happens Next</span>
          <p className="text-slate-300 font-sans leading-normal">{getNextActionDescription()}</p>
        </div>
      </div>

      {/* Retry Exhaustion Guard */}
      {isLossOrTimeout && (
        <div className="flex items-center justify-between p-2 rounded-lg bg-amber-950/20 border border-amber-800/30 text-[10px] text-amber-300">
          <div className="flex items-center gap-1.5">
            <AlertOctagon className="w-3.5 h-3.5 text-amber-400" />
            <span>
              Retry Budget: <strong>{retriesRemaining} retries left</strong> out of {maxRetries} max limit.
            </span>
          </div>
          <span className="text-slate-400 font-sans">
            {retriesRemaining === 0 ? 'Terminal failure triggered upon timeout!' : 'Guarantees termination.'}
          </span>
        </div>
      )}

      {/* Configured Channel Environment Grounding */}
      {channel && (
        <div className="text-[10px] text-slate-500 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-800/60 pt-2 font-mono">
          <span>Configured Loss: Data {(channel.data_loss_prob * 100).toFixed(0)}% / ACK {(channel.ack_loss_prob * 100).toFixed(0)}%</span>
          <span>Corruption: {(channel.data_corrupt_prob * 100).toFixed(0)}%</span>
          <span>Delay: {(channel.propagation_delay_us / 1000).toFixed(0)}ms</span>
          <span>Timeout: {(arq?.timeout_us ?? 50000) / 1000}ms</span>
        </div>
      )}
    </div>
  );
}
