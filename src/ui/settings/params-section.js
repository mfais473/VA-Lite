import { el } from '../dom.js';
import { field, textInput, numberInput, setResult, menuItem } from './helpers.js';

const OUTPUT_ID = 'output';
const OUTPUT_AFTER = 'steps';

export function paramsTitle(ctx, sub) {
  if (!sub) return 'Parameter Model';
  if (sub === OUTPUT_ID) return 'Batas keluaran';
  const g = findGroup(ctx, sub);
  return g ? g.label : 'Parameter Model';
}

function findGroup(ctx, id) {
  const groups = (ctx.data.params && ctx.data.params.groups) || [];
  return groups.find((g) => g.id === id) || null;
}

export function renderParams(ctx, container, sub) {
  if (!ctx.data.params) {
    container.append(el('p', 'via-set-note', 'Memuat parameter…'));
    return;
  }
  if (!sub) return renderMenu(ctx, container);
  if (sub === OUTPUT_ID) return renderOutput(ctx, container);
  const g = findGroup(ctx, sub);
  if (!g) {
    container.append(el('p', 'via-set-note', 'Pengaturan tidak ditemukan.'));
    return;
  }
  renderGroup(ctx, container, g);
}

function renderMenu(ctx, container) {
  container.append(el('p', 'via-set-note', 'Atur perilaku agen dan model. Semuanya disimpan ke berkas .env dan berlaku mulai giliran berikutnya, tanpa restart (kecuali dinyatakan lain).'));
  const groups = ctx.data.params.groups;
  const limits = ctx.data.limits;
  const outputItem = () => menuItem('Batas keluaran', 'Batas token jawaban model per panggilan', {
    badges: limits ? [[limits.mode === 'custom' ? `${limits.value} token` : 'default', true]] : [],
    onClick: () => ctx.go(['params', OUTPUT_ID]),
  });
  const list = el('div', 'via-set-list');
  for (const g of groups) {
    list.append(menuItem(g.label, g.description, { onClick: () => ctx.go(['params', g.id]) }));
    if (g.id === OUTPUT_AFTER) list.append(outputItem());
  }
  container.append(list);
}

function buildInput(spec) {
  if (spec.type === 'bool') {
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = spec.value === '1';
    const label = el('label', 'via-set-check');
    label.append(cb, el('span', null, spec.label));
    return { node: label, read: () => (cb.checked ? '1' : ''), bare: true };
  }
  const ph = spec.default !== '' ? spec.default : spec.defaultLabel;
  if (spec.type === 'dirs') {
    const ta = el('textarea', 'via-set-input via-set-area');
    ta.rows = 3;
    ta.value = spec.value.split(/[;\r\n]+/).map((s) => s.trim()).filter(Boolean).join('\n');
    ta.placeholder = `Kosong = ${ph}`;
    ta.spellcheck = false;
    ta.autocomplete = 'off';
    return { node: ta, read: () => ta.value };
  }
  const input = spec.type === 'int' ? numberInput(spec.value, `Default: ${ph}`) : textInput(spec.value, `Default: ${ph}`);
  return { node: input, read: () => input.value };
}

function hintText(spec) {
  const parts = [spec.hint];
  if (spec.type === 'int') parts.push(`Rentang ${spec.min}\u2013${spec.max}${spec.unit ? ` ${spec.unit}` : ''}.`);
  parts.push(`Kosongkan untuk default (${spec.defaultLabel}).`);
  return parts.join(' ');
}

function renderGroup(ctx, container, group) {
  container.append(el('p', 'via-set-note', group.description));
  const reads = {};
  for (const spec of group.params) {
    const built = buildInput(spec);
    reads[spec.key] = built.read;
    const label = spec.unit && spec.type === 'int' ? `${spec.label} (${spec.unit})` : spec.label;
    if (built.bare) {
      const wrap = el('div', 'via-set-field');
      wrap.append(built.node, el('span', 'via-set-hint', spec.hint));
      container.append(wrap);
    } else {
      container.append(field(label, built.node, hintText(spec)));
    }
  }
  const restartNote = group.params.some((p) => p.restart)
    ? el('p', 'via-set-note', 'Pengaturan bertanda "setelah restart" baru berlaku setelah Via dijalankan ulang.')
    : null;
  if (restartNote) container.append(restartNote);

  const saveBtn = el('button', 'via-set-btn via-set-primary', 'Simpan');
  saveBtn.type = 'button';
  const result = el('div', 'via-set-result');
  result.setAttribute('role', 'status');
  container.append(saveBtn, result);

  saveBtn.addEventListener('click', async () => {
    const values = {};
    for (const spec of group.params) values[spec.key] = reads[spec.key]();
    saveBtn.disabled = true;
    const r = await ctx.api.saveParams({ values });
    saveBtn.disabled = false;
    if (r && r.ok) {
      ctx.data.params = r;
      ctx.rerender();
      const again = container.querySelector('.via-set-result');
      const needsRestart = group.params.some((p) => p.restart);
      if (again) setResult(again, true, needsRestart ? 'Tersimpan. Berlaku setelah Via dijalankan ulang.' : 'Tersimpan. Berlaku mulai giliran berikutnya.');
    } else {
      setResult(result, false, (r && r.error) || 'Gagal menyimpan');
    }
  });
}

