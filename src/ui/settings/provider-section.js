import { el } from '../dom.js';
import { PHASES, field, textInput, hostOf, setResult, menuItem, KIND_TEXT } from './helpers.js';

export function providerTitle(ctx, sub) {
  if (!sub) return 'Provider';
  if (sub === 'active') return 'Provider aktif';
  if (sub === 'add') return 'Tambah provider';
  const p = ctx.data.state && ctx.data.state.providers.find((x) => x.id === sub);
  return p ? p.label : 'Provider';
}

export function renderProvider(ctx, container, sub) {
  if (!ctx.data.state) {
    container.append(el('p', 'via-set-note', 'Memuat pengaturan provider…'));
    return;
  }
  if (!sub) return renderMenu(ctx, container);
  if (sub === 'active') return renderActive(ctx, container);
  if (sub === 'add') return renderAdd(ctx, container);
  const p = ctx.data.state.providers.find((x) => x.id === sub);
  if (!p) {
    container.append(el('p', 'via-set-note', 'Provider tidak ditemukan.'));
    return;
  }
  renderDetail(ctx, container, p);
}

function activeLabel(state) {
  const act = state.providers.find((p) => p.id === state.active);
  return act ? act.label : state.active;
}

function renderMenu(ctx, container) {
  const { state } = ctx.data;
  container.append(el('p', 'via-set-note', 'Pilih provider aktif, atau atur kunci API, link (base URL), dan nama model tiap provider.'));
  container.append(menuItem('Provider aktif', 'Provider yang dipakai Via untuk menjawab', {
    badges: [[activeLabel(state), false]],
    onClick: () => ctx.go(['provider', 'active']),
  }));
  const list = el('div', 'via-set-list');
  for (const p of state.providers) {
    const badges = [];
    if (p.id === state.active) badges.push(['aktif', false]);
    badges.push([p.hasKey ? 'kunci tersimpan' : 'belum ada kunci', true]);
    list.append(menuItem(p.label, p.custom ? 'Provider kustom' : 'Kunci API, link, dan model', {
      badges,
      onClick: () => ctx.go(['provider', p.id]),
    }));
  }
  container.append(list);
  container.append(menuItem('Tambah provider', 'Provider lain yang kompatibel OpenAI atau Anthropic', {
    onClick: () => ctx.go(['provider', 'add']),
  }));
}

function renderActive(ctx, container) {
  const { state } = ctx.data;
  const select = el('select', 'via-set-input');
  for (const p of state.providers) {
    const o = el('option', null, p.label + (p.hasKey ? '' : ' (belum ada kunci)'));
    o.value = p.id;
    select.append(o);
  }
  select.value = state.active;
  const btn = el('button', 'via-set-btn via-set-primary', 'Jadikan aktif');
  btn.type = 'button';
  btn.disabled = ctx.isBusy();
  ctx.activeBtn = btn;
  const msg = el('div', 'via-set-result');
  msg.setAttribute('role', 'status');
  const row = el('div', 'via-set-active');
  row.append(el('span', 'via-set-label', 'Provider'), select, btn);
  container.append(row, msg,
    el('p', 'via-set-note', 'Perubahan berlaku mulai giliran berikutnya, tanpa restart. Provider tidak bisa diganti saat Via sedang bekerja atau menunggu izin.'));

  btn.addEventListener('click', async () => {
    const r = await ctx.api.setActive(select.value);
    if (r && r.ok) {
      ctx.data.state = r.state;
      ctx.onActiveChange(activeLabel(r.state));
      ctx.rerender();
      const again = container.querySelector('.via-set-result');
      if (again) setResult(again, true, r.warning ? `Provider diganti. ${r.warning}` : 'Provider diganti.');
    } else {
      setResult(msg, false, (r && r.error) || 'Gagal mengganti provider');
    }
  });
}

