import {
  getAppBinding,
  requireAppBinding
} from '../../platform/wails';
import { terminalStore } from './TerminalStore';
import { KubernetesAPI } from '../kubernetes/KubernetesAPI.js';

function kubernetesShellSessionID(sessionKey) {
  const session = terminalStore.getState().sessions[sessionKey];
  if (!session?.isKubernetesShell) return '';
  return String(session.config?.kubernetesShellSessionId || '').trim();
}

export const TerminalAPI = {
  connectTerminal: (config) => requireAppBinding('ConnectTerminal')(config),
  connectHost: async (hostId) => {
    const binding = requireAppBinding('ConnectHost');
    return binding(hostId);
  },
  connectHostTerminal: async (hostId, sessionId = '') => {
    const binding = requireAppBinding('ConnectHostTerminal');
    return binding({ hostId, sessionId });
  },
  connectTarget: (target = {}) => {
    if (target.hostId && getAppBinding('ConnectHostTerminal')) {
      return TerminalAPI.connectHostTerminal(target.hostId, target.config?.sessionId || '');
    }
    if (target.hostId && getAppBinding('ConnectHost')) {
      return TerminalAPI.connectHost(target.hostId);
    }
    return TerminalAPI.connectTerminal(target.config || target);
  },
  executeSessionCommand: (sessionKey, cmd) =>
    requireAppBinding('ExecuteSessionCommand')(sessionKey, cmd),
  executeSessionCommandIsolated: (sessionKey, cmd) =>
    requireAppBinding('ExecuteSessionCommandIsolated')(sessionKey, cmd),
  testConnection: (config) => requireAppBinding('TestConnection')(config),
  testHostConnection: async (hostId) => {
    const binding = requireAppBinding('TestHostConnection');
    return binding(hostId);
  },
  testTarget: (target = {}) => {
    if (target.hostId && getAppBinding('TestHostConnection')) {
      return TerminalAPI.testHostConnection(target.hostId);
    }
    return TerminalAPI.testConnection(target.config || target);
  },
  cancelConnectTerminal: (config) =>
    requireAppBinding('CancelConnectTerminal')(config),
  cancelConnectTarget: (target = {}) => {
    if (target.hostId && getAppBinding('CancelConnectHostTerminal')) {
      return requireAppBinding('CancelConnectHostTerminal')({
        hostId: target.hostId,
        sessionId: target.config?.sessionId || ''
      });
    }
    if (target.hostId && getAppBinding('CancelConnectHost')) {
      return requireAppBinding('CancelConnectHost')(target.hostId);
    }
    return TerminalAPI.cancelConnectTerminal(target.config || target);
  },
  closeTerminalSession: (sessionKey) => {
    const shellSessionId = kubernetesShellSessionID(sessionKey);
    return shellSessionId
      ? KubernetesAPI.closePodShell(shellSessionId)
      : requireAppBinding('CloseTerminalSession')(sessionKey);
  },
  resizeTerminal: (sessionKey, cols, rows) => {
    const shellSessionId = kubernetesShellSessionID(sessionKey);
    return shellSessionId
      ? KubernetesAPI.resizePodShell({ sessionId: shellSessionId, cols, rows })
      : requireAppBinding('ResizeTerminal')(sessionKey, cols, rows);
  },
  startLocalTerminal: (shellPath) =>
    requireAppBinding('StartLocalTerminal')(shellPath),
  getAutocompleteSuggestions: (sessionKey, prefix) =>
    requireAppBinding('GetAutocompleteSuggestions')(sessionKey, prefix),
  writeTerminalInput: (sessionKey, data) => {
    const shellSessionId = kubernetesShellSessionID(sessionKey);
    return shellSessionId
      ? KubernetesAPI.writePodShellInput({ sessionId: shellSessionId, data })
      : requireAppBinding('WriteTerminalInput')(sessionKey, data);
  },
  confirmUnknownHostKey: (host, port) =>
    requireAppBinding('ConfirmUnknownHostKey')(host, port)
};
