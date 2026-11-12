'use strict';

const os = require('os');
const path = require('path');

let overrides = {};

function electronApp() {
  try {
    const e = require('electron');
    return e && e.app && typeof e.app.getPath === 'function' ? e.app : null;
  } catch {
    return null;
  }
}

function projectRoot() {
  return path.join(__dirname, '..', '..');
}

function userDataDir() {
  if (overrides.userDataDir) return overrides.userDataDir;
  const app = electronApp();
  if (app) {
    try { return app.getPath('userData'); } catch {}
  }
  return path.join(os.tmpdir(), 'via-userdata');
}

function envPath() {
  if (overrides.envPath) return overrides.envPath;
  const app = electronApp();
  if (app && app.isPackaged) return path.join(userDataDir(), '.env');
  return path.join(projectRoot(), '.env');
}

function providersPath() {
  return overrides.providersPath || path.join(userDataDir(), 'providers.json');
}

function setOverrides(o) {
  overrides = o || {};
}

module.exports = { envPath, providersPath, userDataDir, projectRoot, setOverrides };
