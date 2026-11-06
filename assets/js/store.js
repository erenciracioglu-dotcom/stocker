// Portföylerin ve ayarların tarayıcıda saklanması; JSON içe/dışa aktarma; bağlantıyla taşıma.
// Dosya biçimi önceki Stocker uygulamasıyla aynıdır: { format: "stocker.portfolios", schemaVersion: 1, portfolios: [...] }
import { uuid, todayISO, download } from './util.js';

export const FORMAT = 'stocker.portfolios';
const KEY = 'stocker.v1.portfolios';
const SKEY = 'stocker.v1.settings';

export const ACCENTS = ['#4f5bd5', '#ff4d6d', '#a4612d', '#8b4f88', '#27738a', '#116b58', '#c2410c', '#0f766e', '#7c3aed', '#be123c', '#4d7c0f', '#1d4ed8'];

let portfolios = [];
const listeners = new Set();

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } }

// ---------------------------------------------------------------- normalizasyon

const n = (v, d = 0) => { const x = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : +v; return Number.isFinite(x) ? x : d; };

function normPosition(x) {
  if (!x || typeof x !== 'object') return null;
  const ticker = String(x.ticker || x.symbol || '').trim().toUpperCase();
  if (!ticker) return null;
  const symbol = String(x.symbol || ticker).trim().toUpperCase();
  return { ...x, ticker, symbol, name: x.name || ticker, sector: x.sector || 'Diğer', lots: n(x.lots), entryPrice: n(x.entryPrice), priceSource: x.priceSource || 'manual' };
}

export function normPortfolio(p) {
  if (!p || typeof p !== 'object') return null;
  const currency = String(p.currency || 'USD').toUpperCase();
  const positions = (Array.isArray(p.positions) ? p.positions : []).map(normPosition).filter(Boolean);
  return {
    ...p,
    id: String(p.id || uuid()),
    title: String(p.title || 'Adsız defter'),
    kicker: p.kicker ?? (currency === 'TRY' ? 'Yeni TL defteri' : `Yeni ${currency} defteri`),
    description: p.description ?? '',
    capital: n(p.capital, null) ?? capitalOf(positions, n(p.cash)),
    cash: n(p.cash),
    currency,
    locale: p.locale || (currency === 'TRY' ? 'tr-TR' : 'en-US'),
    entryDate: p.entryDate || todayISO(),
    accent: p.accent || ACCENTS[0],
    revision: n(p.revision, 1),
    updatedAt: p.updatedAt || new Date().toISOString(),
    positions,
  };
}

export function capitalOf(positions, cash = 0) {
  return positions.reduce((a, x) => a + n(x.lots) * n(x.entryPrice), 0) + n(cash);
}

// ---------------------------------------------------------------- saklama

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      const arr = Array.isArray(obj) ? obj : obj.portfolios;
      portfolios = (arr || []).map(normPortfolio).filter(Boolean);
    }
  } catch (e) {
    console.error('Portföyler okunamadı', e);
    portfolios = [];
  }
  return portfolios;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ format: FORMAT, schemaVersion: 1, savedAt: new Date().toISOString(), portfolios }));
  } catch (e) {
    console.error(e);
  }
}

export function list() { return portfolios; }
/** Örnek defter dışındaki defterler (dışa aktarma, taşıma ve toplamlar için). */
export function real() { return portfolios.filter((p) => !p.demo); }
export const isDemo = (p) => !!p?.demo;
export function get(id) { return portfolios.find((p) => p.id === id) || null; }

/** Değişen defteri kaydeder: revizyonu artırır, sermayeyi yeniden hesaplar. */
export function commit(p, { silent = false } = {}) {
  const fresh = normPortfolio(p);
  fresh.capital = capitalOf(fresh.positions, fresh.cash);
  fresh.revision = n(p.revision, 0) + 1;
  fresh.updatedAt = new Date().toISOString();
  const i = portfolios.findIndex((x) => x.id === fresh.id);
  if (i >= 0) portfolios[i] = fresh; else portfolios.push(fresh);
  persist();
  if (!silent) emit();
  return fresh;
}

export function remove(id) {
  portfolios = portfolios.filter((p) => p.id !== id);
  persist();
  emit();
}

export function move(id, dir) {
  const i = portfolios.findIndex((p) => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= portfolios.length) return;
  [portfolios[i], portfolios[j]] = [portfolios[j], portfolios[i]];
  persist();
  emit();
}

/** Örnek defteri revizyon artırmadan ekler. */
export function addDemo(p) {
  portfolios = portfolios.filter((x) => x.id !== p.id);
  portfolios.unshift(normPortfolio(p));
  persist();
  emit();
}

export function clearAll() {
  portfolios = [];
  persist();
  emit();
}

export function newPortfolio(currency = 'USD') {
  const used = new Set(portfolios.map((p) => p.accent));
  const accent = ACCENTS.find((a) => !used.has(a)) || ACCENTS[portfolios.length % ACCENTS.length];
  return normPortfolio({
    id: uuid(), title: '', kicker: currency === 'TRY' ? 'Yeni TL defteri' : `Yeni ${currency} defteri`,
    description: '', capital: 0, cash: 0, currency, entryDate: todayISO(), accent, revision: 0, positions: [],
  });
}

