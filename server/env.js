// Minimal .env loader (no dependency).
// The README tells operators to create a .env file from .env.example, so the
// server must actually read it. Variables already present in the real
// environment always win — a .env file can never override secret-manager or
// systemd/PM2 values. Quoted values and `#` comments are supported.
const fs = require('fs');
const path = require('path');

function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

function loadEnv(file = path.join(__dirname, '..', '.env')) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { loaded: 0, file, missing: true }; }
  const parsed = parseEnv(text);
  let loaded = 0;
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) { process.env[key] = value; loaded++; }
  }
  return { loaded, file, missing: false };
}

module.exports = { loadEnv, parseEnv };
