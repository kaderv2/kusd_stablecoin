// api/treasury-history.js
// Returns the recorded daily treasury value history:
//   { series: [{date, value}, ...], configured }
// Reads the kusd:treasury hash that api/snapshot.js writes to.

function kv() {
  const e = process.env;
  const url = e.KV_REST_API_URL || e.UPSTASH_REDIS_REST_URL || e.REDIS_REST_API_URL ||
    (Object.keys(e).filter(k => /REST_API_URL$/.test(k) || /UPSTASH.*URL$/.test(k)).map(k => e[k])[0]);
  const token = e.KV_REST_API_TOKEN || e.UPSTASH_REDIS_REST_TOKEN || e.REDIS_REST_API_TOKEN ||
    (Object.keys(e).filter(k => /REST_API_TOKEN$/.test(k) || /UPSTASH.*TOKEN$/.test(k)).map(k => e[k])[0]);
  return { url, token };
}

export default async function handler(req, res) {
  const { url, token } = kv();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
  if (!url || !token) {
    res.status(200).json({ series: [], configured: false });
    return;
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(['HGETALL', 'kusd:treasury']),
    });
    const j = await r.json();
    const arr = (j && j.result) || [];
    const series = [];
    for (let i = 0; i < arr.length; i += 2) {
      series.push({ date: arr[i], value: parseFloat(arr[i + 1]) });
    }
    series.sort((a, b) => (a.date < b.date ? -1 : 1));
    res.status(200).json({ series, configured: true });
  } catch (err) {
    res.status(200).json({ series: [], configured: true, error: String(err) });
  }
}
