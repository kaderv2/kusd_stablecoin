// api/treasury.js
// Lists every asset in the treasury wallet with USD value + 24h change.
// Mirrors the (working) snapshot logic: non-throwing RPC, Jupiter as the
// primary price source, DexScreener for symbols/images/fallback. Never drops
// an asset just because a price source is missing it.
//
// Uses env RPC_URL (Helius). Override wallet with ?wallet= or env TREASURY_WALLET.

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

async function rpc(up, method, params) {
  try {
    const r = await fetch(up, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = await r.json();
    return j.result;
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  const UP = process.env.RPC_URL || 'https://solana-rpc.publicnode.com';
  const WALLET = (req.query && req.query.wallet) || process.env.TREASURY_WALLET ||
    'AMJv8nUiBsdHijwxYFLmg8eLoNs5N2oifXQQkQnRDCsG';
  const debug = { tokenAccounts: 0, priced: 0 };
  try {
    const [ta, ta22, bal] = await Promise.all([
      rpc(UP, 'getTokenAccountsByOwner', [WALLET, { programId: TOKEN_PROGRAM }, { encoding: 'jsonParsed' }]),
      rpc(UP, 'getTokenAccountsByOwner', [WALLET, { programId: TOKEN_2022 }, { encoding: 'jsonParsed' }]),
      rpc(UP, 'getBalance', [WALLET]),
    ]);
    const accounts = [...((ta && ta.value) || []), ...((ta22 && ta22.value) || [])];
    let holdings = accounts.map(a => {
      const info = a.account.data.parsed.info;
      return { mint: info.mint, amount: info.tokenAmount.uiAmount || 0 };
    }).filter(h => h.amount > 0);
    const solAmt = ((bal && bal.value) || 0) / 1e9;
    if (solAmt > 0) holdings.unshift({ mint: SOL_MINT, amount: solAmt });
    debug.tokenAccounts = holdings.length;

    const mints = [...new Set(holdings.map(h => h.mint))].slice(0, 40);

    // Jupiter price v3 (primary): usdPrice + priceChange24h, no key
    const jup = {};
    if (mints.length) {
      try {
        const jr = await (await fetch('https://lite-api.jup.ag/price/v3?ids=' + mints.join(','))).json();
        Object.keys(jr || {}).forEach(m => { if (jr[m]) jup[m] = jr[m]; });
      } catch (e) { /* ignore */ }
    }
    // DexScreener (symbols/images + fallback price/change)
    const ds = {};
    if (mints.length) {
      try {
        const dr = await (await fetch('https://api.dexscreener.com/tokens/v1/solana/' + mints.join(','))).json();
        (Array.isArray(dr) ? dr : []).forEach(p => {
          const m = p.baseToken && p.baseToken.address;
          if (!m) return;
          const liq = parseFloat((p.liquidity && p.liquidity.usd) || 0);
          if (!ds[m] || liq > ds[m]._liq) {
            ds[m] = { symbol: p.baseToken.symbol, name: p.baseToken.name, price: parseFloat(p.priceUsd || 0), change24h: parseFloat((p.priceChange && p.priceChange.h24) || 0), img: (p.info && p.info.imageUrl) || null, _liq: liq };
          }
        });
      } catch (e) { /* ignore */ }
    }

    const known = { [SOL_MINT]: 'SOL', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT' };

    let total = 0;
    holdings = holdings.map(h => {
      const j = jup[h.mint], d = ds[h.mint] || {};
      const price = (j && j.usdPrice) || d.price || 0;
      const change24h = (j && typeof j.priceChange24h === 'number') ? j.priceChange24h : (d.change24h || 0);
      const usdValue = h.amount * price;
      if (usdValue > 0) { total += usdValue; debug.priced++; }
      return { mint: h.mint, amount: h.amount, symbol: d.symbol || known[h.mint] || (h.mint.slice(0, 4) + '…'), price, usdValue, change24h, img: d.img || null };
    }).sort((a, b) => b.usdValue - a.usdValue);

    let change24h = 0;
    if (total > 0) holdings.forEach(h => { change24h += (h.usdValue / total) * h.change24h; });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    res.status(200).json({ wallet: WALLET, totalUsd: total, change24h, holdings, debug });
  } catch (err) {
    res.status(200).json({ wallet: WALLET, totalUsd: 0, change24h: 0, holdings: [], debug, error: String(err) });
  }
}
