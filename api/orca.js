// api/orca.js
// Serverless proxy for the Orca pools API.
// Browsers block direct calls to api.orca.so (CORS). This runs server-side
// and adds the right headers so your front-end's fetch('/api/orca') works.
//
// Works on Vercel (place at /api/orca.js) and Netlify (with the redirect in
// netlify.toml below). The front-end already calls ORCA = '/api/orca'.

export default async function handler(req, res) {
  try {
    // Use the search endpoint so small/new kUSD pools are returned.
    // The generic /pools endpoint only returns high-volume pools.
    const upstream = await fetch('https://api.orca.so/v2/solana/pools/search?q=KUSD', {
      headers: { accept: 'application/json' },
    });
    const data = await upstream.text();

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(upstream.status).send(data);
  } catch (err) {
    res.status(502).json({ error: 'orca_proxy_failed', detail: String(err) });
  }
}