function renderDetail(ctx, container, p) {
  const keyIn = textInput('', p.hasKey ? 'tersimpan (kosongkan bila tidak diubah)' : 'tempel kunci API', 'password');
  container.append(field('Kunci API', keyIn));

  let urlIn = null;
  if (p.editableBaseURL) {
    urlIn = textInput(p.custom ? p.baseURL : (p.baseURL === p.defaultBaseURL ? '' : p.baseURL), p.defaultBaseURL || 'https://…');
    container.append(field('Link API (base URL)', urlIn, p.custom ? null : 'Kosongkan untuk memakai bawaan'));
  }
  const hostLine = el('div', 'via-set-host');
  container.append(hostLine);
  const refreshHost = () => {
    const shown = urlIn && urlIn.value.trim() ? hostOf(urlIn.value) : p.host;
    hostLine.textContent = `Kunci akan dikirim ke: ${shown}`;
  };
  refreshHost();

  const modelIns = {};
  for (const ph of PHASES) {
    modelIns[ph.key] = textInput(p.custom ? p.models[ph.key] : (p.models[ph.key] === p.defaultModels[ph.key] ? '' : p.models[ph.key]),
      p.custom ? 'nama model' : p.defaultModels[ph.key]);
    container.append(field(ph.label, modelIns[ph.key]));
  }
  container.append(el('div', 'via-set-note',
    `Kemampuan: gambar ${p.capabilities.images ? 'ya' : 'tidak'}, tool-call ${p.capabilities.tools ? 'ya' : 'tidak'}`));

  const actions = el('div', 'via-set-actions');
  const saveBtn = el('button', 'via-set-btn via-set-primary', 'Simpan');
  const testBtn = el('button', 'via-set-btn', 'Uji koneksi');
  saveBtn.type = 'button';
  testBtn.type = 'button';
  actions.append(saveBtn, testBtn);
  const result = el('div', 'via-set-result');
  result.setAttribute('role', 'status');
  container.append(actions, result);

  const markDirty = () => { testBtn.disabled = true; testBtn.title = 'Simpan dulu, uji memakai pengaturan tersimpan'; };
  for (const i of [keyIn, urlIn, ...Object.values(modelIns)]) {
    if (i) i.addEventListener('input', () => { markDirty(); refreshHost(); });
  }

  saveBtn.addEventListener('click', async () => {
    const data = { models: {} };
    for (const ph of PHASES) data.models[ph.key] = modelIns[ph.key].value;
    if (urlIn) data.baseURL = urlIn.value;
    if (keyIn.value.trim()) data.apiKey = keyIn.value;
    saveBtn.disabled = true;
    const r = await ctx.api.save(p.id, data);
    saveBtn.disabled = false;
    keyIn.value = '';
    if (r && r.ok) {
      ctx.data.state = r.state;
      ctx.rerender();
      const again = container.querySelector('.via-set-result');
      if (again) setResult(again, true, 'Tersimpan. Berlaku mulai giliran berikutnya.');
    } else {
      setResult(result, false, (r && r.error) || 'Gagal menyimpan');
    }
  });

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    setResult(result, true, 'Menguji…');
    const r = await ctx.api.test(p.id);
    testBtn.disabled = false;
    if (r && r.ok) {
      const tools = r.toolsOk === null ? 'tool-call tidak diuji' : (r.toolsOk ? 'tool-call berfungsi' : 'tool-call GAGAL');
      setResult(result, r.toolsOk !== false, `Tersambung (${r.latencyMs} ms), ${tools}.`);
    } else {
      const why = KIND_TEXT[r && r.errorKind] || 'gagal';
      setResult(result, false, `Gagal: ${why}${r && r.message ? ` — ${r.message}` : ''}`);
    }
  });

  if (p.custom) {
    const del = el('button', 'via-set-btn via-set-danger', 'Hapus provider');
    del.type = 'button';
    const confirmRow = el('div', 'via-set-confirm');
    confirmRow.hidden = true;
    const yes = el('button', 'via-set-btn via-set-danger', 'Ya, hapus');
    const no = el('button', 'via-set-btn', 'Batal');
    yes.type = 'button';
    no.type = 'button';
    confirmRow.append(el('span', null, `Hapus ${p.label} dan kuncinya?`), yes, no);
    del.addEventListener('click', () => { confirmRow.hidden = false; del.hidden = true; });
    no.addEventListener('click', () => { confirmRow.hidden = true; del.hidden = false; });
    yes.addEventListener('click', async () => {
      const r = await ctx.api.removeCustom(p.id);
      if (r && r.ok) {
        ctx.data.state = r.state;
        if (r.switchedTo) await ctx.reload();
        ctx.go(['provider']);
      } else {
        setResult(result, false, (r && r.error) || 'Gagal menghapus');
      }
    });
    container.append(del, confirmRow);
  }
}

function renderAdd(ctx, container) {
  const nameIn = textInput('', 'mis. OpenRouter');
  const protoSel = el('select', 'via-set-input');
  for (const [v, t] of [['openai', 'Kompatibel OpenAI'], ['anthropic', 'Kompatibel Anthropic']]) {
    const o = el('option', null, t);
    o.value = v;
    protoSel.append(o);
  }
  const urlIn = textInput('', 'https://…/v1');
  const keyIn = textInput('', 'tempel kunci API', 'password');
  const hostLine = el('div', 'via-set-host', 'Kunci akan dikirim ke: -');
  urlIn.addEventListener('input', () => { hostLine.textContent = `Kunci akan dikirim ke: ${hostOf(urlIn.value, '-')}`; });
  const modelIns = {};
  for (const ph of PHASES) modelIns[ph.key] = textInput('', 'nama model');
  const imgCb = el('input');
  imgCb.type = 'checkbox';
  const toolCb = el('input');
  toolCb.type = 'checkbox';
  toolCb.checked = true;
  const capRow = el('div', 'via-set-caps');
  const l1 = el('label', 'via-set-check');
  l1.append(imgCb, el('span', null, 'Mendukung gambar'));
  const l2 = el('label', 'via-set-check');
  l2.append(toolCb, el('span', null, 'Mendukung tool-call'));
  capRow.append(l1, l2);

  container.append(field('Nama', nameIn), field('Protokol', protoSel), field('Link API (base URL)', urlIn), hostLine, field('Kunci API', keyIn));
  for (const ph of PHASES) container.append(field(ph.label, modelIns[ph.key]));
  container.append(capRow);
  const addBtn = el('button', 'via-set-btn via-set-primary', 'Tambah');
  addBtn.type = 'button';
  const result = el('div', 'via-set-result');
  result.setAttribute('role', 'status');
  container.append(addBtn, result);

  addBtn.addEventListener('click', async () => {
    const label = nameIn.value.trim();
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
    const models = {};
    for (const ph of PHASES) models[ph.key] = modelIns[ph.key].value.trim();
    const r = await ctx.api.addCustom({
      id, label, protocol: protoSel.value, baseURL: urlIn.value, models,
      capabilities: { images: imgCb.checked, tools: toolCb.checked }, apiKey: keyIn.value,
    });
    keyIn.value = '';
    if (r && r.ok) {
      ctx.data.state = r.state;
      ctx.go(['provider', id]);
    } else {
      setResult(result, false, (r && r.error) || 'Gagal menambah provider');
    }
  });
}
