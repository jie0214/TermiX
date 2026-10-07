import { createStore } from 'zustand/vanilla';
import type { AnalysisTarget, PodAnalysisResult } from './types.ts';

export interface AnalysisTurn {
  question: string;
  response: PodAnalysisResult;
}
export interface CachedAnalysis {
  result: PodAnalysisResult;
  turns: AnalysisTurn[];
}
export function analysisTargetKey(target: AnalysisTarget | null) {
  return target ? JSON.stringify([target.connectedAt, target.namespace,
    'eventName' in target ? ['event', target.eventName, target.eventUid] : ['pod', target.podName, target.podUid]]) : '';
}

// 僅保存在本次 App 記憶體；離開叢集時連同證據與對話一起清除。
export function createAnalysisSessionCache() {
  return createStore<{ epoch: number; entries: Map<string, CachedAnalysis> }>(() => ({ epoch: 0, entries: new Map() }));
}
export type AnalysisSessionCache = ReturnType<typeof createAnalysisSessionCache>;
export const analysisSessionCache = createAnalysisSessionCache();
export function clearAnalysisSessionCache(cache: AnalysisSessionCache = analysisSessionCache) {
  cache.setState(state => ({ epoch: state.epoch + 1, entries: new Map() }));
}
