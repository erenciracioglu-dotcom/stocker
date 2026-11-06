// Stocker anlık fiyat aracısı (Cloudflare Worker).
//
// Tarayıcı Yahoo Finance'e doğrudan soramıyor (Yahoo başka sitelere CORS izni vermiyor). Stocker sayfası açılınca
// ve yenile tuşuna basılınca buraya sorar; Worker o anki fiyatları Yahoo'nun herkese açık grafik uç noktasından
// alıp yalnız Stocker'ın adresine geri verir. Hiçbir şey saklamaz, yalnız okur.
//
//   GET /q?s=THYAO.IS,PYPD,USDTRY=X  -> { at, q: { SYM: { p, pc, t, d, o, h, l, v, ms, xs?, xp?, xt? } | { err } } }
//   GET /c?s=PYPD                    -> son 5 günün 15 dakikalık mumları (seans öncesi/sonrası dahil): { at, t, o, h, l, c, v }
//
// Alanların anlamı scripts/fetch_data.py'nin market.json'a yazdığıyla aynı:
//   p son fiyat (normal seans), pc önceki seansın kapanışı, t fiyatın zamanı (epoch sn), d seans günü (borsa saatiyle),
//   o/h/l/v seansın açılış/yüksek/düşük/hacmi, ms piyasa durumu (PRE/REGULAR/POST/CLOSED),
//   xs/xp/xt seans dışı fiyat (PRE ya da POST), fiyatı ve zamanı.

const ALLOWED = ['https://erenciracioglu-dotcom.github.io', 'http://127.0.0.1:*', 'http://localhost:*'];
const SYMBOL = /^[A-Za-z0-9.^=\-]{1,20}$/;
const MAX_SYMBOLS = 24;   // ücretsiz planda istek başına en çok 50 alt istek; sembol başına en çok 2 gerekir
const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const TTL_MS = 15_000;    // aynı Worker örneğinde art arda yenilemelerde Yahoo'ya tekrar sormamak için
const cache = new Map();  // yol -> { exp, val }

const allowed = (origin) => ALLOWED.some((a) => (a.endsWith('*') ? origin.startsWith(a.slice(0, -1)) : origin === a));

export default {
  async fetch(req) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const ok = allowed(origin);
    const cors = ok ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: ok ? 204 : 403, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    }
    if (req.method !== 'GET') return json({ error: 'yalnız GET' }, 405, cors);
    if (url.pathname === '/') return json({ ok: true, ad: 'stocker-fiyat' }, 200, cors);
    if (!ok) return json({ error: 'bu adresten izin yok' }, 403, cors);

    const syms = [...new Set((url.searchParams.get('s') || '').split(',').map((s) => s.trim()).filter((s) => SYMBOL.test(s)))];
    if (!syms.length) return json({ error: 'sembol yok' }, 400, cors);
    const now = Math.floor(Date.now() / 1000);
    try {
      if (url.pathname === '/q') {
        const q = {};
        await Promise.all(syms.slice(0, MAX_SYMBOLS).map(async (s) => {
          try { q[s] = await liveQuote(s, now); } catch (e) { q[s] = { err: String(e?.message || e).slice(0, 120) }; }
        }));
        return json({ at: now, q }, 200, cors);
      }
      if (url.pathname === '/c') return json({ at: now, ...bars(await chart(syms[0], '5d', '15m', true)) }, 200, cors);
    } catch (e) {
      return json({ error: String(e?.message || e).slice(0, 200) }, 502, cors);
    }
    return json({ error: 'bilinmeyen yol' }, 404, cors);
  },
};

// ---------------------------------------------------------------- fiyat

