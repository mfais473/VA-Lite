const session = require('./image-session');
const ops = require('./image-ops');

const NO_IMAGE = {
  success: false,
  error: 'Belum ada gambar yang dibuka di sesi ini. Panggil pick_source (kind image) dulu agar pengguna memilih gambarnya.',
};

function viewCurrent({ rotation, region } = {}) {
  const src = session.getSource();
  if (!src) return NO_IMAGE;

  let rot = src.rotation;
  if (rotation !== undefined && rotation !== null && String(rotation).trim() !== '') {
    rot = ops.normalizeRotation(rotation);
    if (rot === null) return { success: false, error: 'Putaran harus kelipatan 90 derajat (0, 90, 180, 270, atau -90)' };
  }

  let out;
  try {
    out = ops.renderView(src.buffer, { rotation: rot, region });
  } catch (err) {
    return { success: false, error: err.message };
  }

  if (out.error) {
    const untouched = rot === 0 && !hasRegion(region);
    if (!untouched) return { success: false, error: out.error };
    const plain = ops.prepareForModel(src.buffer, src.mimeType);
    return {
      success: true,
      path: src.path,
      imageBase64: plain.buffer.toString('base64'),
      imageMimeType: plain.mimeType,
      rotation: 0,
      message: 'Gambar dibaca ulang',
    };
  }

  session.setRotation(rot);
  return {
    success: true,
    path: src.path,
    imageBase64: out.buffer.toString('base64'),
    imageMimeType: out.mimeType,
    width: out.width,
    height: out.height,
    rotation: rot,
    region: out.region,
    message: `Gambar dibaca ulang (putaran ${rot} derajat, area ${fmt(out.region)})`,
  };
}

function hasRegion(region) {
  if (!region) return false;
  return ['left', 'top', 'right', 'bottom'].some((k) => region[k] !== undefined && region[k] !== null && String(region[k]).trim() !== '');
}

function fmt(r) {
  return `kiri ${r.left}%, atas ${r.top}%, kanan ${r.right}%, bawah ${r.bottom}%`;
}

module.exports = { viewCurrent, NO_IMAGE };
