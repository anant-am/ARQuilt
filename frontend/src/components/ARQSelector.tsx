// ARQSelector.tsx — Protocol comparison with animated probe lanes and scoring

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, CheckCircle2, XCircle, AlertTriangle, Loader2, Trophy, Info } from 'lucide-react';
import { api } from '../api';
import { useAppState } from '../store/store';
import type { ARQMode, CandidateMetrics } from '../types';

const MODES: ARQMode[] = ['SW', 'GBN', 'SR'];
const MODE_COLORS: Record<ARQMode, string> = {
  SW: 'text-blue-400 border-blue-700/50 bg-blue-900/20',
  GBN: 'text-purple-400 border-purple-700/50 bg-purple-900/20',
  SR: 'text-emerald-400 border-emerald-700/50 bg-emerald-900/20',
  AUTO: 'text-slate-400 border-slate-700 bg-slate-900/20',
};
const MODE_LABEL: Record<ARQMode, string> = {
  SW: 'Stop-and-Wait',
  GBN: 'Go-Back-N',
  SR: 'Selective Repeat',
  AUTO: 'Auto',
};

function fmtDuration(us: number) {
  if (us < 1000) return `${us} µs`;
  if (us < 1_000_000) return `${(us / 1000).toFixed(1)} ms`;
  return `${(us / 1_000_000).toFixed(2)} s`;
}
function fmtKbps(bps: number) { return `${(bps / 1000).toFixed(1)} kbps`; }

function MetricRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-slate-800/60 last:border-0">
      <span className="text-slate-500 text-xs">{label}</span>
      <span className={`text-xs font-semibold ${highlight ? 'text-emerald-400' : 'text-slate-200'}`}>{value}</span>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-500">Score</span>
        <span className="text-slate-300 font-bold">{(score * 100).toFixed(1)}%</span>
      </div>
      <div className="progress-bar">
        <motion.div
          className="progress-fill bg-gradient-to-r from-indigo-600 to-purple-500"
          initial={{ width: 0 }}
          animate={{ width: `${score * 100}%` }}
          transition={{ duration: 0.8, delay: 0.2 }}
        />
      </div>
    </div>
  );
}

