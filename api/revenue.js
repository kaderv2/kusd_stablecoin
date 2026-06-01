// api/revenue.js
// Returns the recorded daily LP fee history as { series: [{date, fees}, ...] }.
// Reads from the same Upstash Redis hash that api/snapshot.js writes to.
// If storage isn't configured yet, returns an empty series and the front-end
// will just show today's live figure until the daily snapshots accumulate.

function kv() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token };
}

export default async function handler(req, res) {
  const { url, token } = kv();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (!url || !token) {
    res.status(200).json({ series: [] });
    return;
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(['HGETALL', 'kusd:revenue']),
    });
    const j = await r.json();
    const arr = (j && j.result) || [];
    const series = [];
    for (let i = 0; i < arr.length; i += 2) {
      series.push({ date: arr[i], fees: parseFloat(arr[i + 1]) });
    }
    series.sort((a, b) => (a.date < b.date ? -1 : 1));
    res.status(200).json({ series });
  } catch (err) {
    res.status(200).json({ series: [] });
  }
}
