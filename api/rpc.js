// api/rpc.js
// Proxies Solana JSON-RPC server-side. The public RPC blocks/rate-limits
// browser requests, which is why supply, holders, liquidity and the tx feed
// were all blank. This runs server-side so those calls succeed.
//
// For best reliability, set an env var RPC_URL in your Vercel project to a
// free Helius or QuickNode endpoint (Settings -> Environment Variables).
// Defaults to a permissive public node if not set.

export default async function handler(req, res) {
  const UPSTREAM = process.env.RPC_URL || 'https://solana-rpc.publicnode.com';
  try {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const data = await upstream.text();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(upstream.status).send(data);
  } catch (err) {
    res.status(502).json({ error: 'rpc_proxy_failed', detail: String(err) });
  }
}