async function liveQuote(sym, now) {
  const r = await chart(sym, '5d', '1d', false);
  const m = r.meta || {};
  const tz = m.exchangeTimezoneName || 'UTC';
  const p = num(m.regularMarketPrice), t = m.regularMarketTime;
  if (p == null || !t) throw new Error('fiyat yok');
  const d = localDate(t, tz);
  // günlük mumlar: önceki seansın resmi kapanışı ve bu seansın açılışı buradan
  const ts = r.timestamp || [], k = r.indicators?.quote?.[0] || {};
  const days = [];
  for (let i = 0; i < ts.length; i++) {
    if (k.close?.[i] == null) continue;
    days.push({ d: localDate(ts[i], tz), o: k.open?.[i], h: k.high?.[i], l: k.low?.[i], c: k.close[i], v: k.volume?.[i] });
  }
  const prev = days.filter((x) => x.d < d).pop();
  const today = days.find((x) => x.d === d);
  const q = {
    p, t, d,
    pc: round(prev?.c) ?? round(m.chartPreviousClose),
    o: round(today?.o),
    h: round(m.regularMarketDayHigh) ?? round(today?.h),
    l: round(m.regularMarketDayLow) ?? round(today?.l),
    v: num(m.regularMarketVolume) ?? num(today?.v) ?? 0,
    ms: marketState(m.currentTradingPeriod, now),
  };
  // ABD hisse ve fonlarında normal seans dışındaysak seans öncesi/sonrası fiyatı gün içi mumlardan
  if (q.ms !== 'REGULAR' && tz === 'America/New_York' && /^(EQUITY|ETF)$/.test(m.instrumentType || '')) {
    try { Object.assign(q, extended(await chart(sym, '1d', '5m', true), p, tz, now)); } catch { /* seans dışı fiyat olmadan devam */ }
  }
  for (const key of Object.keys(q)) if (q[key] == null) delete q[key];
  return q;
}

/** fetch_data.py ile aynı kural: son mum normal seansın dışındaysa ve fiyattan farklıysa seans dışı fiyattır. */
function extended(r, p, tz, now) {
  const reg = r.meta?.currentTradingPeriod?.regular;
  const ts = r.timestamp || [], c = r.indicators?.quote?.[0]?.close || [];
  let i = ts.length - 1;
  while (i >= 0 && c[i] == null) i--;
  if (i < 0 || !reg) return {};
  const lt = ts[i], lc = c[i], mm = tod(lt, tz);
  const xs = mm >= tod(reg.end, tz) ? 'POST' : mm < tod(reg.start, tz) ? 'PRE' : null;
  if (xs && lc && p && Math.abs(lc / p - 1) > 0.0001 && now - lt < 4 * 86400) return { xs, xp: round(lc), xt: lt };
  return {};
}

function marketState(ctp, now) {
  for (const [name, key] of [['PRE', 'pre'], ['REGULAR', 'regular'], ['POST', 'post']]) {
    const w = ctp?.[key];
    if (w && w.start <= now && now < w.end) return name;
  }
  return 'CLOSED';
}

function bars(r) {
  const ts = r.timestamp || [], k = r.indicators?.quote?.[0] || {};
  const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
  for (let i = 0; i < ts.length; i++) {
    if (k.close?.[i] == null) continue;
    out.t.push(ts[i]);
    out.o.push(round(k.open?.[i] ?? k.close[i])); out.h.push(round(k.high?.[i] ?? k.close[i]));
    out.l.push(round(k.low?.[i] ?? k.close[i])); out.c.push(round(k.close[i])); out.v.push(k.volume?.[i] || 0);
  }
  return out;
}

// ---------------------------------------------------------------- Yahoo

async function chart(sym, range, interval, prepost) {
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=${prepost}`;
  const hit = cache.get(path);
  if (hit && hit.exp > Date.now()) return hit.val;
  let err = new Error('Yahoo yanıt vermedi');
  for (const host of HOSTS) {
    try {
      const res = await fetch(`https://${host}${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      const body = await res.json().catch(() => null);
      const r = body?.chart?.result?.[0];
      if (res.ok && r) {
        if (cache.size > 400) for (const [key, v] of cache) if (v.exp <= Date.now()) cache.delete(key);
        cache.set(path, { exp: Date.now() + TTL_MS, val: r });
        return r;
      }
      err = new Error(body?.chart?.error?.description || `Yahoo ${res.status}`);
      if (res.status === 404) break;  // sembol yok; öbür sunucuya sormaya gerek yok
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

// ---------------------------------------------------------------- yardımcılar

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const round = (x) => (num(x) == null ? null : Math.round(x * 1e6) / 1e6);
const dateFmt = new Map();
const timeFmt = new Map();

function localDate(sec, tz) {
  if (!dateFmt.has(tz)) dateFmt.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }));
  return dateFmt.get(tz).format(new Date(sec * 1000));
}

function tod(sec, tz) {
  if (!timeFmt.has(tz)) timeFmt.set(tz, new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  const [hh, mm] = timeFmt.get(tz).format(new Date(sec * 1000)).split(':').map(Number);
  return hh * 60 + mm;
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
