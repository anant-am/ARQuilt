// Header.tsx — Top application navigation bar

import React from 'react';
import { Network, BookOpen, RotateCcw } from 'lucide-react';
import { useAppState } from '../store/store';

interface HeaderProps {
  onOpenDocs?: () => void;
}

export function Header({ onOpenDocs }: HeaderProps) {
  const { state, dispatch } = useAppState();

  const handleReset = () => {
    if (window.confirm('Reset the current simulation and start over?')) {
      dispatch({ type: 'RESET' });
    }
  };

  return (
    <header className="bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-6 py-3.5 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <Network className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-lg text-white tracking-tight flex items-center gap-1.5">
                ARQuilt
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  ARQ Simulation Lab
                </span>
              </h1>
            </div>
            <p className="text-xs text-slate-400">
              Interactive Network Protocol Visualizer & File Quilt Reassembly
            </p>
          </div>
        </div>

        {/* Current State Badges */}
        <div className="hidden md:flex items-center gap-3">
          {state.scenario && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700/60 text-xs">
              <span className="text-slate-400">Scenario:</span>
              <span className="text-indigo-300 font-semibold">{state.scenario.name}</span>
            </div>
          )}

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700/60 text-xs">
            <span className="text-slate-400">Protocol:</span>
            <span className="text-purple-300 font-semibold">{state.selectedMode}</span>
          </div>

          {state.fileInfo && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700/60 text-xs">
              <span className="text-slate-400">File:</span>
              <span className="text-emerald-300 font-semibold truncate max-w-[140px]">
                {state.fileInfo.filename} ({state.fileInfo.frame_count} frames)
              </span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {onOpenDocs && (
            <button
              onClick={onOpenDocs}
              className="btn btn-ghost text-xs px-3 py-1.5"
              title="Documentation & Theory Guide"
            >
              <BookOpen className="w-4 h-4 text-slate-300" />
              <span className="hidden sm:inline">Protocol Guide</span>
            </button>
          )}

          <button
            onClick={handleReset}
            className="btn btn-ghost text-xs px-3 py-1.5 text-slate-300 hover:text-white"
            title="Reset Everything"
          >
            <RotateCcw className="w-4 h-4" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      </div>
    </header>
  );
}
