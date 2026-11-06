// Stocker: yönlendirme, üst çubuk, arama, tema, otomatik yenileme.
import { h, fill, icon, toast, fmtTime, ago, setNumberLocale, fold } from './util.js';
import * as store from './store.js';
import * as data from './data.js';
import { renderDashboard } from './views/dashboard.js';
import { renderPortfolio } from './views/portfolio.js';
import { renderStock } from './views/stock.js';
import { renderSettings } from './views/settings.js';
import { importFromLink, importFile } from './views/dialogs.js';
import { seedDemoIfNeeded } from './demo.js';

const main = document.getElementById('main');
let current = null;

// ---------------------------------------------------------------- tema

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function isDark() {
  const t = store.settings().theme;
  return t === 'dark' || (t === 'system' && darkQuery.matches);
}
function applyTheme() {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111518' : '#e9edee');
  const btn = document.getElementById('theme');
  if (btn) { fill(btn, icon(dark ? 'sun' : 'moon')); btn.setAttribute('aria-label', dark ? 'Açık temaya geç' : 'Koyu temaya geç'); }
}

// ---------------------------------------------------------------- yönlendirme

function render({ keepScroll = false } = {}) {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = hash.split('?');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'al') {
    const payload = new URLSearchParams(qs || '').get('d');
    history.replaceState(null, '', location.pathname + location.search + '#/');
    if (payload) importFromLink(payload);
    parts.length = 0;
  }
  const y = window.scrollY;
  if (current?.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } }
  let res, title = 'Stocker';
  try {
    if (!parts.length) res = renderDashboard();
    else if (parts[0] === 'p' && parts[1]) { res = renderPortfolio(decodeURIComponent(parts[1])); title = `${store.get(decodeURIComponent(parts[1]))?.title || 'Defter'} · Stocker`; }
    else if (parts[0] === 's' && parts[1]) { res = renderStock(parts.slice(1).join('/')); title = `${decodeURIComponent(parts[1]).replace(/\.IS$/i, '')} · Stocker`; }
    else if (parts[0] === 'ayarlar') { res = renderSettings(); title = 'Ayarlar · Stocker'; }
    else res = renderDashboard();
  } catch (e) {
    console.error(e);
    res = { el: h('section.panel', h('h2', 'Bu sayfa açılamadı'), h('p.note', String(e?.message || e)), h('a.btn', { href: '#/', style: { marginTop: '12px' } }, 'Genel bakışa dön')) };
  }
  current = res;
  fill(main, res.el);
  document.title = title;
  window.scrollTo(0, keepScroll ? y : 0);
}

// ---------------------------------------------------------------- üst çubuk

function updateStamp() {
  const m = data.getMarket();
  const el = document.getElementById('updated');
  if (!el) return;
  fill(el, m?.generated ? h('span', { title: new Date(m.generated).toLocaleString('tr-TR') }, 'Veri ', h('b', fmtTime(m.generated)), ` · ${ago(m.generated)}`) : '');
}

async function refresh({ force = true, announce = false } = {}) {
  const btn = document.getElementById('refresh');
  btn?.classList.add('spin');
  try {
    const before = data.getMarket()?.generated;
    await data.loadMarket({ force });
    updateStamp();
    if (data.getMarket()?.generated !== before) render({ keepScroll: true });
    else if (announce) toast('Veri güncel; bir sonraki güncelleme yarım saat içinde');
  } catch (e) {
    if (announce) toast('Veri alınamadı. İnternet bağlantını kontrol et.', { kind: 'error' });
  } finally {
    btn?.classList.remove('spin');
  }
}

