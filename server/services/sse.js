// Server-Sent Events bus — the realtime backbone.
// Event names mirror the realtime spec: vote_created, leader_vote_count_updated,
// leader_rank_changed, ad_purchased, anthem_purchased, activity_created, trending_updated.
const clients = new Set();
const clientsByIp = new Map();
const MAX_TOTAL_CLIENTS = 500;
const MAX_CLIENTS_PER_IP = 8;

function remove(res) {
  clearInterval(res.__glPing);
  if (!clients.delete(res)) return;
  const ip = res.__glIp || 'unknown';
  const n = (clientsByIp.get(ip) || 1) - 1;
  if (n > 0) clientsByIp.set(ip, n); else clientsByIp.delete(ip);
}

function handler(req, res) {
  const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
  if (clients.size >= MAX_TOTAL_CLIENTS || (clientsByIp.get(ip) || 0) >= MAX_CLIENTS_PER_IP) {
    return res.status(429).json({ error: 'stream_limit' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(':ok\n\n');
  res.__glIp = ip;
  clients.add(res);
  clientsByIp.set(ip, (clientsByIp.get(ip) || 0) + 1);
  res.__glPing = setInterval(() => {
    try { res.write(':ping\n\n'); } catch { remove(res); }
  }, 25000);
  req.on('close', () => remove(res));
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    try { c.write(payload); }
    catch { remove(c); }
  }
}

module.exports = { handler, broadcast, count: () => clients.size };
