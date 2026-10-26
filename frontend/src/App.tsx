// App.tsx — ARQuilt Interactive ARQ Simulation Lab Master Application

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AppProvider, useAppState } from './store/store';
import { Header } from './components/Header';
import { PhaseIndicator } from './components/PhaseIndicator';
import { FilePanel } from './components/FilePanel';
import { ScenarioPanel } from './components/ScenarioPanel';
import { PacketsView } from './components/PacketsView';
import { ARQSelector } from './components/ARQSelector';
import { NetworkView } from './components/NetworkView';
import { ControlBar } from './components/ControlBar';
import { MetricsPanel } from './components/MetricsPanel';
import { EventLog } from './components/EventLog';
import { OSIStack } from './components/OSIStack';
import { VerificationPanel } from './components/VerificationPanel';
import { PacketInspector } from './components/PacketInspector';
import { ProtocolGuideModal } from './components/ProtocolGuideModal';
import { WhyThisHappenedInspector } from './components/WhyThisHappenedInspector';
import { api, openSimSocket, type SimSocketController } from './api';
import type { FrameInfo, SimEvent, TransferSummary, AppPhase } from './types';
import { ArrowRight, Play, CheckCircle2, RotateCcw, AlertTriangle, Layers, Radio, RefreshCw } from 'lucide-react';

