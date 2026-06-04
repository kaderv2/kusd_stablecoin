// api/snapshot.js
// Runs daily (Vercel Cron, see vercel.json). Records two things into Redis:
//   kusd:revenue  -> that day's total 24h LP fees across all kUSD Orca pools
//   kusd:treasury -> that day's total USD value of the treasury wallet
// Both build real day-by-day history for the charts.
// Visit /api/snapshot?debug=1 to inspect what it found/stored.

const MINT = 'AL9GxUu8a4ZXVhnRqaqHLTB8nC2ugE5LN51kxpc8huSK';
const TREASURY = 'AMJv8nUiBsdHijwxYFLmg8eLoNs5N2oifXQQkQnRDCsG';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

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
async function rpc(up, method, params) {
  const r = await fetch(up, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await r.json()).result;
}

async function treasuryTotalUsd(up) {
  const [ta, ta22, bal] = await Promise.all([
    rpc(up, 'getTokenAccountsByOwner', [TREASURY, { programId: TOKEN_PROGRAM }, { encoding: 'jsonParsed' }]),
    rpc(up, 'getTokenAccountsByOwner', [TREASURY, { programId: TOKEN_2022 }, { encoding: 'jsonParsed' }]).catch(() => null),
    rpc(up, 'getBalance', [TREASURY]),
  ]);
  const accounts = [...((ta && ta.value) || []), ...((ta22 && ta22.value) || [])];
  let holdings = accounts.map(a => ({ mint: a.account.data.parsed.info.mint, amount: a.account.data.parsed.info.tokenAmount.uiAmount || 0 })).filter(h => h.amount > 0);
  const solAmt = ((bal && bal.value) || 0) / 1e9;
  if (solAmt > 0) holdings.unshift({ mint: SOL_MINT, amount: solAmt });
  const mints = [...new Set(holdings.map(h => h.mint))].slice(0, 40);
  const prices = {};
  if (mints.length) {
    try {
      const jr = await (await fetch('https://lite-api.jup.ag/price/v3?ids=' + mints.join(','))).json();
      Object.keys(jr || {}).forEach(m => { if (jr[m] && jr[m].usdPrice) prices[m] = jr[m].usdPrice; });
    } catch (e) { /* ignore */ }
  }
  let total = 0;
  holdings.forEach(h => { total += h.amount * (prices[h.mint] || 0); });
  return total;
}

export default async function handler(req, res) {
  const { url, token } = kv();
  const UP = process.env.RPC_URL || 'https://solana-rpc.publicnode.com';
  const envKeys = Object.keys(process.env).filter(k => /KV|UPSTASH|REDIS/.test(k));
  const date = new Date().toISOString().slice(0, 10);
  const out = { date, stored: false };
  try {
    // 1) Revenue: total 24h fees across kUSD pools
    let fees = 0, poolsCounted = 0;
    try {
      const j = await (await fetch('https://api.orca.so/v2/solana/pools/search?q=KUSD')).json();
      const pools = (j.data || []).filter(p => p.tokenMintA === MINT || p.tokenMintB === MINT);
      poolsCounted = pools.length;
      fees = pools.reduce((s, p) => s + parseFloat((p.stats && p.stats['24h'] && p.stats['24h'].fees) || 0), 0);
    } catch (e) { out.revenueError = String(e); }
    out.fees = fees; out.poolsCounted = poolsCounted;

    // 2) Treasury total USD value
    let treasury = 0;
    try { treasury = await treasuryTotalUsd(UP); } catch (e) { out.treasuryError = String(e); }
    out.treasury = treasury;

    if (url && token) {
      const w1 = await redis(['HSET', 'kusd:revenue', date, String(fees)]);
      const w2 = await redis(['HSET', 'kusd:treasury', date, String(treasury)]);
      out.stored = !!(w1 && w2);
      if (req.query && req.query.debug) out.writeResult = { revenue: w1, treasury: w2 };
    }
    res.setHeader('Cache-Control', 'no-store');
    if (req.query && req.query.debug) out.debug = { foundUrl: !!url, foundToken: !!token, kvEnvKeys: envKeys };
    res.status(200).json(out);
  } catch (err) {
    res.status(502).json({ error: 'snapshot_failed', detail: String(err), kvEnvKeys: envKeys });
  }
}
