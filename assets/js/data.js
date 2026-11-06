// Piyasa verisi iki kaynaktan gelir:
//  1. GitHub Actions'ın ürettiği statik JSON dosyaları: geçmiş, temel veriler, son kayıtlı fiyatlar (data/).
//  2. Anlık fiyatlar: sayfa açılınca ve yenile tuşunda Cloudflare'deki aracıdan (worker/) Yahoo Finance'in o anki
//     fiyatları. Kayıtlı fiyatın üstüne yazılır; hangisi daha yeniyse o kalır.
import { fileName, isNum } from './util.js';

const PAGES_DATA = 'https://erenciracioglu-dotcom.github.io/stocker/data/';
const LIVE = 'https://stocker-fiyat.fragrush-rooms.workers.dev';
const LIVE_BATCH = 24;        // aracı istek başına en çok 24 sembol alır
let base = new URL('./data/', location.href).href;
let market = null;
let marketAt = 0;
const files = new Map();      // url -> {at, gen, promise}
const listeners = new Set();
const liveQ = new Map();      // sembol -> anlık fiyat alanları (p, pc, t, d, o, h, l, v, ms, xs, xp, xt)
const liveBars = new Map();   // sembol -> {at, promise}: son 5 günün 15 dakikalık mumları
let liveAt = 0;               // son başarılı anlık fiyat alımının zamanı (ms)

