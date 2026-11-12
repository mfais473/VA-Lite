require('./helpers/stub-modules');
const test = require('node:test');
const assert = require('node:assert/strict');
const { __test: { layoutFor, COLLAPSED, EXPANDED } } = require('../src/core/window');

const WA = { x: 0, y: 0, width: 1920, height: 1040 };
const bubbleAt = (x, y) => ({ x, y, width: COLLAPSED.width, height: COLLAPSED.height });
const right = (b) => b.x + b.width;
const bottom = (b) => b.y + b.height;
const inside = (b, wa) => b.x >= wa.x && b.y >= wa.y && right(b) <= wa.x + wa.width && bottom(b) <= wa.y + wa.height;

test('gelembung di pojok kanan-bawah: panel tumbuh ke kiri-atas, sudut gelembung tidak bergeser', () => {
  const b = bubbleAt(1800, 920);
  const r = layoutFor(b, WA, true, { h: 'right', v: 'bottom' });
  assert.deepEqual(r.placement, { h: 'right', v: 'bottom' });
  assert.equal(r.bounds.width, EXPANDED.width);
  assert.equal(r.bounds.height, EXPANDED.height);
  assert.equal(right(r.bounds), right(b));
  assert.equal(bottom(r.bounds), bottom(b));
});

test('gelembung di pojok kiri-atas: panel tumbuh ke kanan-bawah', () => {
  const b = bubbleAt(24, 24);
  const r = layoutFor(b, WA, true, { h: 'right', v: 'bottom' });
  assert.deepEqual(r.placement, { h: 'left', v: 'top' });
  assert.equal(r.bounds.x, b.x);
  assert.equal(r.bounds.y, b.y);
});

test('buka lalu tutup di keempat sudut mengembalikan gelembung ke tempat semula', () => {
  for (const [x, y] of [[24, 24], [1800, 24], [24, 920], [1800, 920]]) {
    const start = bubbleAt(x, y);
    const open = layoutFor(start, WA, true, { h: 'right', v: 'bottom' });
    assert.ok(inside(open.bounds, WA), `panel keluar layar di (${x},${y})`);
    const closed = layoutFor(open.bounds, WA, false, open.placement);
    assert.deepEqual(closed.bounds, start, `tidak kembali di (${x},${y})`);
  }
});

test('panel selalu utuh di dalam area kerja walau gelembung di tengah layar', () => {
  const r = layoutFor(bubbleAt(912, 472), WA, true, { h: 'right', v: 'bottom' });
  assert.ok(inside(r.bounds, WA));
});

test('area kerja kecil: ukuran panel dibatasi dan tetap di dalam layar', () => {
  const small = { x: 0, y: 0, width: 800, height: 500 };
  const r = layoutFor(bubbleAt(690, 390), small, true, { h: 'right', v: 'bottom' });
  assert.equal(r.bounds.height, 500);
  assert.ok(inside(r.bounds, small));
});

test('layar kedua (area kerja berawal bukan di 0,0) dihitung relatif ke layar itu', () => {
  const second = { x: 1920, y: 0, width: 1280, height: 1024 };
  const b = bubbleAt(1920 + 1280 - 96 - 24, 1024 - 96 - 24);
  const r = layoutFor(b, second, true, { h: 'right', v: 'bottom' });
  assert.deepEqual(r.placement, { h: 'right', v: 'bottom' });
  assert.ok(inside(r.bounds, second));
  assert.equal(right(r.bounds), right(b));
});

test('menutup memakai sudut yang tersimpan, bukan menebak ulang dari posisi', () => {
  const panel = { x: 100, y: 100, width: EXPANDED.width, height: EXPANDED.height };
  const r = layoutFor(panel, WA, false, { h: 'right', v: 'bottom' });
  assert.equal(right(r.bounds), right(panel));
  assert.equal(bottom(r.bounds), bottom(panel));
  assert.deepEqual(r.placement, { h: 'right', v: 'bottom' });
});
