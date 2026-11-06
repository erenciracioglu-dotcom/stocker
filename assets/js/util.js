// Biçimlendirme, DOM ve tarih yardımcıları

let NUM_LOCALE = 'tr-TR';
export function setNumberLocale(loc) { NUM_LOCALE = loc === 'en-US' ? 'en-US' : 'tr-TR'; nfCache.clear(); }
export function numberLocale() { return NUM_LOCALE; }

const nfCache = new Map();
function nf(opts) {
  const key = NUM_LOCALE + JSON.stringify(opts);
  let f = nfCache.get(key);
  if (!f) { f = new Intl.NumberFormat(NUM_LOCALE, opts); nfCache.set(key, f); }
  return f;
}
const MINUS = '−';
const fixMinus = (s) => s.replace(/-/g, MINUS);
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Fiyat basamakları: büyüklüğe göre. */
export function priceDigits(v) {
  const a = Math.abs(v);
  return a >= 1 ? 2 : a >= 0.1 ? 3 : 4;
}

export function num(v, digits = 2, { sign = false, min } = {}) {
  if (!isNum(v)) return '—';
  return fixMinus(nf({
    minimumFractionDigits: min ?? digits, maximumFractionDigits: digits,
    signDisplay: sign ? 'exceptZero' : 'auto',
  }).format(v));
}

export function money(v, cur = 'USD', { digits, sign = false, compact = false } = {}) {
  if (!isNum(v)) return '—';
  if (compact && Math.abs(v) >= 10000) {
    return fixMinus(nf({
      style: 'currency', currency: cur, notation: 'compact', maximumFractionDigits: 1,
      signDisplay: sign ? 'exceptZero' : 'auto',
    }).format(v));
  }
  const d = digits ?? (Math.abs(v) >= 100000 ? 0 : 2);
  return fixMinus(nf({
    style: 'currency', currency: cur, minimumFractionDigits: d, maximumFractionDigits: d,
    signDisplay: sign ? 'exceptZero' : 'auto',
  }).format(v));
}

export function price(v, cur) {
  if (!isNum(v)) return '—';
  return money(v, cur, { digits: priceDigits(v) });
}

/** v bir oran (0.031 = %3,1). */
export function pct(v, { digits = 2, sign = true } = {}) {
  if (!isNum(v)) return '—';
  return fixMinus(nf({
    style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits,
    signDisplay: sign ? 'exceptZero' : 'auto',
  }).format(v));
}

export function compact(v, { digits = 1, sign = false } = {}) {
  if (!isNum(v)) return '—';
  return fixMinus(nf({ notation: 'compact', maximumFractionDigits: digits, signDisplay: sign ? 'exceptZero' : 'auto' }).format(v));
}

export function moneyCompact(v, cur) { return money(v, cur, { compact: true }); }

export const curSymbol = (cur) => ({ USD: '$', TRY: '₺', EUR: '€', GBP: '£' }[cur] || cur || '');

export function trend(v) { return !isNum(v) || v === 0 ? 'flat' : v > 0 ? 'up' : 'down'; }

// ---------------------------------------------------------------- tarih

const dfCache = new Map();
function df(opts) {
  const key = JSON.stringify(opts);
  let f = dfCache.get(key);
  if (!f) { f = new Intl.DateTimeFormat('tr-TR', opts); dfCache.set(key, f); }
  return f;
}
export function toDate(x) {
  if (x instanceof Date) return x;
  if (typeof x === 'number') return new Date(x < 1e11 ? x * 1000 : x);
  if (typeof x === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(x)) { const [y, m, d] = x.split('-').map(Number); return new Date(y, m - 1, d); }
    return new Date(x);
  }
  return new Date(NaN);
}
export function fmtDate(x, { year = true, weekday = false } = {}) {
  const d = toDate(x);
  if (isNaN(d)) return '—';
  return df({ day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), ...(weekday ? { weekday: 'short' } : {}) }).format(d);
}
export function fmtDateLong(x) {
  const d = toDate(x);
  return isNaN(d) ? '—' : df({ day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}
export function fmtTime(x, tz) {
  const d = toDate(x);
  return isNaN(d) ? '—' : df({ hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }).format(d);
}
export function fmtDateTime(x) {
  const d = toDate(x);
  return isNaN(d) ? '—' : df({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}
export function ago(x) {
  const d = toDate(x);
  if (isNaN(d)) return '';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'az önce';
  if (s < 3600) return `${Math.round(s / 60)} dk önce`;
  if (s < 86400) return `${Math.round(s / 3600)} sa önce`;
  const days = Math.round(s / 86400);
  if (days === 1) return 'dün';
  if (days < 30) return `${days} gün önce`;
  return fmtDate(d);
}
export function daysUntil(iso) {
  const d = toDate(iso);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- DOM

/** h('div.class#id', {attrs}, ...children) — metinler textNode olarak eklenir (XSS güvenli). */
export function h(tag, attrs, ...kids) {
  let [name, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(name || 'div');
  for (const r of rest) {
    if (r[0] === '.') el.classList.add(r.slice(1));
    else if (r[0] === '#') el.id = r.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  if (attrs) setAttrs(el, attrs);
  append(el, kids);
  return el;
}
const SVGNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  append(el, kids);
  return el;
}
function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'open') el[k] = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
}
export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false || k === true) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function fileName(sym) { return String(sym).replace(/[^A-Za-z0-9.\-]/g, '_'); }

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Türkçe büyük/küçük harf duyarsız arama anahtarı. */
export function fold(str) {
  return String(str || '').toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

let toastHost;
export function toast(msg, { kind = 'info', ms = 3200 } = {}) {
  if (!toastHost) { toastHost = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastHost); }
  const t = h('div.toast', { class: `toast toast-${kind}` }, msg);
  toastHost.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms);
}

export function icon(name, size = 18) {
  const paths = ICONS[name] || '';
  const el = s('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon' });
  el.innerHTML = paths;
  return el;
}
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  up: '<path d="M7 14l5-5 5 5"/>',
  down: '<path d="M7 10l5 5 5-5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  alert: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',
  github: '<path d="M9 19c-4 1.3-4-2-6-2.5M15 21v-3.5a3 3 0 0 0-.9-2.4c3-.3 6-1.4 6-6.6a5 5 0 0 0-1.4-3.6 4.7 4.7 0 0 0-.1-3.6s-1.1-.3-3.6 1.4a12.4 12.4 0 0 0-6.5 0C6 1.2 4.9 1.5 4.9 1.5a4.7 4.7 0 0 0-.1 3.6A5 5 0 0 0 3.4 8.7c0 5.2 3 6.3 6 6.6a3 3 0 0 0-.9 2.4V21"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5z"/><path d="M14 3v5h5"/>',
};
