import { getLocale } from '../../i18n/index.ts';
import { requireAppBinding } from '../../platform/wails/bindings.ts';
import type { AIClient } from './types.ts';

export const AIConnectionAPI: AIClient = {
  listConnections: () => requireAppBinding('ListAIConnections')(),
  setConnection: (id, connected) => requireAppBinding('SetAIConnection')(id, connected),
  testConnection: (id) => requireAppBinding('TestAIConnection')(id),
  listModels: (id) => requireAppBinding('ListAIModels')(id),
  analyze: (request) => requireAppBinding('AnalyzeKubernetesPod')({ ...request, locale: getLocale() }),
  analyzeEvent: (request) => requireAppBinding('AnalyzeKubernetesEvent')({ ...request, locale: getLocale() }),
  cancel: (id) => requireAppBinding('CancelPodAnalysis')(id),
};
