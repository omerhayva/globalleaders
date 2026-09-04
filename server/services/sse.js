// Server-Sent Events bus — the realtime backbone.
// Event names mirror the realtime spec: vote_created, leader_vote_count_updated,
// leader_rank_changed, ad_purchased, anthem_purchased, activity_created, trending_updated.
const clients = new Set();

function handler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(':ok\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(':ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) { try { c.write(payload); } catch { clients.delete(c); } }
}

module.exports = { handler, broadcast, count: () => clients.size };