// ---------------------------------------------------------------- dışa / içe aktarma

export function exportObject(list = real()) {
  return { format: FORMAT, schemaVersion: 1, exportedAt: new Date().toISOString(), portfolios: JSON.parse(JSON.stringify(list)) };
}

export function exportFile(list = real()) {
  download(`portfoylerim-${todayISO()}.json`, JSON.stringify(exportObject(list), null, 2));
  setSetting('lastBackup', new Date().toISOString());
}

/** Metni çözümler. Tam dosya, yalnız dizi ya da tek defter kabul edilir. */
export function parseImport(text) {
  let obj;
  try { obj = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) {
    throw new Error('Dosya JSON olarak okunamadı. Stocker\'dan dışa aktarılmış bir .json dosyası seç.');
  }
  let arr;
  if (Array.isArray(obj)) arr = obj;
  else if (obj && Array.isArray(obj.portfolios)) {
    if (obj.format && obj.format !== FORMAT) throw new Error(`Bu dosyanın biçimi "${obj.format}"; Stocker "${FORMAT}" bekliyor.`);
    if (obj.schemaVersion && obj.schemaVersion > 1) throw new Error('Dosya daha yeni bir Stocker sürümünden; bu sürüm şema 1\'i okuyabiliyor.');
    arr = obj.portfolios;
  } else if (obj && Array.isArray(obj.positions)) arr = [obj];
  else throw new Error('Dosyada defter bulunamadı.');
  const list = arr.map(normPortfolio).filter(Boolean);
  if (!list.length) throw new Error('Dosyada defter bulunamadı.');
  return list;
}

function newerThan(a, b) {
  if (n(a.revision) !== n(b.revision)) return n(a.revision) > n(b.revision);
  return String(a.updatedAt || '') > String(b.updatedAt || '');
}

/** Her gelen defter için durum: yeni, daha yeni, daha eski, aynı. */
export function planImport(incoming) {
  return incoming.map((p) => {
    const cur = get(p.id);
    let status = 'new';
    if (cur) {
      if (JSON.stringify(cur.positions) === JSON.stringify(p.positions) && cur.title === p.title && n(cur.cash) === n(p.cash)) status = 'same';
      else status = newerThan(p, cur) ? 'newer' : 'older';
    }
    return { p, cur, status };
  });
}

/** mode: 'merge' yeni ve daha yeni olanları alır; 'replace' tüm listeyi gelenle değiştirir; 'all' eskileri de üzerine yazar. */
export function applyImport(incoming, mode = 'merge') {
  let added = 0, updated = 0, skipped = 0, demoRemoved = 0;
  // İlk gerçek içe aktarmada örnek defter kendiliğinden kalkar
  if (incoming.some((p) => !p.demo)) {
    const before = portfolios.length;
    portfolios = portfolios.filter((p) => !p.demo);
    demoRemoved = before - portfolios.length;
  }
  if (mode === 'replace') {
    portfolios = incoming.map(normPortfolio);
    added = portfolios.length;
  } else {
    for (const { p, cur, status } of planImport(incoming)) {
      if (!cur) { portfolios.push(p); added++; }
      else if (status === 'newer' || (mode === 'all' && status !== 'same')) { portfolios[portfolios.indexOf(cur)] = p; updated++; }
      else skipped++;
    }
  }
  persist();
  emit();
  return { added, updated, skipped, demoRemoved };
}

// ---------------------------------------------------------------- bağlantıyla taşıma (veri yalnız # sonrasında; sunucuya gitmez)

function b64urlEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encodePayload(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if ('CompressionStream' in window) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    return '1.' + b64urlEncode(buf);
  }
  return '0.' + b64urlEncode(bytes);
}

export async function decodePayload(str) {
  const [ver, data] = String(str).split('.', 2);
  if (!data) throw new Error('Bağlantı eksik ya da bozuk.');
  let bytes = b64urlDecode(data);
  if (ver === '1') {
    if (!('DecompressionStream' in window)) throw new Error('Bu tarayıcı sıkıştırılmış bağlantıyı açamıyor; dosya ile aktar.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function makeLink(list = real()) {
  const payload = await encodePayload(exportObject(list));
  const base = location.href.split('#')[0];
  return `${base}#/al?d=${payload}`;
}

// ---------------------------------------------------------------- ayarlar

const DEFAULTS = {
  theme: 'system',       // system | light | dark
  totalCur: 'TRY',       // genel bakıştaki toplamın para birimi
  numLocale: 'tr-TR',    // sayı biçimi
  benchmarks: {},        // defter id -> karşılaştırma sembolü
  gh: { owner: 'erenciracioglu-dotcom', repo: 'stocker', token: '' },
  lastBackup: null,
};
let settingsCache = null;

export function settings() {
  if (!settingsCache) {
    try { settingsCache = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SKEY) || '{}')) }; } catch { settingsCache = { ...DEFAULTS }; }
    settingsCache.gh = { ...DEFAULTS.gh, ...(settingsCache.gh || {}) };
  }
  return settingsCache;
}
export function setSetting(key, value) {
  const s = settings();
  s[key] = value;
  try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) { console.error(e); }
}
