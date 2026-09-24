/** Letztes Raytracing-Ergebnis für die UI (Statusleiste, Inspector). */
import { create } from 'zustand';
import type { TraceResult } from '@/engine/raytracing';

interface TraceResultState {
  result: TraceResult | null;
  setResult: (r: TraceResult | null) => void;
}

export const useTraceResultStore = create<TraceResultState>()((set) => ({
  result: null,
  setResult: (result) => set({ result }),
}));
