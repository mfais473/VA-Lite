'use strict';

const CHANNELS = [
  'settings:get-state', 'settings:save', 'settings:set-active',
  'settings:add-custom', 'settings:remove-custom', 'settings:test',
  'settings:get-limits', 'settings:save-limits',
  'settings:get-params', 'settings:save-params',
];

function registerSettingsHandlers({ ipcMain, getMainWindow, isBusy, hasPending, service }) {
  const svc = service || require('../config/settings-service');
  const ctx = { isBusy, hasPending };

  const fromMainWindow = (event) => {
    const win = getMainWindow && getMainWindow();
    if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return false;
    if (!event || event.sender !== win.webContents) return false;
    if (event.senderFrame && event.senderFrame.parent) return false;
    return true;
  };
  const denied = { ok: false, error: 'Tidak diizinkan' };
  const obj = (v) => (v && typeof v === 'object' ? v : {});
  const handle = (channel, fn) => ipcMain.handle(channel, async (event, payload) => {
    if (!fromMainWindow(event)) return denied;
    try {
      return await fn(obj(payload));
    } catch {
      return { ok: false, error: 'Terjadi kesalahan pada pengaturan' };
    }
  });

  handle('settings:get-state', () => ({ ok: true, state: svc.getState() }));
  handle('settings:save', (p) => svc.save(String(p.providerId || ''), obj(p.data), ctx));
  handle('settings:set-active', (p) => svc.setActive(String(p.providerId || ''), ctx));
  handle('settings:add-custom', (p) => svc.addCustom(obj(p.def)));
  handle('settings:remove-custom', (p) => svc.removeCustom(String(p.id || ''), ctx));
  handle('settings:test', (p) => svc.test(String(p.providerId || '')));
  handle('settings:get-limits', () => svc.getLimits());
  handle('settings:save-limits', (p) => svc.saveLimits(obj(p.data)));
  handle('settings:get-params', () => svc.getParams());
  handle('settings:save-params', (p) => svc.saveParams(obj(p.data)));
}

module.exports = { registerSettingsHandlers, CHANNELS };