export function onMarket(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getMarket() { return market; }
export function dataBase() { return base; }

async function getJSON(url, { fresh = false } = {}) {
  const res = await fetch(fresh ? `${url}?t=${Date.now()}` : url, { cache: fresh ? 'no-store' : 'default' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** market.json'u yükler; yerel kopyada veri yoksa Pages'teki canlı veriye düşer. */
export async function loadMarket({ force = false } = {}) {
  if (!force && market && Date.now() - marketAt < 60_000) return market;
  let m;
  try {
    m = await getJSON(base + 'market.json', { fresh: true });
  } catch (e) {
    if (base !== PAGES_DATA) {
      base = PAGES_DATA;
      m = await getJSON(base + 'market.json', { fresh: true });
    } else throw e;
  }
  const changed = !market || market.generated !== m.generated;
  market = m;
  marketAt = Date.now();
  applyLive();
  if (changed) for (const fn of listeners) { try { fn(market); } catch (err) { console.error(err); } }
  return market;
}

// ---------------------------------------------------------------- anlık fiyat

/** Son başarılı anlık fiyat alımının zamanı (ms); hiç alınamadıysa 0. */
export function liveTime() { return liveAt; }

/** Verilen semboller için o anki fiyatları aracıdan alır ve kayıtlı verinin üstüne yazar. */
export async function loadLive(symbols, { timeout = 8000 } = {}) {
  const list = [...new Set(symbols)].filter((s) => s && market?.quotes?.[s]);
  if (!list.length) return { ok: 0, fail: 0 };
  const batches = [];
  for (let i = 0; i < list.length; i += LIVE_BATCH) batches.push(list.slice(i, i + LIVE_BATCH));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let ok = 0, fail = 0;
  try {
    const results = await Promise.allSettled(batches.map(async (b) => {
      const res = await fetch(`${LIVE}/q?s=${b.map(encodeURIComponent).join(',')}`, { signal: ctl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    }));
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') { fail += batches[i].length; return; }
      for (const s of batches[i]) {
        const q = r.value?.q?.[s];
        if (q && isNum(q.p) && isNum(q.t)) { liveQ.set(s, q); ok++; } else fail++;
      }
    });
  } finally {
    clearTimeout(timer);
  }
  if (ok) { liveAt = Date.now(); applyLive(); }
  return { ok, fail };
}

/** Hisse sayfasının 1G/5G grafiği için son 5 günün 15 dakikalık mumları (seans dışı dahil); alınamazsa null. */
export function loadLiveBars(sym) {
  const hit = liveBars.get(sym);
  if (hit && Date.now() - hit.at < 60_000) return hit.promise;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  const promise = fetch(`${LIVE}/c?s=${encodeURIComponent(sym)}`, { signal: ctl.signal, cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
    .then((j) => (j?.t?.length ? j : null))
    .catch(() => { liveBars.delete(sym); return null; })
    .finally(() => clearTimeout(timer));
  liveBars.set(sym, { at: Date.now(), promise });
  return promise;
}

/** Yenile tuşunda gün içi mumlar da baştan alınsın. */
export function resetLiveBars() { liveBars.clear(); }

const DAY_FIELDS = new Set(['o', 'h', 'l', 'v']);

function applyLive() {
  const quotes = market?.quotes;
  if (!quotes) return;
  for (const [s, lq] of liveQ) {
    const q = quotes[s];
    if (!q) continue;
    if (isNum(q.t) && lq.t < q.t) continue;  // kayıtlı veri daha yeniyse ona dokunma
    const prevD = q.d;
    const newDay = lq.d && lq.d !== prevD;
    for (const k of ['p', 'pc', 't', 'd', 'o', 'h', 'l', 'v', 'ms']) {
      if (lq[k] != null) q[k] = lq[k];
      else if (newDay && DAY_FIELDS.has(k)) q[k] = null;  // önceki günün açılış/yüksek/düşük/hacmi taşınmasın
    }
    delete q.xs; delete q.xp; delete q.xt;
    if (lq.xs && isNum(lq.xp)) Object.assign(q, { xs: lq.xs, xp: lq.xp, xt: lq.xt });
    patchSpark(q, prevD);
    q.live = true;
  }
  const f = market.fx || (market.fx = {});
  for (const [pair, key] of [['USDTRY=X', 'USDTRY'], ['EURTRY=X', 'EURTRY'], ['EURUSD=X', 'EURUSD']]) {
    if (quotes[pair]?.live && isNum(quotes[pair].p)) f[key] = quotes[pair].p;
  }
}

/** Küçük çizgi grafiğin (sp) son noktasını anlık fiyatla günceller; yeni günse ekler. */
function patchSpark(q, prevD) {
  const sp = q.sp;
  if (!sp?.c?.length || !isNum(q.p) || !q.d) return;
  if (sp.t) {
    const n = sp.t.length - 1;
    if (sp.t[n] === q.d) sp.c[n] = q.p;
    else if (q.d > sp.t[n]) {
      // kayıtlı son nokta seans ortasında alınmış olabilir: resmi önceki kapanışla eşitle
      if (isNum(q.pc) && isNum(sp.c[n]) && Math.abs(sp.c[n] / q.pc - 1) < 0.05) sp.c[n] = q.pc;
      sp.t.push(q.d); sp.c.push(q.p);
    }
  } else if (prevD && q.d > prevD) {
    if (isNum(q.pc)) sp.c[sp.c.length - 1] = q.pc;
    sp.c.push(q.p);
    if (sp.c.length > 30) sp.c.shift();
  } else sp.c[sp.c.length - 1] = q.p;
}

function symbolFile(kind, sym) {
  const url = `${base}${kind}/${fileName(sym)}.json`;
  const gen = market?.generated || '';
  const hit = files.get(url);
  if (hit && hit.gen === gen) return hit.promise;
  const promise = getJSON(gen ? `${url}?v=${encodeURIComponent(gen)}` : url).catch((e) => { files.delete(url); throw e; });
  files.set(url, { gen, promise });
  return promise;
}

export const loadHistory = (sym) => symbolFile('history', sym);
export const loadIntraday = (sym) => symbolFile('intraday', sym);
export const loadFund = (sym) => symbolFile('fund', sym);

export function quote(sym) { return market?.quotes?.[sym] || null; }

export function hasData(sym) { return !!market?.quotes?.[sym]; }

/** Arama için sembol dizini. */
export function directory() {
  const q = market?.quotes || {};
  return Object.entries(q).map(([s, v]) => ({ s, n: v.n || s, ty: v.ty, cur: v.cur, ex: v.ex, g: v.g }));
}

// ---------------------------------------------------------------- kur

/** from para biriminden to'ya çevrim katsayısı (TRY üzerinden). */
export function fx(from, to) {
  if (!from || !to || from === to) return 1;
  const f = market?.fx || {};
  const inTRY = { TRY: 1, USD: f.USDTRY, EUR: f.EURTRY };
  if (inTRY[from] && inTRY[to]) return inTRY[from] / inTRY[to];
  return null;
}

/** Günlük USD/TRY serisini tarih -> kur haritası olarak verir (sp). */
export function fxSeries(pair = 'USDTRY=X') {
  const sp = market?.quotes?.[pair]?.sp;
  if (!sp?.t) return null;
  const m = new Map();
  sp.t.forEach((d, i) => m.set(d, sp.c[i]));
  return m;
}

// ---------------------------------------------------------------- piyasa saatleri

/** Borsa İstanbul ve ABD için basit durum: açık / kapalı, sonraki olay. Tatilleri bilmez. */
export function sessions(now = new Date()) {
  const out = [];
  const bist = market?.quotes?.['XU100.IS'];
  const us = market?.quotes?.['^GSPC'];
  out.push(sessionFor('BIST', 'Europe/Istanbul', [10, 0], [18, 10], now, bist?.ms));
  out.push(sessionFor('ABD', 'America/New_York', [9, 30], [16, 0], now, us?.ms, { pre: [4, 0], post: [20, 0] }));
  return out;
}

function partsIn(tz, d) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { wd: get('weekday'), h: +get('hour') % 24, m: +get('minute') };
}

function sessionFor(name, tz, open, close, now, ms, ext = {}) {
  const { wd, h, m } = partsIn(tz, now);
  const mins = h * 60 + m;
  const o = open[0] * 60 + open[1], c = close[0] * 60 + close[1];
  const weekend = wd === 'Sat' || wd === 'Sun';
  let state = 'closed';
  if (!weekend) {
    if (mins >= o && mins < c) state = 'open';
    else if (ext.pre && mins >= ext.pre[0] * 60 && mins < o) state = 'pre';
    else if (ext.post && mins >= c && mins < ext.post[0] * 60) state = 'post';
  }
  // Açılış saatini Türkiye saatine çevir
  const localOpen = toLocalTime(tz, open, now);
  const localClose = toLocalTime(tz, close, now);
  return { name, tz, state, weekend, open: localOpen, close: localClose, minsToOpen: weekend || mins >= c ? null : o - mins };
}

function toLocalTime(tz, [hh, mm], now) {
  // tz'deki hh:mm'nin Türkiye saatindeki karşılığı (aynı gün için yaklaşık)
  const p = partsIn(tz, now);
  const offsetMin = (now.getUTCHours() * 60 + now.getUTCMinutes()) - (p.h * 60 + p.m);
  const utcMin = hh * 60 + mm + offsetMin;
  const trMin = ((utcMin - now.getTimezoneOffset()) % 1440 + 1440) % 1440;  // tarayıcının yerel saati
  return `${String(Math.floor(trMin / 60)).padStart(2, '0')}:${String(trMin % 60).padStart(2, '0')}`;
}
