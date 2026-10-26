// EventLog.tsx — Real-time event log viewer with filtering, auto-scroll, and explanations

import React, { useState, useRef, useEffect } from 'react';
import { ScrollText, ArrowDown, Search, Filter } from 'lucide-react';
import type { SimEvent, EventType } from '../types';
import { useAppState } from '../store/store';

type FilterCategory = 'ALL' | 'DATA' | 'ACK' | 'LOSS_ERR' | 'TIMEOUT';

function getEventBadge(etype: EventType) {
  switch (etype) {
    case 'DATA_SENT':
      return <span className="badge badge-blue">DATA TX</span>;
    case 'DATA_DELIVERED':
      return <span className="badge badge-green">DELIVERED</span>;
    case 'DATA_LOST':
      return <span className="badge badge-red">PKT LOST</span>;
    case 'DATA_CORRUPTED':
      return <span className="badge badge-amber">CORRUPTED</span>;
    case 'DATA_BUFFERED':
      return <span className="badge badge-purple">BUFFERED</span>;
    case 'ACK_SENT':
      return <span className="badge badge-slate">ACK TX</span>;
    case 'ACK_DELIVERED':
      return <span className="badge badge-green">ACK RX</span>;
    case 'ACK_LOST':
      return <span className="badge badge-red">ACK LOST</span>;
    case 'TIMEOUT':
      return <span className="badge badge-amber">TIMEOUT</span>;
    case 'RETRANSMIT':
      return <span className="badge badge-amber">RETRY</span>;
    case 'WINDOW_UPDATE':
      return <span className="badge badge-purple">WIN UPDATE</span>;
    case 'TRANSFER_START':
      return <span className="badge badge-blue">START</span>;
    case 'TRANSFER_COMPLETE':
      return <span className="badge badge-green">COMPLETE</span>;
    case 'TRANSFER_FAILED':
      return <span className="badge badge-red">FAILED</span>;
    default:
      return <span className="badge badge-slate">{etype}</span>;
  }
}

export function EventLog() {
  const { state, dispatch } = useAppState();
  const events = state.events;
  const [filter, setFilter] = useState<FilterCategory>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new event
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length, autoScroll]);

  const filteredEvents = events.filter(e => {
    // Category filter
    if (filter === 'DATA' && !e.etype.startsWith('DATA_')) return false;
    if (filter === 'ACK' && !e.etype.startsWith('ACK_')) return false;
    if (filter === 'LOSS_ERR' && !e.etype.includes('LOST') && !e.etype.includes('CORRUPTED')) return false;
    if (filter === 'TIMEOUT' && e.etype !== 'TIMEOUT' && e.etype !== 'RETRANSMIT') return false;

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchExpl = e.explanation.toLowerCase().includes(term);
      const matchType = e.etype.toLowerCase().includes(term);
      const matchSeq = e.seq_no?.toString().includes(term) || e.abs_seq?.toString().includes(term);
      return matchExpl || matchType || matchSeq;
    }
    return true;
  });

  return (
    <div className="card bg-slate-900 border-slate-800 flex flex-col h-full max-h-[460px]">
      {/* Header & Controls */}
      <div className="card-header flex flex-wrap items-center justify-between gap-2 bg-slate-900/80">
        <div className="flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-indigo-400" />
          <h3 className="font-semibold text-sm text-slate-200">Protocol Event Log</h3>
          <span className="text-xs text-slate-500 font-mono">({filteredEvents.length} events)</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Search box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-400" />
            <input
              type="text"
              placeholder="Search events..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-slate-950 border border-slate-800 text-xs rounded-lg pl-7 pr-2 py-1 text-slate-200 focus:outline-none focus:border-indigo-500 w-28 sm:w-36"
            />
          </div>

          {/* Auto-scroll toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`btn btn-ghost text-xs p-1 px-2 ${autoScroll ? 'text-indigo-400' : 'text-slate-500'}`}
            title="Toggle auto-scroll"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="px-3 py-1.5 border-b border-slate-800/80 bg-slate-950/40 flex items-center gap-1.5 overflow-x-auto text-xs">
        <Filter className="w-3 h-3 text-slate-500" />
        {(['ALL', 'DATA', 'ACK', 'LOSS_ERR', 'TIMEOUT'] as FilterCategory[]).map(cat => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              filter === cat
                ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Scrollable event list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-1.5 font-mono text-xs">
        {filteredEvents.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs font-sans">
            No events recorded yet. Start simulation to observe ARQ exchange.
          </div>
        ) : (
          filteredEvents.map(e => {
            const isSelected = state.selectedEvent?.event_id === e.event_id;
            return (
              <div
                key={e.event_id}
                onClick={() => dispatch({ type: 'SET_SELECTED_EVENT', event: e })}
                className={`p-2 rounded transition-all cursor-pointer flex flex-col gap-1 ${
                  isSelected
                    ? 'bg-indigo-950/50 border border-indigo-500 shadow-sm ring-1 ring-indigo-500/40'
                    : 'bg-slate-950/70 border border-slate-800/60 hover:border-slate-700 hover:bg-slate-900/60'
                }`}
              >
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-mono">
                      {(e.vtime_us / 1000).toFixed(1)}ms
                    </span>
                    {getEventBadge(e.etype)}
                    {e.abs_seq !== undefined && (
                      <span className="text-indigo-300 font-semibold font-mono">
                        Frame #{e.abs_seq}
                      </span>
                    )}
                    {e.seq_no !== undefined && (
                      <span className="text-slate-400 font-mono">
                        seq={e.seq_no}
                      </span>
                    )}
                    {e.attempt > 1 && (
                      <span className="text-amber-400 font-bold font-mono">
                        (try #{e.attempt})
                      </span>
                    )}
                  </div>

                  <div className="text-slate-500 text-[10px] font-mono">
                    {e.src} → {e.dst}
                  </div>
                </div>

                <div className="text-slate-300 text-[11px] font-sans pl-1.5 border-l-2 border-slate-700">
                  {e.explanation}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
