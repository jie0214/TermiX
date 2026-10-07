import { createStore } from 'zustand/vanilla';
import { AIConnectionAPI } from './AIConnectionAPI.ts';
import { analysisTargetKey, createAnalysisSessionCache } from './AnalysisSessionCache.ts';
import type { AnalysisSessionCache, AnalysisTurn } from './AnalysisSessionCache.ts';
import { errorText } from './AIConnectionStore.ts';
import type { AIClient, AIConnection, AIModel, AnalysisTarget, AnalysisMessage, PodAnalysisResult } from './types.ts';

interface AnalysisState {
  target: AnalysisTarget | null;
  connections: AIConnection[];
  agentId: string;
  modelId: string;
  models: AIModel[];
  modelsLoading: boolean;
  modelsError: string;
  container: string;
  includeLogs: boolean;
  includeEvents: boolean;
  loading: boolean;
  requestId: string;
  error: string;
  result: PodAnalysisResult | null;
  turns: AnalysisTurn[];
  pendingQuestion: string;
  syncCache(): void;
  followUp(question: string): Promise<boolean>;
  setTarget(target: AnalysisTarget | null): void;
  setConnections(connections: AIConnection[]): void;
  selectAgent(id: string): Promise<void>;
  selectModel(id: string): void;
  setOptions(options: Partial<Pick<AnalysisState, 'container' | 'includeLogs' | 'includeEvents'>>): void;
  analyze(): Promise<void>;
  cancel(): void;
}