function ARQuiltMain() {
  const { state, dispatch } = useAppState();
  const [showDocs, setShowDocs] = useState(false);
  const [inspectedFrame, setInspectedFrame] = useState<{ frame: FrameInfo; status?: string } | null>(null);
  const [connStatus, setConnStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>('connected');
  const wsRef = useRef<SimSocketController | null>(null);

  // Auto-load scenarios on startup
  useEffect(() => {
    api.scenarios()
      .then(scenarios => {
        dispatch({ type: 'SET_SCENARIOS', scenarios });
        if (scenarios.length > 0 && !state.scenarioId) {
          dispatch({ type: 'SET_SCENARIO', scenario: scenarios[0] });
        }
      })
      .catch(console.error);
  }, [dispatch]);

  // Synchronize playback speed with backend
  useEffect(() => {
    if (wsRef.current) {
      wsRef.current.sendSpeed(state.speed);
    }
  }, [state.speed]);

  // Handle Starting a Transfer Simulation
  const handleStartTransfer = useCallback(async () => {
    if (!state.fileId || !state.scenarioId) {
      dispatch({ type: 'SET_ERROR', error: 'Please select both a file and a network scenario first.' });
      return;
    }

    try {
      dispatch({ type: 'SET_RUNNING', running: true });
      dispatch({ type: 'SET_PAUSED', paused: false });
      dispatch({ type: 'SET_ERROR', error: null });

      // Determine ARQ mode (if AUTO, pick selected from candidate result or fallback to GBN)
      const mode = state.selectedMode === 'AUTO' 
        ? (state.selectionResult?.selected || 'GBN')
        : state.selectedMode;

      const { session_id } = await api.createSimulation({
        file_id: state.fileId,
        scenario_id: state.scenarioId,
        mode,
        selection_result: state.selectionResult,
      });

      dispatch({ type: 'SET_SESSION', sessionId: session_id });

      // Close previous WebSocket if any
      if (wsRef.current) {
        wsRef.current.close();
      }

      // Connect WebSocket with batched events & auto-reconnect cursor
      const ws = openSimSocket(
        session_id,
        (eventsBatch: SimEvent[]) => {
          dispatch({ type: 'ADD_EVENTS_BATCH', events: eventsBatch });
        },
        (summary: TransferSummary) => {
          dispatch({ type: 'SET_SUMMARY', summary });
          dispatch({ type: 'SET_RUNNING', running: false });
        },
        (status) => {
          setConnStatus(status);
          if (status === 'disconnected') {
            dispatch({ type: 'SET_RUNNING', running: false });
          }
        }
      );

      wsRef.current = ws;
    } catch (err: unknown) {
      dispatch({ type: 'SET_ERROR', error: String(err) });
      dispatch({ type: 'SET_RUNNING', running: false });
    }
  }, [state.fileId, state.scenarioId, state.selectedMode, state.selectionResult, dispatch]);

  // Clean up WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const hasRouter = state.scenario?.channel.has_router ?? false;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Navbar */}
      <Header onOpenDocs={() => setShowDocs(true)} />

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 flex-1 flex flex-col gap-6">
        {/* Phase Navigation Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
          <PhaseIndicator current={state.phase} />

          {/* Quick phase switcher buttons */}
          <div className="flex items-center gap-1 text-xs">
            {(['FILE_SELECT', 'PACKETS', 'ARQ_SELECTION', 'TRANSFER', 'VERIFICATION'] as AppPhase[]).map((p) => {
              const labelMap: Record<AppPhase, string> = {
                FILE_SELECT: '1. File',
                PACKETS: '2. Packets',
                ARQ_SELECTION: '3. Protocol',
                TRANSFER: '4. Simulation',
                VERIFICATION: '5. Quilt Verify',
              };
              const isCurrent = state.phase === p;
              const disabled = (p === 'PACKETS' || p === 'ARQ_SELECTION' || p === 'TRANSFER' || p === 'VERIFICATION') && !state.fileInfo;

              return (
                <button
                  key={p}
                  disabled={disabled}
                  onClick={() => dispatch({ type: 'SET_PHASE', phase: p })}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    isCurrent
                      ? 'bg-indigo-600 text-white font-semibold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 disabled:opacity-30 disabled:hover:bg-transparent'
                  }`}
                >
                  {labelMap[p]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Global Error Banner */}
        {state.error && (
          <div className="p-3 bg-red-950/60 border border-red-700/50 rounded-xl text-xs text-red-300 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
            <button
              onClick={() => dispatch({ type: 'SET_ERROR', error: null })}
              className="text-red-400 hover:text-red-200 font-bold ml-2"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Phase 1: FILE_SELECT */}
        {state.phase === 'FILE_SELECT' && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-6 card bg-slate-900 border-slate-800">
                <FilePanel />
              </div>
              <div className="lg:col-span-6 card bg-slate-900 border-slate-800">
                <ScenarioPanel />
              </div>
            </div>

            {state.fileInfo && state.scenario && (
              <div className="flex justify-end pt-2">
                <button
                  onClick={() => dispatch({ type: 'SET_PHASE', phase: 'PACKETS' })}
                  className="btn btn-primary bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold px-6 py-3 shadow-lg shadow-indigo-500/25 flex items-center gap-2"
                >
                  <span>Proceed to Packet Breakdown ({state.fileInfo.frame_count} frames)</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Phase 2: PACKETS */}
        {state.phase === 'PACKETS' && (
          <div className="flex flex-col gap-4">
            <PacketsView
              onSelectFrame={(frame) => setInspectedFrame({ frame })}
              onProceed={() => dispatch({ type: 'SET_PHASE', phase: 'ARQ_SELECTION' })}
            />
          </div>
        )}

        {/* Phase 3: ARQ_SELECTION */}
        {state.phase === 'ARQ_SELECTION' && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8 card bg-slate-900 border-slate-800">
                <ARQSelector />
              </div>
              <div className="lg:col-span-4 flex flex-col gap-4">
                <div className="card p-4 bg-slate-900 border-slate-800 flex flex-col gap-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Radio className="w-4 h-4 text-purple-400" />
                    Selected Scenario Profile
                  </h3>
                  {state.scenario && (
                    <div className="text-xs space-y-2">
                      <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="font-bold text-slate-200">{state.scenario.name}</div>
                        <div className="text-slate-400 mt-1">{state.scenario.what_it_demonstrates}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-slate-300">
                        <div className="p-2 rounded bg-slate-950 border border-slate-800/80">
                          <span className="text-slate-500 block text-[10px]">RTT DELAY</span>
                          <span className="font-mono font-semibold">{(state.scenario.channel.propagation_delay_us * 2 / 1000).toFixed(0)} ms</span>
                        </div>
                        <div className="p-2 rounded bg-slate-950 border border-slate-800/80">
                          <span className="text-slate-500 block text-[10px]">DATA LOSS</span>
                          <span className="font-mono font-semibold">{(state.scenario.channel.data_loss_prob * 100).toFixed(0)}%</span>
                        </div>
                        <div className="p-2 rounded bg-slate-950 border border-slate-800/80">
                          <span className="text-slate-500 block text-[10px]">ACK LOSS</span>
                          <span className="font-mono font-semibold">{(state.scenario.channel.ack_loss_prob * 100).toFixed(0)}%</span>
                        </div>
                        <div className="p-2 rounded bg-slate-950 border border-slate-800/80">
                          <span className="text-slate-500 block text-[10px]">CORRUPTION</span>
                          <span className="font-mono font-semibold">{(state.scenario.channel.data_corrupt_prob * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="card p-4 bg-slate-900 border-slate-800 flex flex-col gap-3">
                  <button
                    onClick={() => {
                      dispatch({ type: 'SET_PHASE', phase: 'TRANSFER' });
                    }}
                    className="btn btn-primary bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold justify-center py-3 shadow-lg shadow-emerald-500/20 flex items-center gap-2"
                  >
                    <Play className="w-4 h-4 fill-white" />
                    Proceed to Simulation Studio
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Phase 4: TRANSFER */}
        {state.phase === 'TRANSFER' && (
          <div className="flex flex-col gap-4">
            {/* Connection Recovery Banner */}
            {connStatus === 'reconnecting' && state.isRunning && !state.summary && (
              <div className="p-2.5 rounded-xl bg-amber-950/60 border border-amber-600/50 text-amber-300 text-xs flex items-center justify-between animate-pulse">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                  <span>Connection interrupted. Reconnecting with event cursor to recover state without page refresh...</span>
                </div>
                <span className="font-mono text-[10px] text-amber-400/80">Auto-healing</span>
              </div>
            )}

            {/* Control Bar */}
            <ControlBar onStartTransfer={handleStartTransfer} />

            {/* Why This Happened Inspector (Interactive Explanations) */}
            {state.selectedEvent && (
              <WhyThisHappenedInspector
                event={state.selectedEvent}
                onClose={() => dispatch({ type: 'SET_SELECTED_EVENT', event: null })}
              />
            )}

            {/* Central Network Animation View */}
            <div className="card p-4 bg-slate-900/90 border-slate-800 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800/80 pb-2">
                <span className="font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Radio className="w-4 h-4 text-indigo-400" />
                  Live Virtual Channel Topology
                </span>
                <span className="font-mono">
                  {state.scenario?.name} • Protocol: {state.selectedMode}
                </span>
              </div>
              <NetworkView
                events={state.events}
                hasRouter={hasRouter}
                isRunning={state.isRunning}
                onSelectEvent={(e) => dispatch({ type: 'SET_SELECTED_EVENT', event: e })}
              />
            </div>

            {/* Middle telemetry & OSI Stack */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-8 flex flex-col gap-4">
                <MetricsPanel />
                <EventLog />
              </div>
              <div className="lg:col-span-4 flex flex-col gap-4">
                <OSIStack />
                {state.summary && (
                  <div className="card p-4 bg-emerald-950/40 border border-emerald-700/50 flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      Transmission Finished!
                    </div>
                    <p className="text-xs text-slate-300">
                      All frames processed. Inspect the reconstructed file quilt and cryptographic verification.
                    </p>
                    <button
                      onClick={() => dispatch({ type: 'SET_PHASE', phase: 'VERIFICATION' })}
                      className="btn btn-primary bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold justify-center py-2 flex items-center gap-1.5"
                    >
                      <span>Open File Quilt & Verification</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Phase 5: VERIFICATION */}
        {state.phase === 'VERIFICATION' && (
          <div className="flex flex-col gap-6">
            <VerificationPanel
              onSelectFrame={(frame, status) => setInspectedFrame({ frame, status })}
            />

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => dispatch({ type: 'SET_PHASE', phase: 'TRANSFER' })}
                className="btn btn-ghost text-xs"
              >
                ← Back to Network Studio
              </button>

              <button
                onClick={() => {
                  if (window.confirm('Start a new simulation session?')) {
                    dispatch({ type: 'RESET' });
                  }
                }}
                className="btn btn-primary text-xs flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                New Simulation Session
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Packet Inspector Modal */}
      {inspectedFrame && (
        <PacketInspector
          frame={inspectedFrame.frame}
          status={inspectedFrame.status}
          onClose={() => setInspectedFrame(null)}
        />
      )}

      {/* Protocol Theory Guide Modal */}
      <ProtocolGuideModal
        isOpen={showDocs}
        onClose={() => setShowDocs(false)}
      />

      {/* Footer */}
      <footer className="border-t border-slate-800/80 px-6 py-4 bg-slate-900/60 text-center text-xs text-slate-500">
        ARQuilt Interactive ARQ Simulation Lab • Deterministic Discrete-Event Network Simulator • Stop-and-Wait, Go-Back-N & Selective Repeat
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <ARQuiltMain />
    </AppProvider>
  );
}
