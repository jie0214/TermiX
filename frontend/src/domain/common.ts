export interface OperationResult {
  success: boolean;
  output: string;
  error: string;
  sessionKey: string;
  isSudo: boolean;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  hasUpdate: boolean;
}

export type OperationPayload =
  | OperationResult
  | Record<string, unknown>
  | unknown[]
  | string
  | null;