export function createPodAnalysisStore(api: AIClient = AIConnectionAPI, cache: AnalysisSessionCache = createAnalysisSessionCache()) {
  let modelGeneration = 0;
  let analysisGeneration = 0;
  let cacheEpoch = cache.getState().epoch;
  const updateCache = (target: AnalysisTarget, entry: { result: PodAnalysisResult; turns: AnalysisTurn[] } | null) => {
    cache.setState(state => {
      const entries = new Map(state.entries);
      if (entry) entries.set(analysisTargetKey(target), entry);
      else entries.delete(analysisTargetKey(target));
      return { entries };
    });
  };
  const requestAnalysis = (state: AnalysisState, requestId: string, messages?: AnalysisMessage[]) => {
    const identity = { requestId, agentId: state.agentId, modelId: state.modelId, ...(messages ? { messages } : {}) };
    const target = state.target!;
    if ('eventName' in target) return api.analyzeEvent({ ...target, ...identity });
    const { containers: _, ...podTarget } = target;
    return api.analyze({ ...podTarget, ...identity, container: state.container, includeLogs: state.includeLogs, includeEvents: state.includeEvents });
  };
  return createStore<AnalysisState>((set, get) => ({
    target: null, connections: [], agentId: '', modelId: '', models: [], modelsLoading: false, modelsError: '',
    container: '', includeLogs: true, includeEvents: true, loading: false, requestId: '', error: '', result: null, turns: [], pendingQuestion: '',
    setTarget(target) {
      if (analysisTargetKey(target) === analysisTargetKey(get().target)) return;
      get().cancel();
      set({ target, container: target && 'containers' in target ? target.containers[0] || '' : '', error: '', result: cache.getState().entries.get(analysisTargetKey(target))?.result || null, turns: cache.getState().entries.get(analysisTargetKey(target))?.turns || [] });
      cacheEpoch = cache.getState().epoch;
    },
    syncCache() {
      if (cacheEpoch !== cache.getState().epoch) {
        cacheEpoch = cache.getState().epoch;
        get().cancel();
        set({ target: null, result: null, turns: [], error: '' });
        return;
      }
      const entry = cache.getState().entries.get(analysisTargetKey(get().target));
      set({ result: entry?.result || null, turns: entry?.turns || [] });
    },
    setConnections(connections) {
      const available = connections.filter(c => c.connected && c.installed);
      set({ connections: available });
      if (!available.some(c => c.id === get().agentId)) void get().selectAgent(available[0]?.id || '');
    },
    async selectAgent(id) {
      get().cancel();
      const generation = ++modelGeneration;
      const valid = get().connections.some(c => c.id === id);
      set({ agentId: valid ? id : '', modelId: '', models: [], modelsError: '', modelsLoading: valid, error: '' });
      if (!valid) return;
      try {
        const models = (await api.listModels(id)) || [];
        if (generation !== modelGeneration) return;
        if (!models.length) throw new Error('Agent 未提供可用模型，請確認登入狀態與 CLI 版本。');
        set({ models, modelId: models[0].id });
      } catch (error) {
        if (generation === modelGeneration) set({ modelsError: errorText(error) });
      } finally { if (generation === modelGeneration) set({ modelsLoading: false }); }
    },
    selectModel(id) {
      if (!get().models.some(m => m.id === id)) return;
      get().cancel();
      set({ modelId: id, error: '' });
    },
    setOptions(options) {
      get().cancel();
      set({ ...options, error: '' });
    },
    async analyze() {
      const s = get();
      if (s.loading || s.modelsLoading || !s.target || !s.models.some(m => m.id === s.modelId) || !s.connections.some(c => c.id === s.agentId)) return;
      if ('containers' in s.target && s.includeLogs && !s.target.containers.includes(s.container)) { set({ error: '請選擇有效容器。' }); return; }
      const generation = ++analysisGeneration;
      const requestId = crypto.randomUUID();
      const epoch = cache.getState().epoch;
      updateCache(s.target, null);
      set({ loading: true, requestId, result: null, turns: [], error: '' });
      try {
        const result = await requestAnalysis(s, requestId);
        if (generation === analysisGeneration && epoch === cache.getState().epoch) {
          updateCache(s.target, { result, turns: [] });
          set({ result, turns: [] });
        }
      } catch (error) {
        if (generation === analysisGeneration) set({ error: errorText(error) });
      } finally { if (generation === analysisGeneration) set({ loading: false, requestId: '', pendingQuestion: '' }); }
    },
    async followUp(question) {
      const s = get();
      question = question.trim();
      if (!question || s.loading || s.modelsLoading || !s.result || !s.target || !s.models.some(m => m.id === s.modelId) || !s.connections.some(c => c.id === s.agentId)) return false;
      if (question.length > 4000) { set({ error: '提問請控制在 4,000 字以內。' }); return false; }
      if ('containers' in s.target && s.includeLogs && !s.target.containers.includes(s.container)) { set({ error: '請選擇有效容器。' }); return false; }
      const generation = ++analysisGeneration;
      const epoch = cache.getState().epoch;
      const requestId = crypto.randomUUID();
      const messages: AnalysisMessage[] = [
        { role: 'assistant', content: s.result.text },
        ...s.turns.slice(-10).flatMap(turn => [{ role: 'user' as const, content: turn.question }, { role: 'assistant' as const, content: turn.response.text }]),
        { role: 'user', content: question },
      ];
      set({ loading: true, requestId, pendingQuestion: question, error: '' });
      try {
        const response = await requestAnalysis(s, requestId, messages);
        if (generation !== analysisGeneration || epoch !== cache.getState().epoch) return false;
        const turns = [...s.turns, { question, response }];
        updateCache(s.target, { result: s.result, turns });
        set({ turns });
        return true;
      } catch (error) {
        if (generation === analysisGeneration) set({ error: errorText(error) });
        return false;
      } finally {
        if (generation === analysisGeneration) set({ loading: false, requestId: '', pendingQuestion: '' });
      }
    },
    cancel() {
      const id = get().requestId;
      const generation = ++analysisGeneration;
      set({ loading: false, requestId: '', pendingQuestion: '' });
      if (id) void api.cancel(id).catch(error => {
        if (generation === analysisGeneration) set({ error: '取消分析失敗：' + errorText(error) });
      });
    },
  }));
}
