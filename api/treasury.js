// api/treasury.js
// Returns every priced asset held by the treasury wallet, with USD value and
// 24h price change. Combines Solana RPC (balances) with DexScreener (prices +
// 24h change). Server-side, so no browser CORS issues.
//
// Override the default wallet by passing ?wallet=<address>, or set env
// TREASURY_WALLET. RPC upstream uses env RPC_URL (same as api/rpc.js).

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

async function rpc(upstream, method, params) {
  const r = await fetch(upstream, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  return j.result;
}

export default async function handler(req, res) {
  const UPSTREAM = process.env.RPC_URL || 'https://solana-rpc.publicnode.com';
  const WALLET = (req.query && req.query.wallet) || process.env.TREASURY_WALLET ||
    'AMJv8nUiBsdHijwxYFLmg8eLoNs5N2oifXQQkQnRDCsG';
  try {
    const [ta, ta22, bal] = await Promise.all([
      rpc(UPSTREAM, 'getTokenAccountsByOwner', [WALLET, { programId: TOKEN_PROGRAM }, { encoding: 'jsonParsed' }]),
      rpc(UPSTREAM, 'getTokenAccountsByOwner', [WALLET, { programId: TOKEN_2022 }, { encoding: 'jsonParsed' }]),
      rpc(UPSTREAM, 'getBalance', [WALLET]),
    ]);

    const accounts = [...((ta && ta.value) || []), ...((ta22 && ta22.value) || [])];
    let holdings = accounts.map(a => {
      const info = a.account.data.parsed.info;
      return { mint: info.mint, amount: info.tokenAmount.uiAmount || 0 };
    }).filter(h => h.amount > 0);

    const solAmt = ((bal && bal.value) || 0) / 1e9;
    if (solAmt > 0) holdings.unshift({ mint: SOL_MINT, amount: solAmt });

    const mints = [...new Set(holdings.map(h => h.mint))].slice(0, 30);

    // DexScreener: name/symbol/price/24h-change for all mints in one call
    const priceMap = {};
    if (mints.length) {
      try {
        const ds = await (await fetch('https://api.dexscreener.com/tokens/v1/solana/' + mints.join(','))).json();
        (Array.isArray(ds) ? ds : []).forEach(p => {
          const m = p.baseToken && p.baseToken.address;
          if (!m) return;
          const liq = parseFloat((p.liquidity && p.liquidity.usd) || 0);
          if (!priceMap[m] || liq > priceMap[m]._liq) {
            priceMap[m] = {
              symbol: p.baseToken.symbol,
              name: p.baseToken.name,
              price: parseFloat(p.priceUsd || 0),
              change24h: parseFloat((p.priceChange && p.priceChange.h24) || 0),
              img: (p.info && p.info.imageUrl) || null,
              _liq: liq,
            };
          }
        });
      } catch (e) { /* prices best-effort */ }
    }

    let total = 0;
    holdings = holdings.map(h => {
      const pm = priceMap[h.mint] || {};
      const price = pm.price || 0;
      const usdValue = h.amount * price;
      total += usdValue;
      return {
        mint: h.mint,
        amount: h.amount,
        symbol: pm.symbol || (h.mint.slice(0, 4) + '…'),
        name: pm.name || 'Unknown',
        price,
        usdValue,
        change24h: pm.change24h || 0,
        img: pm.img || null,
      };
    }).filter(h => h.usdValue > 0.0005).sort((a, b) => b.usdValue - a.usdValue);

    let change24h = 0;
    if (total > 0) holdings.forEach(h => { change24h += (h.usdValue / total) * h.change24h; });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    res.status(200).json({ wallet: WALLET, totalUsd: total, change24h, holdings });
  } catch (err) {
    res.status(502).json({ error: 'treasury_failed', detail: String(err) });
  }
}
