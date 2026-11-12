function permissionOf(tool) {
  if (tool.alwaysConfirm) return 'confirm';
  const overrides = (process.env.VIA_AUTO_TOOLS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (overrides.includes(tool.name)) return 'auto';
  return tool.permission === 'auto' ? 'auto' : 'confirm';
}

module.exports = { permissionOf };
