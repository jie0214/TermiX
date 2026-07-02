import { createStore } from 'zustand/vanilla';

export const terminalStore = createStore((set, get) => ({
  workspaces: [],
  activeWorkspaceId: 'host-tab',
  workspaceCounter: 1,
  activePaneSessionKey: null,
  sessions: {},
  broadcastInputSessions: new Set(),
  sessionHistories: {},
  xtermInstances: {},

  // Session 管理
  addSession: (sessionKey, sessionData) => set((state) => {
    const updated = { ...state.sessions };
    updated[sessionKey] = {
      label: sessionData.label || 'SSH Session',
      config: sessionData.config || {},
      outputHtml: sessionData.outputHtml || '',
      isSudo: sessionData.isSudo || false,
      infoBoxOutputs: sessionData.infoBoxOutputs || {},
      ...sessionData
    };
    return { sessions: updated };
  }),

  removeSession: (sessionKey) => set((state) => {
    const updated = { ...state.sessions };
    delete updated[sessionKey];
    return { sessions: updated };
  }),

  updateSession: (sessionKey, fields) => set((state) => {
    if (!state.sessions[sessionKey]) return {};
    const updated = { ...state.sessions };
    updated[sessionKey] = { ...updated[sessionKey], ...fields };
    return { sessions: updated };
  }),

  clearSessions: () => set({ sessions: {} }),

  // Workspace (Tabs) 管理
  setWorkspaces: (workspaces) => set({ workspaces }),
  
  addWorkspace: (ws) => set((state) => ({
    workspaces: [...state.workspaces, ws],
    workspaceCounter: state.workspaceCounter + 1
  })),

  removeWorkspace: (wsId) => set((state) => ({
    workspaces: state.workspaces.filter(w => w.id !== wsId)
  })),

  setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),

  // Pane (分割視窗) 管理
  setActivePaneSessionKey: (key) => set({ activePaneSessionKey: key }),

  // 廣播輸入 (Broadcast Input)
  addBroadcastSession: (sessionKey) => set((state) => {
    const next = new Set(state.broadcastInputSessions);
    next.add(sessionKey);
    return { broadcastInputSessions: next };
  }),

  removeBroadcastSession: (sessionKey) => set((state) => {
    const next = new Set(state.broadcastInputSessions);
    next.delete(sessionKey);
    return { broadcastInputSessions: next };
  }),

  clearBroadcastSessions: () => set({ broadcastInputSessions: new Set() }),

  // xterm.js 實例管理
  setXtermInstance: (sessionKey, term) => set((state) => {
    const next = { ...state.xtermInstances };
    next[sessionKey] = term;
    return { xtermInstances: next };
  }),

  removeXtermInstance: (sessionKey) => set((state) => {
    const next = { ...state.xtermInstances };
    delete next[sessionKey];
    return { xtermInstances: next };
  }),

  // 指令歷史紀錄管理
  setSessionHistory: (sessionKey, history) => set((state) => {
    const next = { ...state.sessionHistories };
    next[sessionKey] = history;
    return { sessionHistories: next };
  })
}));
