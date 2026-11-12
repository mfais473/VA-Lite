const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {

  sendMessage: (text) =>
    ipcRenderer.invoke('chat-send', { text }),

  confirmShortcut: (decision) =>
    ipcRenderer.invoke('confirm-shortcut', { decision }),

  setExpanded: (expanded) =>
    ipcRenderer.invoke('window-set-expanded', Boolean(expanded)),

  dragStart: () => ipcRenderer.send('window-drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('window-drag-move', { dx, dy }),
  dragEnd: (moved) => ipcRenderer.send('window-drag-end', { moved: Boolean(moved) }),

  quitApp: () => ipcRenderer.send('app-quit'),

  settings: {
    getState: () => ipcRenderer.invoke('settings:get-state'),
    save: (providerId, data) => ipcRenderer.invoke('settings:save', { providerId, data }),
    setActive: (providerId) => ipcRenderer.invoke('settings:set-active', { providerId }),
    addCustom: (def) => ipcRenderer.invoke('settings:add-custom', { def }),
    removeCustom: (id) => ipcRenderer.invoke('settings:remove-custom', { id }),
    test: (providerId) => ipcRenderer.invoke('settings:test', { providerId }),
    getLimits: () => ipcRenderer.invoke('settings:get-limits'),
    saveLimits: (data) => ipcRenderer.invoke('settings:save-limits', { data }),
    getParams: () => ipcRenderer.invoke('settings:get-params'),
    saveParams: (data) => ipcRenderer.invoke('settings:save-params', { data }),
  },

  onRateLimit: (cb) => {
    const handler = (_event, state) => cb({ waiting: Boolean(state && state.waiting) });
    ipcRenderer.on('rate-limit-status', handler);
    return () => ipcRenderer.removeListener('rate-limit-status', handler);
  },
});
