// ControlBar.tsx — Controls for simulation execution, speed, pause, step, and transfer progress

import React from 'react';
import { Play, Pause, StepForward, RotateCcw, FastForward, Activity, CheckCircle2 } from 'lucide-react';
import { useAppState } from '../store/store';
import { api } from '../api';

interface ControlBarProps {
  onStartTransfer: () => void;
}

export function ControlBar({ onStartTransfer }: ControlBarProps) {
  const { state, dispatch } = useAppState();

  const handlePause = async () => {
    if (!state.sessionId) return;
    try {
      await api.pauseSim(state.sessionId);
      dispatch({ type: 'SET_PAUSED', paused: true });
    } catch (e) {
      console.error(e);
    }
  };

  const handleResume = async () => {
    if (!state.sessionId) return;
    try {
      await api.resumeSim(state.sessionId);
      dispatch({ type: 'SET_PAUSED', paused: false });
    } catch (e) {
      console.error(e);
    }
  };

  const handleStep = async () => {
    if (!state.sessionId) return;
    try {
      await api.stepSim(state.sessionId);
    } catch (e) {
      console.error(e);
    }
  };

  const totalFrames = state.fileInfo?.frame_count || 0;
  // Calculate delivered frames from events
  const deliveredAbsSeqs = new Set(
    state.events
      .filter(e => e.etype === 'DATA_DELIVERED' && e.abs_seq !== undefined)
      .map(e => e.abs_seq)
  );
  const deliveredCount = deliveredAbsSeqs.size;
  const progressPct = totalFrames > 0 ? Math.min(100, Math.round((deliveredCount / totalFrames) * 100)) : 0;

  const handleCancel = async () => {
    if (!state.sessionId) return;
    try {
      await api.cancelSim(state.sessionId);
      dispatch({ type: 'SET_RUNNING', running: false });
    } catch (e) {
      console.error(e);
    }
  };

  const handleReset = () => {
    dispatch({ type: 'RESET' });
  };

  return (
    <div className="card p-3 flex flex-wrap items-center justify-between gap-4 bg-slate-900 border-slate-800">
      {/* Left: Action Buttons */}
      <div className="flex items-center gap-2">
        {!state.isRunning && state.phase === 'TRANSFER' && !state.summary && (
          <button
            onClick={onStartTransfer}
            className="btn btn-primary bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-lg shadow-emerald-500/20"
          >
            <Play className="w-4 h-4 fill-white" />
            Start Simulation
          </button>
        )}

        {state.isRunning && (
          <>
            {state.isPaused ? (
              <button
                onClick={handleResume}
                className="btn btn-primary bg-indigo-600 hover:bg-indigo-500 text-white"
                title="Resume simulation"
              >
                <Play className="w-4 h-4 fill-white" />
                Resume
              </button>
            ) : (
              <button
                onClick={handlePause}
                className="btn btn-ghost border border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                title="Pause simulation"
              >
                <Pause className="w-4 h-4" />
                Pause
              </button>
            )}

            <button
              onClick={handleStep}
              disabled={!state.isPaused}
              className="btn btn-ghost disabled:opacity-40"
              title="Step forward one event (when paused)"
            >
              <StepForward className="w-4 h-4" />
              Step
            </button>

            <button
              onClick={handleCancel}
              className="btn btn-ghost border border-red-500/40 text-red-300 hover:bg-red-500/10 text-xs py-1.5"
              title="Cancel current simulation"
            >
              Cancel
            </button>
          </>
        )}

        {/* Reset button always available once events exist */}
        {(state.events.length > 0 || state.summary) && (
          <button
            onClick={handleReset}
            className="btn btn-ghost border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs py-1.5 flex items-center gap-1"
            title="Clean reset without refreshing the page"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        )}

        {state.summary && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-700/50 text-emerald-300 text-sm font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Transfer Complete
          </div>
        )}
      </div>

      {/* Center: Live Progress Bar */}
      {state.fileInfo && (
        <div className="flex-1 min-w-[200px] max-w-md flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1.5 font-medium">
              <Activity className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
              Transfer Progress
            </span>
            <span className="text-slate-200 font-mono font-semibold">
              {deliveredCount} / {totalFrames} frames ({progressPct}%)
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden border border-slate-700/50">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Right: Simulation Speed */}
      <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800">
        <FastForward className="w-3.5 h-3.5 text-slate-400 mr-1" />
        <span className="text-xs text-slate-400 font-medium">Speed:</span>
        {[0.5, 1, 2, 4].map((spd) => (
          <button
            key={spd}
            onClick={() => dispatch({ type: 'SET_SPEED', speed: spd })}
            className={`px-2 py-0.5 text-xs font-semibold rounded transition-colors ${
              state.speed === spd
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {spd}x
          </button>
        ))}
      </div>
    </div>
  );
}
