// api/snapshot.js
// Runs once a day (via Vercel Cron, see vercel.json). Fetches the current
// 24h LP fees across all kUSD Orca pools and records that day's total into
// a Redis hash, building a real daily revenue history over time.
//
// Storage: Upstash Redis REST API. Add the "Upstash for Redis" integration
// in your Vercel project (Storage tab) — it injects the env vars below.
// You can also hit /api/snapshot manually once to seed today's value.

const MINT = 'AL9GxUu8a4ZXVhnRqaqHLTB8nC2ugE5LN51kxpc8huSK';

function kv() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token };
}

async function redis(cmd) {
  const { url, token } = kv();
  if (!url || !token) return null;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  return r.json();
}

export default async function handler(req, res) {
  try {
    const j = await (await fetch('https://api.orca.so/v2/solana/pools/search?q=KUSD')).json();
    const pools = (j.data || []).filter(p => p.tokenMintA === MINT || p.tokenMintB === MINT);
    const fees = pools.reduce((s, p) => s + parseFloat((p.stats && p.stats['24h'] && p.stats['24h'].fees) || 0), 0);
    const date = new Date().toISOString().slice(0, 10);

    const { url, token } = kv();
    let stored = false;
    if (url && token) {
      await redis(['HSET', 'kusd:revenue', date, String(fees)]);
      stored = true;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ date, fees, stored });
  } catch (err) {
    res.status(502).json({ error: 'snapshot_failed', detail: String(err) });
  }
}
