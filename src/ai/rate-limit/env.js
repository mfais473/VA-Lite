function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function envStatuses(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const list = String(raw).split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 500 && n <= 599);
  return list.length ? list : fallback;
}

module.exports = { envInt, envStatuses };
