let source = null;

function setSource({ path, buffer, mimeType }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  source = { path: String(path || ''), buffer, mimeType: mimeType || 'image/png', rotation: 0 };
  return source;
}

function getSource() {
  return source;
}

function hasSource() {
  return source !== null;
}

function setRotation(degrees) {
  if (source) source.rotation = degrees;
}

function resetImageSession() {
  source = null;
}

module.exports = { setSource, getSource, hasSource, setRotation, resetImageSession };
