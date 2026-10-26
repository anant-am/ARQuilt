// PhaseIndicator.tsx — Top progress strip: FILE → PACKETS → ARQ SELECTION → TRANSFER → VERIFICATION

import React from 'react';
import { motion } from 'framer-motion';
import { FileText, Package, Cpu, Radio, ShieldCheck } from 'lucide-react';
import type { AppPhase } from '../types';

const PHASES: { id: AppPhase; label: string; icon: React.ReactNode }[] = [
  { id: 'FILE_SELECT',   label: 'File',       icon: <FileText size={14} /> },
  { id: 'PACKETS',       label: 'Packets',    icon: <Package size={14} /> },
  { id: 'ARQ_SELECTION', label: 'ARQ Select', icon: <Cpu size={14} /> },
  { id: 'TRANSFER',      label: 'Transfer',   icon: <Radio size={14} /> },
  { id: 'VERIFICATION',  label: 'Verify',     icon: <ShieldCheck size={14} /> },
];

const ORDER: AppPhase[] = ['FILE_SELECT','PACKETS','ARQ_SELECTION','TRANSFER','VERIFICATION'];

export function PhaseIndicator({ current }: { current: AppPhase }) {
  const currentIdx = ORDER.indexOf(current);

  return (
    <div className="flex items-center gap-0 select-none">
      {PHASES.map(({ id, label, icon }, i) => {
        const idx = ORDER.indexOf(id);
        const done    = idx < currentIdx;
        const active  = idx === currentIdx;
        const pending = idx > currentIdx;

        return (
          <React.Fragment key={id}>
            <motion.div
              className={[
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                active  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50' : '',
                done    ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-700/40' : '',
                pending ? 'text-slate-500' : '',
              ].join(' ')}
              animate={active ? { scale: [1, 1.04, 1] } : { scale: 1 }}
              transition={{ duration: 1.5, repeat: active ? Infinity : 0 }}
            >
              {icon}
              <span className="hidden sm:inline">{label}</span>
            </motion.div>
            {i < PHASES.length - 1 && (
              <div className={`w-6 h-0.5 mx-1 rounded ${done ? 'bg-emerald-600' : 'bg-slate-700'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
