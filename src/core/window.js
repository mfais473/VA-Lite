const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { COLLAPSED, EXPANDED, EDGE_MARGIN, clamp, layoutFor } = require('./window-layout');

let mainWindow = null;
let placement = { h: 'right', v: 'bottom' };
let drag = null;

function workAreaOf(bounds) {
  return screen.getDisplayMatching(bounds).workArea;
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    width: COLLAPSED.width,
    height: COLLAPSED.height,
    x: wa.x + wa.width - COLLAPSED.width - EDGE_MARGIN,
    y: wa.y + wa.height - COLLAPSED.height - EDGE_MARGIN,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  win.loadFile(path.join(__dirname, '..', '..', 'index.html'));
  if (process.env.VIA_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
  return win;
}

function setExpanded(expanded) {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return placement;
  const bounds = win.getBounds();
  const result = layoutFor(bounds, workAreaOf(bounds), Boolean(expanded), placement);
  placement = result.placement;
  win.setBounds(result.bounds);
  return placement;
}

function beginDrag() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  drag = { bounds: mainWindow.getBounds() };
}

function dragBy(dx, dy) {
  if (!drag || !mainWindow || mainWindow.isDestroyed()) return;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const b = drag.bounds;
  mainWindow.setBounds({ x: Math.round(b.x + dx), y: Math.round(b.y + dy), width: b.width, height: b.height });
}

function endDrag(moved) {
  const win = mainWindow;
  drag = null;
  if (!moved || !win || win.isDestroyed()) return;
  const b = win.getBounds();
  const wa = workAreaOf(b);
  win.setBounds({
    x: clamp(b.x, wa.x, wa.x + wa.width - b.width),
    y: clamp(b.y, wa.y, wa.y + wa.height - b.height),
    width: b.width,
    height: b.height,
  });
}

function getMainWindow() {
  return mainWindow;
}

module.exports = {
  createWindow, setExpanded, beginDrag, dragBy, endDrag, getMainWindow,
  __test: { layoutFor, COLLAPSED, EXPANDED },
};