function setupSearch() {
  const input = document.getElementById('q');
  const list = document.getElementById('suggest');
  let items = [], active = -1;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const go = (href) => { close(); input.value = ''; input.blur(); location.hash = href; };
  const draw = () => {
    const raw = input.value.trim();
    const qf = fold(raw);
    if (!qf) { close(); return; }
    const ports = store.list().filter((p) => fold(p.title).includes(qf)).slice(0, 4).map((p) => ({ href: `#/p/${p.id}`, sym: p.title, nm: `${p.positions.length} hisse`, tag: 'Defter', acc: p.accent }));
    const held = new Set(store.list().flatMap((p) => p.positions.map((x) => x.symbol)));
    const dir = data.directory().map((x) => {
      const s = fold(x.s.replace(/\.IS$/, '')), n = fold(x.n);
      const score = s === qf ? 0 : s.startsWith(qf) ? 1 : n.startsWith(qf) ? 2 : s.includes(qf) ? 3 : n.includes(qf) ? 4 : 9;
      return { x, score: score + (held.has(x.s) ? -0.5 : 0) };
    }).filter((r) => r.score < 9).sort((a, b) => a.score - b.score).slice(0, 8)
      .map(({ x }) => ({ href: `#/s/${encodeURIComponent(x.s)}`, sym: x.s.replace(/\.IS$/, ''), nm: x.n, tag: held.has(x.s) ? 'Defterinde' : x.s.endsWith('.IS') ? 'BIST' : x.ty === 'INDEX' ? 'Endeks' : x.ty === 'ETF' ? 'ETF' : x.ty === 'CURRENCY' ? 'Döviz' : 'ABD' }));
    items = [...ports, ...dir];
    const typed = raw.toUpperCase().replace(/\s+/g, '');
    if (/^[A-Z0-9.^=\-]{1,12}$/.test(typed) && !dir.some((d) => d.sym === typed || d.sym === typed.replace(/\.IS$/, ''))) {
      items.push({ href: `#/s/${encodeURIComponent(typed)}`, sym: typed, nm: 'Sembol sayfasını aç', tag: '' });
    }
    active = items.length ? 0 : -1;
    fill(list, ...items.map((it, i) => h('li', { role: 'option', 'aria-selected': String(i === active) },
      h('a', { href: it.href, class: i === active ? 'active' : '', onclick: (e) => { e.preventDefault(); go(it.href); } },
        h('span.sym', it.acc ? { style: { borderLeft: `4px solid ${it.acc}`, paddingLeft: '8px' } } : null, it.sym), h('span.nm', it.nm), h('span.tag', it.tag)))));
    list.hidden = !items.length;
    input.setAttribute('aria-expanded', String(!list.hidden));
  };
  const highlight = () => list.querySelectorAll('a').forEach((a, i) => { a.classList.toggle('active', i === active); a.parentElement.setAttribute('aria-selected', String(i === active)); if (i === active) a.scrollIntoView({ block: 'nearest' }); });
  input.addEventListener('input', draw);
  input.addEventListener('focus', () => { if (input.value) draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) go(items[active].href); }
    else if (e.key === 'Escape') { close(); input.blur(); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]') && !document.querySelector('dialog[open]')) { e.preventDefault(); input.focus(); }
  });
}

function setupHeader() {
  document.getElementById('search-icon')?.replaceWith(icon('search', 17));
  document.getElementById('refresh').replaceChildren(icon('refresh'));
  document.getElementById('settings-link').replaceChildren(icon('settings'));
  document.getElementById('refresh').addEventListener('click', () => refresh({ announce: true }));
  document.getElementById('theme').addEventListener('click', () => {
    store.setSetting('theme', isDark() ? 'light' : 'dark');
    applyTheme();
    render({ keepScroll: true });
  });
  setupSearch();
}

// ---------------------------------------------------------------- açılış

async function boot() {
  store.load();
  setNumberLocale(store.settings().numLocale);
  applyTheme();
  setupHeader();
  window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (e.defaultPrevented) return;
    const f = e.dataTransfer?.files?.[0];
    if (f) { e.preventDefault(); importFile(f); }
  });
  try {
    await data.loadMarket();
  } catch (e) {
    console.warn(e);
    toast('Piyasa verisine ulaşılamadı; defterler maliyet değeriyle gösteriliyor.', { kind: 'error', ms: 6000 });
  }
  try { await seedDemoIfNeeded(); } catch (e) { console.warn('Örnek defter kurulamadı', e); }
  updateStamp();
  render();
  window.addEventListener('hashchange', () => render());
  store.onChange(() => render({ keepScroll: true }));
  window.addEventListener('stocker:rerender', () => render({ keepScroll: true }));
  window.addEventListener('stocker:settings', () => { setNumberLocale(store.settings().numLocale); applyTheme(); render({ keepScroll: true }); });
  darkQuery.addEventListener('change', () => { if (store.settings().theme === 'system') { applyTheme(); render({ keepScroll: true }); } });
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); updateStamp(); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh({ force: false }); });
}

boot();