function CandidateCard({ m, selected, winner }: {
  m: CandidateMetrics; selected: boolean; winner: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={[
        'relative border rounded-xl p-4 transition-all',
        winner ? 'border-emerald-500 bg-emerald-950/20 shadow-lg shadow-emerald-900/30' :
        m.completed ? `border ${MODE_COLORS[m.mode]}` :
        'border-red-800/50 bg-red-950/10',
        selected && !winner ? 'ring-2 ring-indigo-500' : '',
      ].join(' ')}
    >
      {winner && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="badge-green text-xs px-3 py-1 flex items-center gap-1">
            <Trophy size={11} />RECOMMENDED
          </span>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <div>
          <p className={`text-sm font-bold ${MODE_COLORS[m.mode].split(' ')[0]}`}>{m.mode}</p>
          <p className="text-xs text-slate-500">{MODE_LABEL[m.mode]}</p>
        </div>
        {m.completed
          ? <CheckCircle2 size={18} className="text-emerald-400" />
          : <XCircle size={18} className="text-red-400" />}
      </div>

      {m.completed ? (
        <>
          <MetricRow label="Duration" value={fmtDuration(m.duration_us)} />
          <MetricRow label="Goodput" value={fmtKbps(m.goodput_bps)} highlight />
          <MetricRow label="Retransmit bytes" value={`${m.retransmitted_bytes}`} />
          <MetricRow label="Peak Rx buf" value={`${m.peak_rx_buffer}`} />
          <MetricRow label="Ctrl overhead" value={`${m.control_overhead_bytes} B`} />
          <ScoreBar score={m.score} />

          {m.score_breakdown && Object.keys(m.score_breakdown).length > 0 && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="mt-2 text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1"
            >
              <Info size={11} />
              {expanded ? 'Hide' : 'Show'} score breakdown
            </button>
          )}

          <AnimatePresence>
            {expanded && m.score_breakdown && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 bg-slate-900/60 rounded-lg p-2 space-y-1">
                  {Object.entries(m.score_breakdown).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs">
                      <span className="text-slate-500 capitalize">{k.replace(/_/g, ' ')}</span>
                      <span className="text-slate-300">{(v * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      ) : (
        <div className="text-xs text-red-400 bg-red-950/30 rounded-lg p-2">
          <XCircle size={12} className="inline mr-1" />
          {m.failure_reason ?? 'Probe did not complete'}
        </div>
      )}
    </motion.div>
  );
}

export function ARQSelector() {
  const { state, dispatch } = useAppState();
  const [running, setRunning] = useState(false);

  const runAutoSelect = async () => {
    if (!state.fileId || !state.scenarioId) return;
    setRunning(true);
    dispatch({ type: 'SET_ERROR', error: null });
    try {
      const result = await api.selectProtocol(state.fileId, state.scenarioId, 20);
      dispatch({ type: 'SET_SELECTION', result });
      dispatch({ type: 'SET_MODE', mode: result.selected });
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', error: String(e) });
    } finally {
      setRunning(false);
    }
  };

  const { selectionResult } = state;
  const ready = !!state.fileId && !!state.scenarioId;

  return (
    <div className="space-y-3">
      <div className="card-header">
        <Cpu size={15} className="text-amber-400" />
        <span className="text-sm font-semibold text-slate-200">ARQ Protocol</span>
      </div>

      <div className="px-4 pb-4 space-y-3">
        {/* Manual mode picker */}
        <div className="grid grid-cols-2 gap-1.5">
          {(['AUTO', ...MODES] as ARQMode[]).map(m => (
            <button
              key={m}
              onClick={() => dispatch({ type: 'SET_MODE', mode: m })}
              className={[
                'py-2 px-3 rounded-lg text-xs font-medium border transition-all',
                state.selectedMode === m
                  ? 'bg-indigo-700 border-indigo-500 text-white'
                  : 'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:border-slate-500',
              ].join(' ')}
            >
              {m === 'AUTO' ? '⚡ Auto Select' : m}
            </button>
          ))}
        </div>

        {/* Manual Mode Guideline */}
        {state.selectedMode !== 'AUTO' && (
          <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300">
            <span className="font-semibold text-white block mb-0.5">
              Manual Mode: {MODE_LABEL[state.selectedMode]} ({state.selectedMode})
            </span>
            {state.selectedMode === 'SW' && (
              <p className="text-slate-400">
                Transmits 1 frame at a time; halts for ACK. Window=1. Zero receiver buffer needed, but bandwidth is underutilized on high-delay links.
              </p>
            )}
            {state.selectedMode === 'GBN' && (
              <p className="text-slate-400">
                Pipelined window ({state.scenario?.arq.window_size ?? 4} frames). Single timer at base. On timeout, retransmits all unacked frames from window base. Rx buffer = 1.
              </p>
            )}
            {state.selectedMode === 'SR' && (
              <p className="text-slate-400">
                Pipelined windows at both TX & RX. Independent timer per frame. Retransmits only unacked frames. Requires receiver buffering for out-of-order frames.
              </p>
            )}
          </div>
        )}

        {/* Run auto-select */}
        {state.selectedMode === 'AUTO' && (
          <>
            <button
              className="btn-primary w-full justify-center"
              onClick={runAutoSelect}
              disabled={!ready || running}
            >
              {running
                ? <><Loader2 size={14} className="animate-spin" />Running 20-frame probe…</>
                : <><Cpu size={14} />Compare & Auto-Select Protocol</>}
            </button>

            {/* Scoring Methodology Card */}
            <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800 text-[10px] text-slate-400 space-y-1">
              <span className="font-semibold text-slate-300 block">Evaluation Scoring Weights:</span>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[9.5px]">
                <span>• Goodput: <strong className="text-emerald-400">40%</strong></span>
                <span>• Retransmit: <strong className="text-amber-400">35%</strong></span>
                <span>• Buffer Usage: <strong className="text-sky-400">15%</strong></span>
                <span>• Completion: <strong className="text-indigo-400">10%</strong></span>
              </div>
              <p className="text-slate-500 font-sans italic pt-0.5">
                Evaluates SW, GBN, and SR in a simulated calibration workload under current scenario conditions.
              </p>
            </div>
          </>
        )}

        {!ready && (
          <p className="text-xs text-slate-500 text-center">
            Select a file and scenario first
          </p>
        )}

        {/* Candidate results */}
        <AnimatePresence>
          {selectionResult && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="space-y-3"
            >
              <div className="text-[10px] text-slate-400 bg-indigo-950/30 border border-indigo-900/40 rounded-lg p-2 font-mono">
                📌 <strong>Calibration Probe:</strong> Candidate scores reflect a 20-frame probe under seed #{state.scenario?.data_seed ?? 42}.
              </div>

              {selectionResult.is_best_effort && (
                <div className="flex items-start gap-2 bg-amber-950/40 border border-amber-700/40 rounded-lg p-3">
                  <AlertTriangle size={13} className="text-amber-400 mt-0.5" />
                  <p className="text-xs text-amber-300">
                    No protocol completed without warnings. Showing best-effort selection.
                  </p>
                </div>
              )}

              {selectionResult.candidates.map(m => (
                <CandidateCard
                  key={m.mode}
                  m={m}
                  selected={state.selectedMode === m.mode}
                  winner={m.mode === selectionResult.selected}
                />
              ))}

              <div className="bg-slate-800/60 border border-slate-700/40 rounded-xl p-3">
                <p className="text-xs text-slate-400 leading-relaxed">
                  {selectionResult.explanation}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
