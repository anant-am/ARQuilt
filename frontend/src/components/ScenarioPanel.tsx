// ScenarioPanel.tsx — Scenario selector with descriptions

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Network, ChevronRight, Info } from 'lucide-react';
import { api } from '../api';
import { useAppState } from '../store/store';

const SCENARIO_COLORS: Record<string, string> = {
  s01: 'border-emerald-700/40 hover:border-emerald-600/60',
  s02: 'border-blue-700/40 hover:border-blue-600/60',
  s03: 'border-amber-700/40 hover:border-amber-600/60',
  s04: 'border-orange-700/40 hover:border-orange-600/60',
  s05: 'border-red-700/40 hover:border-red-600/60',
  s06: 'border-purple-700/40 hover:border-purple-600/60',
  s07: 'border-pink-700/40 hover:border-pink-600/60',
  s08: 'border-yellow-700/40 hover:border-yellow-600/60',
  s09: 'border-cyan-700/40 hover:border-cyan-600/60',
  s10: 'border-red-800/60 hover:border-red-700/80',
};

export function ScenarioPanel() {
  const { state, dispatch } = useAppState();

  useEffect(() => {
    api.scenarios().then(ss => dispatch({ type: 'SET_SCENARIOS', scenarios: ss })).catch(() => {});
  }, [dispatch]);

  return (
    <div className="space-y-3">
      <div className="card-header">
        <Network size={15} className="text-purple-400" />
        <span className="text-sm font-semibold text-slate-200">Network Scenario</span>
      </div>

      <div className="px-4 pb-4 space-y-1.5 max-h-80 overflow-y-auto">
        {state.scenarios.map((s) => {
          const active = state.scenarioId === s.id;
          const isFailure = s.id === 's10';
          return (
            <motion.button
              key={s.id}
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => dispatch({ type: 'SET_SCENARIO', scenario: s })}
              className={[
                'w-full text-left p-3 rounded-lg border transition-all',
                active
                  ? 'bg-indigo-900/40 border-indigo-500 shadow-lg shadow-indigo-900/30'
                  : `bg-slate-800/40 ${SCENARIO_COLORS[s.id] ?? 'border-slate-700/40'}`,
              ].join(' ')}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                    active ? 'bg-indigo-700 text-indigo-100' :
                    isFailure ? 'bg-red-900/60 text-red-300' : 'bg-slate-700/60 text-slate-400'
                  }`}>
                    {s.id.toUpperCase()}
                  </span>
                  <span className="text-xs font-medium text-slate-200">{s.name}</span>
                </div>
                {active && <ChevronRight size={13} className="text-indigo-400" />}
              </div>
              <p className="text-xs text-slate-500 mt-1 leading-snug line-clamp-2">{s.description}</p>
            </motion.button>
          );
        })}
      </div>

      {/* Selected scenario details */}
      {state.scenario && (
        <motion.div
          key={state.scenarioId}
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
          className="mx-4 mb-4 bg-slate-800/60 border border-slate-700/50 rounded-xl p-3"
        >
          <div className="flex items-start gap-2">
            <Info size={13} className="text-slate-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-slate-400 leading-relaxed">
              {state.scenario.what_it_demonstrates}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-1.5 mt-2.5">
            {[
              ['Loss', `${(state.scenario.channel.data_loss_prob * 100).toFixed(0)}%`],
              ['ACK Loss', `${(state.scenario.channel.ack_loss_prob * 100).toFixed(0)}%`],
              ['Delay', `${(state.scenario.channel.propagation_delay_us / 1000).toFixed(0)} ms`],
              ['BW', `${(state.scenario.channel.bandwidth_bps / 1_000_000).toFixed(0)} Mbps`],
            ].map(([label, value]) => (
              <div key={label} className="bg-slate-900/60 rounded p-1.5 text-center">
                <p className="text-slate-500 text-xs">{label}</p>
                <p className="text-slate-200 text-xs font-semibold">{value}</p>
              </div>
            ))}
          </div>
          {state.scenario.channel.has_router && (
            <div className="mt-2 badge-blue text-xs">
              🔀 Two-hop router path
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
