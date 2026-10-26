// FilePanel.tsx — Left panel: file selection, drag-and-drop, demo load

import React, { useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileText, Hash, Package, AlertCircle,
  Loader2, Zap, X
} from 'lucide-react';
import { api } from '../api';
import { useAppState } from '../store/store';
import type { ScenarioInfo } from '../types';

function fmt(n: number, unit: string) { return `${n.toLocaleString()} ${unit}`; }
function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function FilePanel() {
  const { state, dispatch } = useAppState();
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const frameSize = state.scenario?.arq.frame_payload_bytes ?? 512;

  const handleFile = useCallback(async (file: File) => {
    if (file.size > 500_000) {
      dispatch({ type: 'SET_ERROR', error: 'File too large. Maximum 500 KB for demo.' });
      return;
    }
    setLoading(true);
    dispatch({ type: 'SET_ERROR', error: null });
    try {
      const { file_id, file_info } = await api.uploadFile(file, frameSize);
      dispatch({ type: 'SET_FILE', fileId: file_id, fileInfo: file_info });
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', error: String(e) });
    } finally {
      setLoading(false);
    }
  }, [dispatch, frameSize]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const loadDemo = async () => {
    setLoading(true);
    dispatch({ type: 'SET_ERROR', error: null });
    try {
      const { file_id, file_info } = await api.loadDemo(frameSize);
      dispatch({ type: 'SET_FILE', fileId: file_id, fileInfo: file_info });
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', error: String(e) });
    } finally {
      setLoading(false);
    }
  };

  const { fileInfo } = state;

  return (
    <div className="space-y-3">
      <div className="card-header">
        <FileText size={15} className="text-indigo-400" />
        <span className="text-sm font-semibold text-slate-200">File Selection</span>
      </div>

      <div className="px-4 pb-4 space-y-3">
        {/* Drop zone */}
        <motion.div
          className={[
            'border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all',
            dragging
              ? 'border-indigo-400 bg-indigo-950/50 scale-[1.02]'
              : 'border-slate-700 hover:border-slate-500 hover:bg-slate-800/50',
          ].join(' ')}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          whileHover={{ borderColor: '#6366f1' }}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          {loading ? (
            <Loader2 size={24} className="mx-auto text-indigo-400 animate-spin" />
          ) : (
            <Upload size={24} className="mx-auto text-slate-500 mb-2" />
          )}
          <p className="text-xs text-slate-400 mt-1">
            {loading ? 'Processing…' : 'Drag & drop or click to select'}
          </p>
          <p className="text-xs text-slate-600 mt-0.5">Max 500 KB</p>
        </motion.div>

        {/* Demo file button */}
        <button
          className="btn-ghost w-full justify-center text-xs py-2"
          onClick={loadDemo}
          disabled={loading}
        >
          <Zap size={13} className="text-amber-400" />
          Load Demo File
        </button>

        {/* Error */}
        <AnimatePresence>
          {state.error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex items-start gap-2 bg-red-950/60 border border-red-700/50 rounded-lg p-3"
            >
              <AlertCircle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-300">{state.error}</p>
              <button onClick={() => dispatch({ type: 'SET_ERROR', error: null })} className="ml-auto">
                <X size={12} className="text-red-400" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* File card */}
        <AnimatePresence>
          {fileInfo && (
            <motion.div
              key={fileInfo.filename}
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="bg-slate-800/60 border border-indigo-700/40 rounded-xl p-4 space-y-3"
            >
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-900/60 rounded-lg">
                  <FileText size={16} className="text-indigo-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-100 truncate">{fileInfo.filename}</p>
                  <p className="text-xs text-slate-400">{fmtBytes(fileInfo.size_bytes)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-900/60 rounded-lg p-2">
                  <p className="text-slate-500 mb-0.5">Frames</p>
                  <p className="text-slate-200 font-semibold">{fileInfo.frame_count}</p>
                </div>
                <div className="bg-slate-900/60 rounded-lg p-2">
                  <p className="text-slate-500 mb-0.5">Frame size</p>
                  <p className="text-slate-200 font-semibold">{fmtBytes(fileInfo.payload_size)}</p>
                </div>
              </div>

              <div className="bg-slate-900/60 rounded-lg p-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <Hash size={11} className="text-slate-500" />
                  <span className="text-slate-500 text-xs">SHA-256</span>
                </div>
                <p className="font-mono text-xs text-emerald-400 break-all leading-snug">
                  {fileInfo.sha256}
                </p>
              </div>

              {fileInfo.frames.length > 0 && (
                <div>
                  <p className="text-slate-500 text-xs mb-1.5">
                    <Package size={11} className="inline mr-1" />
                    First {Math.min(4, fileInfo.frames.length)} packets
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {fileInfo.frames.slice(0, 4).map(f => (
                      <span key={f.abs_seq}
                        className="badge-blue font-mono text-xs">
                        #{f.abs_seq} · {f.payload_bytes}B
                      </span>
                    ))}
                    {fileInfo.frame_count > 4 && (
                      <span className="badge-slate">+{fileInfo.frame_count - 4} more</span>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
