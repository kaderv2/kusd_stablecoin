// api/snapshot.js
// Runs daily (Vercel Cron, see vercel.json). Records that day's total 24h LP
// fees across all kUSD Orca pools into a Redis hash, building real history.
// Auto-detects the Upstash/KV REST credentials regardless of the exact env
// var names Vercel injects. Visit /api/snapshot?debug=1 to see what it found.

const MINT = 'AL9GxUu8a4ZXVhnRqaqHLTB8nC2ugE5LN51kxpc8huSK';

function kv() {
  const e = process.env;
  const url = e.KV_REST_API_URL || e.UPSTASH_REDIS_REST_URL || e.REDIS_REST_API_URL ||
    (Object.keys(e).filter(k => /REST_API_URL$/.test(k) || /UPSTASH.*URL$/.test(k)).map(k => e[k])[0]);
  const token = e.KV_REST_API_TOKEN || e.UPSTASH_REDIS_REST_TOKEN || e.REDIS_REST_API_TOKEN ||
    (Object.keys(e).filter(k => /REST_API_TOKEN$/.test(k) || /UPSTASH.*TOKEN$/.test(k)).map(k => e[k])[0]);
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
  const { url, token } = kv();
  const envKeys = Object.keys(process.env).filter(k => /KV|UPSTASH|REDIS/.test(k));
  try {
    const j = await (await fetch('https://api.orca.so/v2/solana/pools/search?q=KUSD')).json();
    const pools = (j.data || []).filter(p => p.tokenMintA === MINT || p.tokenMintB === MINT);
    const fees = pools.reduce((s, p) => s + parseFloat((p.stats && p.stats['24h'] && p.stats['24h'].fees) || 0), 0);
    const date = new Date().toISOString().slice(0, 10);

    let stored = false, writeResult = null;
    if (url && token) {
      writeResult = await redis(['HSET', 'kusd:revenue', date, String(fees)]);
      stored = !!writeResult;
    }
    res.setHeader('Cache-Control', 'no-store');
    const body = { date, fees, poolsCounted: pools.length, stored };
    if (req.query && req.query.debug) {
      body.debug = { foundUrl: !!url, foundToken: !!token, kvEnvKeys: envKeys, writeResult };
    }
    res.status(200).json(body);
  } catch (err) {
    res.status(502).json({ error: 'snapshot_failed', detail: String(err), kvEnvKeys: envKeys });
  }
}
