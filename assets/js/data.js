// Piyasa verisi: GitHub Actions'ın her yarım saatte ürettiği statik JSON dosyalarını okur.
import { fileName } from './util.js';

const PAGES_DATA = 'https://erenciracioglu-dotcom.github.io/stocker/data/';
let base = new URL('./data/', location.href).href;
let market = null;
let marketAt = 0;
const files = new Map();      // url -> {at, gen, promise}
const listeners = new Set();

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
  if (changed) for (const fn of listeners) { try { fn(market); } catch (err) { console.error(err); } }
  return market;
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
