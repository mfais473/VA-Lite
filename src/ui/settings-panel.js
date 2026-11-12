import { el } from './dom.js';
import { setResult, menuItem } from './settings/helpers.js';
import { renderProvider, providerTitle } from './settings/provider-section.js';
import { renderParams, paramsTitle } from './settings/params-section.js';

export function createSettingsPanel({ isBusy, onClose, onActiveChange }) {
  const api = window.api.settings;
  const root = el('div', 'via-settings');
  const data = { state: null, params: null, limits: null };
  let route = [];

  const head = el('div', 'via-set-head');
  const title = el('strong', 'via-set-title', 'Pengaturan');
  const back = el('button', 'via-set-btn', 'Kembali ke chat');
  back.type = 'button';
  head.append(title, back);

  const loadMsg = el('div', 'via-set-result');
  loadMsg.setAttribute('role', 'status');
  const body = el('div', 'via-set-screen');
  root.append(head, loadMsg, body);

  const ctx = {
    api,
    data,
    isBusy,
    activeBtn: null,
    onActiveChange,
    go(next) { route = next; render(); root.scrollTop = 0; },
    rerender() { render(); },
    reload: () => load(),
  };

  function titleFor() {
    const [section, sub] = route;
    if (section === 'provider') return `Provider${sub ? ` \u203a ${providerTitle(ctx, sub)}` : ''}`;
    if (section === 'params') return `Parameter Model${sub ? ` \u203a ${paramsTitle(ctx, sub)}` : ''}`;
    return 'Pengaturan';
  }

  function render() {
    ctx.activeBtn = null;
    body.textContent = '';
    title.textContent = titleFor();
    back.textContent = route.length ? 'Kembali' : 'Kembali ke chat';
    const [section, sub] = route;
    if (section === 'provider') {
      renderProvider(ctx, body, sub);
    } else if (section === 'params') {
      renderParams(ctx, body, sub);
    } else {
      renderRoot();
    }
  }

  function renderRoot() {
    body.append(el('p', 'via-set-note', 'Semua pengaturan yang dulu ada di berkas .env bisa diubah di sini, tanpa mengedit berkas.'));
    const act = data.state && data.state.providers.find((p) => p.id === data.state.active);
    body.append(
      menuItem('Provider', 'Provider aktif, kunci API, link (base URL), dan model', {
        badges: act ? [[act.label, true]] : [],
        onClick: () => ctx.go(['provider']),
      }),
      menuItem('Parameter Model', 'Langkah agen, batas keluaran, limit & retry, akses alat', {
        onClick: () => ctx.go(['params']),
      }),
    );
  }

  back.addEventListener('click', () => {
    if (!route.length) { onClose(); return; }
    route = route.slice(0, -1);
    render();
    root.scrollTop = 0;
  });

  async function load() {
    setResult(loadMsg, true, '');
    const r = await api.getState();
    if (!r || !r.ok) {
      setResult(loadMsg, false, (r && r.error) || 'Gagal memuat pengaturan');
      render();
      return;
    }
    data.state = r.state;
    const act = data.state.providers.find((p) => p.id === data.state.active);
    onActiveChange(act ? act.label : data.state.active);
    if (api.getParams) {
      const p = await api.getParams();
      if (p && p.ok) data.params = p;
    }
    if (api.getLimits) {
      const l = await api.getLimits();
      if (l && l.ok) data.limits = l.limits;
    }
    render();
  }

  render();

  return {
    el: root,
    refresh: async () => { route = []; await load(); },
    setBusyState: () => { if (ctx.activeBtn) ctx.activeBtn.disabled = isBusy(); },
  };
}
