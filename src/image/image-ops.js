const SAFE_BYTES = 4 * 1024 * 1024;
const LEGACY_MAX_SIDE = 2000;
const MAX_SIDE = 1568;
const MIN_SIDE = 1000;
const MAX_UPSCALE = 4;
const MIN_REGION_PX = 16;
const BYTES_PER_PIXEL = 4;

function normalizeRotation(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const deg = ((Math.round(n) % 360) + 360) % 360;
  return deg % 90 === 0 ? deg : null;
}

function rotateBitmap(bitmap, width, height, degrees) {
  if (bitmap.length !== width * height * BYTES_PER_PIXEL) {
    throw new Error('Ukuran bitmap tidak cocok dengan lebar x tinggi');
  }
  const deg = normalizeRotation(degrees);
  if (deg === null) throw new Error('Putaran harus kelipatan 90 derajat');
  if (deg === 0) return { bitmap, width, height };

  const out = Buffer.allocUnsafe(bitmap.length);
  const outW = deg === 180 ? width : height;
  const outH = deg === 180 ? height : width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let nx;
      let ny;
      if (deg === 90) { nx = height - 1 - y; ny = x; }
      else if (deg === 180) { nx = width - 1 - x; ny = height - 1 - y; }
      else { nx = y; ny = width - 1 - x; }
      bitmap.copy(out, (ny * outW + nx) * BYTES_PER_PIXEL, (y * width + x) * BYTES_PER_PIXEL, (y * width + x + 1) * BYTES_PER_PIXEL);
    }
  }
  return { bitmap: out, width: outW, height: outH };
}

function resolveRegion(box, imgW, imgH) {
  const b = box || {};
  const pick = (v, dflt) => (v === undefined || v === null || v === '' ? dflt : Number(v));
  const vals = {
    left: pick(b.left, 0), top: pick(b.top, 0), right: pick(b.right, 100), bottom: pick(b.bottom, 100),
  };
  for (const [k, v] of Object.entries(vals)) {
    if (!Number.isFinite(v)) return { error: `Nilai "${k}" harus angka persen 0-100` };
  }
  const clamp = (v) => Math.min(100, Math.max(0, v));
  const left = clamp(vals.left);
  const top = clamp(vals.top);
  const right = clamp(vals.right);
  const bottom = clamp(vals.bottom);
  if (right <= left || bottom <= top) {
    return { error: 'Area potong tidak valid: "right" harus lebih besar dari "left" dan "bottom" dari "top"' };
  }
  const x = Math.round((left / 100) * imgW);
  const y = Math.round((top / 100) * imgH);
  const width = Math.round((right / 100) * imgW) - x;
  const height = Math.round((bottom / 100) * imgH) - y;
  if (width < MIN_REGION_PX || height < MIN_REGION_PX) {
    return { error: `Area potong terlalu kecil (minimal ${MIN_REGION_PX} piksel)` };
  }
  return { x, y, width, height, full: left === 0 && top === 0 && right === 100 && bottom === 100, left, top, right, bottom };
}

function targetSize(width, height, { upscale = false } = {}) {
  const longSide = Math.max(width, height);
  let scale = 1;
  if (longSide > MAX_SIDE) scale = MAX_SIDE / longSide;
  else if (upscale && longSide < MIN_SIDE) scale = Math.min(MAX_UPSCALE, MIN_SIDE / longSide);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

function nativeImage() {
  return require('electron').nativeImage;
}

function decode(buffer) {
  const img = nativeImage().createFromBuffer(buffer);
  return img.isEmpty() ? null : img;
}

function getSize(buffer) {
  try {
    const img = decode(buffer);
    return img ? img.getSize() : null;
  } catch {
    return null;
  }
}

function encode(img) {
  const png = img.toPNG();
  if (png.length <= SAFE_BYTES) return { buffer: png, mimeType: 'image/png' };
  return { buffer: img.toJPEG(85), mimeType: 'image/jpeg' };
}

function prepareForModel(buffer, mimeType) {
  if (buffer.length <= SAFE_BYTES) return { buffer, mimeType };
  let img = decode(buffer);
  if (!img) return { buffer, mimeType };
  const { width, height } = img.getSize();
  const scale = Math.min(1, LEGACY_MAX_SIDE / Math.max(width, height));
  if (scale < 1) img = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale) });
  return { buffer: img.toJPEG(85), mimeType: 'image/jpeg' };
}

function renderView(sourceBuffer, { rotation = 0, region } = {}) {
  let img = decode(sourceBuffer);
  if (!img) return { error: 'Format gambar ini belum bisa diputar atau dipotong (hanya PNG dan JPG). Simpan ulang sebagai PNG atau JPG.' };

  if (rotation) {
    const { width, height } = img.getSize();
    const r = rotateBitmap(img.toBitmap(), width, height, rotation);
    img = nativeImage().createFromBitmap(r.bitmap, { width: r.width, height: r.height });
  }

  const size = img.getSize();
  const reg = resolveRegion(region, size.width, size.height);
  if (reg.error) return { error: reg.error };
  if (!reg.full) img = img.crop({ x: reg.x, y: reg.y, width: reg.width, height: reg.height });

  const t = targetSize(reg.width, reg.height, { upscale: !reg.full });
  if (t.scale !== 1) img = img.resize({ width: t.width, height: t.height, quality: 'best' });

  const out = encode(img);
  return {
    ...out,
    width: t.width,
    height: t.height,
    sourceWidth: size.width,
    sourceHeight: size.height,
    region: { left: reg.left, top: reg.top, right: reg.right, bottom: reg.bottom },
  };
}

module.exports = {
  normalizeRotation, rotateBitmap, resolveRegion, targetSize,
  decode, getSize, prepareForModel, renderView,
  SAFE_BYTES, MAX_SIDE, MIN_SIDE,
};
