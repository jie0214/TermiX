export interface AIConnection {
  id: string;
  name: string;
  path: string;
  installed: boolean;
  connected: boolean;
}

export interface AIModel { id: string; name: string; description: string }
export interface EventAnalysisTarget {
  connectedAt: string;
  namespace: string;
  eventName: string;
  eventUid: string;
}
export interface AnalysisMessage { role: 'user' | 'assistant'; content: string }
export interface EventAnalysisRequest extends EventAnalysisTarget {
  locale?: string;
  messages?: AnalysisMessage[];
  requestId: string;
  agentId: string;
  modelId: string;
}
export type AnalysisTarget = PodAnalysisTarget | EventAnalysisTarget;
export interface PodAnalysisTarget {
  connectedAt: string;
  namespace: string;
  podName: string;
  podUid: string;
  containers: string[];
}
export interface PodAnalysisRequest {
  locale?: string;
  messages?: AnalysisMessage[];
  requestId: string;
  agentId: string;
  modelId: string;
  connectedAt: string;
  namespace: string;
  podName: string;
  podUid: string;
  container: string;
  includeLogs: boolean;
  includeEvents: boolean;
}
export interface PodAnalysisResult {
  agentId: string;
  modelId: string;
  text: string;
  snapshot: {
    namespace: string;
    podName: string;
    podUid: string;
    eventName?: string;
    eventUid?: string;
    capturedAt: string;
    evidence: { title: string; content: string; truncated: boolean }[];
    warnings: string[];
  };
}

export interface AIClient {
  listConnections(): Promise<AIConnection[]>;
  setConnection(id: string, connected: boolean): Promise<void>;
  testConnection(id: string): Promise<void>;
  listModels(id: string): Promise<AIModel[]>;
  analyze(request: PodAnalysisRequest): Promise<PodAnalysisResult>;
  analyzeEvent(request: EventAnalysisRequest): Promise<PodAnalysisResult>;
  cancel(requestId: string): Promise<void>;
}