function radio(name, value, text, checked) {
  const label = el('label', 'via-set-check');
  const input = el('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = checked;
  label.append(input, el('span', null, text));
  return { label, input };
}

function renderOutput(ctx, container) {
  const limits = ctx.data.limits;
  if (!limits) {
    container.append(el('p', 'via-set-note', 'Memuat batas keluaran…'));
    return;
  }
  container.append(el('p', 'via-set-note',
    'Batas jumlah token yang boleh ditulis model dalam satu jawaban (termasuk token berpikir). Jawaban yang melewati batas terpotong; Via lalu mencoba memulihkannya sekali.'));

  const defRadio = radio('via-limit-mode', 'default', 'Default', limits.mode === 'default');
  const customRadio = radio('via-limit-mode', 'custom', 'Custom', limits.mode === 'custom');
  const hint = el('div', 'via-set-hint');
  const numIn = numberInput(limits.mode === 'custom' ? String(limits.value) : '', `mis. 16000 (${limits.min}\u2013${limits.max})`);
  const syncMode = () => {
    const custom = customRadio.input.checked;
    numIn.disabled = !custom;
    hint.textContent = custom
      ? `Isi antara ${limits.min} dan ${limits.max} token.`
      : 'Via tidak mengirim batas; penyedia memakai bawaannya (di Anoman: seukuran anggaran konteks model). Provider berprotokol Anthropic tetap memakai 8000 karena batas itu wajib di sana.';
  };
  syncMode();
  for (const r of [defRadio, customRadio]) {
    r.input.addEventListener('change', () => { syncMode(); if (customRadio.input.checked) numIn.focus(); });
  }
  container.append(el('strong', 'via-set-label', 'Batas umum (semua fase)'), defRadio.label, customRadio.label, numIn, hint);

  const coding = limits.coding || { mode: 'inherit', value: null };
  const inheritRadio = radio('via-limit-coding', 'inherit', 'Ikut batas umum', coding.mode !== 'custom');
  const codingCustom = radio('via-limit-coding', 'custom', 'Custom khusus fase coding', coding.mode === 'custom');
  const codingIn = numberInput(coding.mode === 'custom' ? String(coding.value) : '', `mis. 30000 (${limits.min}\u2013${limits.max})`);
  const syncCoding = () => { codingIn.disabled = !codingCustom.input.checked; };
  syncCoding();
  for (const r of [inheritRadio, codingCustom]) {
    r.input.addEventListener('change', () => { syncCoding(); if (codingCustom.input.checked) codingIn.focus(); });
  }
  container.append(el('strong', 'via-set-label', 'Batas fase coding'), inheritRadio.label, codingCustom.label, codingIn,
    el('div', 'via-set-hint', 'Bila diisi, batas ini MENIMPA batas umum hanya pada fase coding. Biarkan "Ikut batas umum" kecuali memang perlu beda.'));

  const saveBtn = el('button', 'via-set-btn via-set-primary', 'Simpan');
  saveBtn.type = 'button';
  const result = el('div', 'via-set-result');
  result.setAttribute('role', 'status');
  container.append(saveBtn, result);

  saveBtn.addEventListener('click', async () => {
    const data = customRadio.input.checked ? { mode: 'custom', value: numIn.value } : { mode: 'default' };
    data.coding = codingCustom.input.checked ? { mode: 'custom', value: codingIn.value } : { mode: 'inherit' };
    saveBtn.disabled = true;
    const r = await ctx.api.saveLimits(data);
    saveBtn.disabled = false;
    if (r && r.ok) {
      ctx.data.limits = r.limits;
      ctx.rerender();
      const again = container.querySelector('.via-set-result');
      if (again) setResult(again, true, 'Tersimpan. Berlaku mulai panggilan berikutnya.');
    } else {
      setResult(result, false, (r && r.error) || 'Gagal menyimpan');
    }
  });
}
