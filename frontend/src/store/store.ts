// store.ts — Simple React context-based app state

import { createContext, useContext, useReducer } from 'react';
import type {
  AppPhase, ARQMode, FileInfo, ScenarioInfo,
  SelectionResult, SimEvent, TransferSummary,
} from '../types';

export interface AppState {
  phase: AppPhase;
  fileId: string | null;
  fileInfo: FileInfo | null;
  scenarioId: string | null;
  scenario: ScenarioInfo | null;
  scenarios: ScenarioInfo[];
  selectedMode: ARQMode;
  selectionResult: SelectionResult | null;
  sessionId: string | null;
  events: SimEvent[];
  summary: TransferSummary | null;
  isRunning: boolean;
  isPaused: boolean;
  speed: number; // 0.5 | 1 | 2 | 4
  error: string | null;
  selectedEvent: SimEvent | null;
}

const init: AppState = {
  phase: 'FILE_SELECT',
  fileId: null,
  fileInfo: null,
  scenarioId: null,
  scenario: null,
  scenarios: [],
  selectedMode: 'AUTO',
  selectionResult: null,
  sessionId: null,
  events: [],
  summary: null,
  isRunning: false,
  isPaused: false,
  speed: 1,
  error: null,
  selectedEvent: null,
};

type Action =
  | { type: 'SET_SCENARIOS'; scenarios: ScenarioInfo[] }
  | { type: 'SET_FILE'; fileId: string; fileInfo: FileInfo }
  | { type: 'SET_SCENARIO'; scenario: ScenarioInfo }
  | { type: 'SET_MODE'; mode: ARQMode }
  | { type: 'SET_PHASE'; phase: AppPhase }
  | { type: 'SET_SELECTION'; result: SelectionResult }
  | { type: 'SET_SESSION'; sessionId: string }
  | { type: 'ADD_EVENT'; event: SimEvent }
  | { type: 'ADD_EVENTS_BATCH'; events: SimEvent[] }
  | { type: 'SET_SELECTED_EVENT'; event: SimEvent | null }
  | { type: 'SET_SUMMARY'; summary: TransferSummary }
  | { type: 'SET_RUNNING'; running: boolean }
  | { type: 'SET_PAUSED'; paused: boolean }
  | { type: 'SET_SPEED'; speed: number }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'RESET' };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_SCENARIOS': return { ...state, scenarios: action.scenarios };
    case 'SET_FILE': return { ...state, fileId: action.fileId, fileInfo: action.fileInfo, error: null };
    case 'SET_SCENARIO': return { ...state, scenarioId: action.scenario.id, scenario: action.scenario };
    case 'SET_MODE': return { ...state, selectedMode: action.mode };
    case 'SET_PHASE': return { ...state, phase: action.phase };
    case 'SET_SELECTION': return { ...state, selectionResult: action.result };
    case 'SET_SESSION': return { ...state, sessionId: action.sessionId };
    case 'ADD_EVENT': {
      if (state.events.some(e => e.event_id === action.event.event_id)) return state;
      return { ...state, events: [...state.events, action.event] };
    }
    case 'ADD_EVENTS_BATCH': {
      const existingIds = new Set(state.events.map(e => e.event_id));
      const fresh = action.events.filter(e => !existingIds.has(e.event_id));
      if (fresh.length === 0) return state;
      return { ...state, events: [...state.events, ...fresh] };
    }
    case 'SET_SELECTED_EVENT': return { ...state, selectedEvent: action.event };
    case 'SET_SUMMARY': return { ...state, summary: action.summary };
    case 'SET_RUNNING': return { ...state, isRunning: action.running };
    case 'SET_PAUSED': return { ...state, isPaused: action.paused };
    case 'SET_SPEED': return { ...state, speed: action.speed };
    case 'SET_ERROR': return { ...state, error: action.error };
    case 'RESET': return { ...init, scenarios: state.scenarios };
    default: return state;
  }
}

import React from 'react';

const Ctx = createContext<{ state: AppState; dispatch: React.Dispatch<Action> } | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, init);
  return React.createElement(Ctx.Provider, { value: { state, dispatch } }, children);
}

export function useAppState() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppState must be inside AppProvider');
  return ctx;
}
