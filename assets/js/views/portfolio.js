// Defter sayfası: özet, getiri grafiği (karşılaştırmalı), pozisyon tablosu, ağırlık ve sektör dağılımı.
import { h, add, fill, icon, money, pct, price, num, fmtDate, fmtDateLong, trend, isNum, daysUntil, todayISO } from '../util.js';
import * as store from '../store.js';
import * as data from '../data.js';
import { valuePortfolio, plSeries, sectorAlloc, dayBefore } from '../calc.js';
import { createChart, LWC, cssVar, devBar, segBar } from '../charts.js';
import { openPortfolioDialog, openPositionDialog, openTransferDialog } from './dialogs.js';

export const BENCHES = [
  { s: '^GSPC', n: 'S&P 500' },
  { s: '^IXIC', n: 'Nasdaq Bileşik' },
  { s: 'XBI', n: 'ABD biyoteknoloji (XBI)' },
  { s: 'XU100.IS', n: 'BIST 100' },
  { s: 'USDTRY=X', n: 'Dolar/TL' },
  { s: 'GRAM', n: 'Gram altın (TL)' },
  { s: 'GC=F', n: 'Altın, ons ($)' },
];

export const CAT_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const CAT_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const catColors = () => (document.documentElement.dataset.theme === 'dark' ? CAT_DARK : CAT_LIGHT);

const sortState = {};

function defaultBench(p) {
  if (p.currency === 'TRY') return 'XU100.IS';
  const qs = p.positions.map((x) => data.quote(x.symbol)).filter(Boolean);
  const health = qs.filter((q) => q.sec === 'Healthcare').length;
  return qs.length && health / qs.length >= 0.5 ? 'XBI' : '^GSPC';
}

export function renderPortfolio(id) {
  const p = store.get(id);
  const view = h('div.view');
  const cleanups = [];
  if (!p) {
    add(view, h('a.backlink', { href: '#/' }, icon('back', 16), 'Genel bakış'),
      h('section.panel.empty', h('h2', 'Bu defter bu cihazda yok'), h('p', 'Silinmiş olabilir ya da başka bir cihazda oluşturulmuş olabilir. Defterlerini taşımak için diğer cihazda "Başka cihaza taşı"yı kullan.'), h('a.btn', { href: '#/' }, 'Genel bakışa dön')));
    return { el: view };
  }
  const v = valuePortfolio(p);
  const cur = p.currency;
  view.style.setProperty('--acc', p.accent);

  // ---- başlık
  const menuList = h('div.menu-list', { hidden: true, role: 'menu' },
    h('button', { type: 'button', role: 'menuitem', onclick: () => { closeMenu(); openTransferDialog([p]); } }, icon('link', 16), 'Bu defteri başka cihaza taşı'),
    h('button', { type: 'button', role: 'menuitem', onclick: () => { closeMenu(); store.exportFile([p]); } }, icon('download', 16), 'Bu defteri dışa aktar'),
    h('button', { type: 'button', role: 'menuitem', onclick: () => { closeMenu(); store.move(p.id, -1); } }, icon('up', 16), 'Listede yukarı al'),
    h('button', { type: 'button', role: 'menuitem', onclick: () => { closeMenu(); store.move(p.id, 1); } }, icon('down', 16), 'Listede aşağı al'),
  );
  const menuBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Diğer işlemler', 'aria-haspopup': 'menu', onclick: (e) => { e.stopPropagation(); menuList.hidden = !menuList.hidden; } }, icon('more'));
  const closeMenu = () => { menuList.hidden = true; };
  document.addEventListener('click', closeMenu);
  cleanups.push(() => document.removeEventListener('click', closeMenu));

  const daysIn = -daysUntil(p.entryDate);
  add(view, 
    h('a.backlink', { href: '#/' }, icon('back', 16), 'Genel bakış'),
    h('header.ph',
      h('div.ph-top',
        h('div', { style: { display: 'grid', gap: '4px', minWidth: 0 } }, p.kicker ? h('div.kicker', p.kicker) : null, h('h1', p.title)),
        h('div.ph-actions',
          h('button.btn.primary', { type: 'button', onclick: () => openPositionDialog({ portfolioId: p.id }) }, icon('plus', 16), 'Hisse ekle'),
          h('button.btn', { type: 'button', onclick: () => openPortfolioDialog(p) }, icon('edit', 16), 'Düzenle'),
          h('div.menu', menuBtn, menuList))),
      p.description ? h('p.desc', p.description) : null),
  );

  // ---- özet
  view.appendChild(h('section.stats', { 'aria-label': 'Defter özeti' },
    stat('Değer', money(v.total, cur)),
    stat('Maliyet', money(v.cost, cur)),
    stat('Kâr/zarar', money(v.pl, cur, { sign: true }), pct(v.plPct), trend(v.pl)),
    stat('Günlük', money(v.dayChg, cur, { sign: true }), pct(v.dayPct), trend(v.dayChg)),
    stat('Nakit', money(v.cash, cur)),
    stat('Başlangıç', fmtDate(p.entryDate), daysIn > 0 ? `${daysIn} gün önce` : 'bugün')));

  if (v.missing.length) {
    view.appendChild(h('div.callout', icon('alert'), h('div.grow', `${v.missing.join(', ')} için fiyat yok; maliyet değeriyle hesaba katıldı.`), h('a.btn.small', { href: '#/ayarlar' }, 'Nasıl eklenir')));
  }

  // ---- getiri grafiği
  const st = store.settings();
  let bench = st.benchmarks?.[p.id] || defaultBench(p);
  const benchSel = h('select', { 'aria-label': 'Karşılaştırma', class: 'btn small', style: { paddingRight: '8px' } },
    ...BENCHES.map((b) => h('option', { value: b.s, selected: b.s === bench }, b.n)));
  const box = h('div.chart-box', { style: { height: '280px' } });
  const legend = h('div.chart-legend');
  const summary = h('p.note');
  benchSel.addEventListener('change', () => {
    bench = benchSel.value;
    store.setSetting('benchmarks', { ...(store.settings().benchmarks || {}), [p.id]: bench });
    drawPerf();
  });
  view.appendChild(h('section.chart-panel', { 'aria-label': 'Getiri' },
    h('div.panel-head', h('h2', 'Getiri, başlangıçtan bu yana'), h('span.spacer'), h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px', color: 'var(--muted)' } }, 'Karşılaştır', benchSel)),
    legend, box, summary));
  let chart = null;
  const drawPerf = async () => {
    box.classList.add('loading');
    try {
      const res = await perfData(p, bench);
      if (chart) { chart.remove(); chart = null; }
      fill(box);
      box.classList.remove('loading');
      if (!res.port.length) { box.appendChild(h('div.empty-chart', 'Getiri serisi için fiyat geçmişi henüz yok.')); return; }
      chart = createChart(box, { priceDigits: 1 });
      const acc = p.accent, gray = cssVar('--bench');
      const fmtP = (x) => pct(x / 100, { digits: 1 });
      const sb = res.bench.length ? chart.addSeries(LWC.LineSeries, { color: gray, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 4, priceFormat: { type: 'custom', formatter: fmtP } }) : null;
      const sp = chart.addSeries(LWC.LineSeries, { color: acc, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 4, priceFormat: { type: 'custom', formatter: fmtP } });
      sp.createPriceLine({ price: 0, color: cssVar('--rule-strong'), lineWidth: 1, lineStyle: LWC.LineStyle.Solid, axisLabelVisible: false });
      sp.setData(res.port);
      if (sb) sb.setData(res.bench);
      chart.timeScale().fitContent();
      const bName = BENCHES.find((b) => b.s === bench)?.n || bench;
      const showLegend = (pv, bv) => {
        fill(legend, 
          h('span', h('span.key', { style: { background: acc } }), 'Defter ', h('b', { class: trend(pv) }, isNum(pv) ? fmtP(pv) : '—')),
          sb ? h('span', h('span.key', { style: { background: gray } }), `${bName} `, h('b', { class: trend(bv) }, isNum(bv) ? fmtP(bv) : '—')) : null);
      };
      const lp = res.port[res.port.length - 1]?.value, lb = res.bench[res.bench.length - 1]?.value;
      showLegend(lp, lb);
      chart.subscribeCrosshairMove((param) => {
        if (!param.time) return showLegend(lp, lb);
        showLegend(param.seriesData.get(sp)?.value, sb ? param.seriesData.get(sb)?.value : null);
      });
      if (isNum(lp) && isNum(lb)) {
        const diff = lp - lb;
        summary.textContent = `Başlangıçtan bu yana defter ${fmtP(lp)}, ${bName} ${fmtP(lb)}. Defter karşılaştırmanın ${num(Math.abs(diff), 1)} puan ${diff >= 0 ? 'önünde' : 'gerisinde'}.${p.positions.some((x) => x.entryDate) ? ' Sonradan eklenen hisseler kendi alış tarihlerinden itibaren hesaba katılır.' : ''}`;
      } else summary.textContent = '';
    } catch (e) {
      console.error(e);
      box.classList.remove('loading');
      fill(box, h('div.empty-chart', 'Grafik verisi yüklenemedi.'));
    }
  };
  requestAnimationFrame(drawPerf);
  cleanups.push(() => chart?.remove());

  // ---- pozisyonlar
  view.appendChild(positionsPanel(p, v));

  // ---- dağılım
  view.appendChild(h('div.grid-2', weightsPanel(p, v), sectorsPanel(v)));

  // ---- notlar
  const noted = p.positions.filter((x) => x.note || x.events?.length);
  if (noted.length) {
    const ul = h('ul.kv');
    for (const x of noted) {
      const evs = (x.events || []).slice().sort((a, b) => a.date.localeCompare(b.date));
      ul.appendChild(h('li',
        h('a.k', { href: `#/s/${encodeURIComponent(x.symbol)}` }, x.ticker),
        h('span.v', evs.length ? `${evs.length} tarih` : ''),
        x.note ? h('div.x', x.note) : null,
        evs.length ? h('div.x', evs.map((e) => `${fmtDate(e.date)}: ${e.label}${e.date < todayISO() ? ' (geçti)' : ''}`).join(' · ')) : null));
    }
    view.appendChild(h('section.panel', h('div.panel-head', h('h2', 'Notlar ve tarihler')), ul));
  }

  return { el: view, cleanup: () => cleanups.forEach((f) => f()) };
}

function stat(k, v, v2, tr) {
  return h('div.stat', h('div.k', k), h('div.v', { class: `v ${tr || ''}` }, v), v2 ? h('div.v2', { class: `v2 ${tr || 'muted'}` }, v2) : null);
}

/** Günlük geçmişin son noktasını güncel fiyatla tamamlar. */
export function patchLast(series, q) {
  if (!q || !isNum(q.p) || !q.d || !series.t.length) return series;
  const t = series.t.slice(), c = series.c.slice();
  if (t[t.length - 1] === q.d) c[c.length - 1] = q.p;
  else if (q.d > t[t.length - 1]) { t.push(q.d); c.push(q.p); }
  return { ...series, t, c };
}

async function perfData(p, bench) {
  const syms = [...new Set(p.positions.map((x) => x.symbol))].filter((s) => data.hasData(s));
  const hists = await Promise.all(syms.map((s) => data.loadHistory(s).catch(() => null)));
  const map = {};
  syms.forEach((s, i) => {
    const hst = hists[i];
    if (!hst) return;
    const q = data.quote(s);
    map[s] = patchLast({ t: hst.t, c: hst.c, cur: q?.cur }, q);
  });
  const ser = plSeries(p, map);
  const port = [];
  if (ser.t.length) port.push({ time: dayBefore(ser.t[0]), value: 0 });
  ser.t.forEach((d, i) => port.push({ time: d, value: ser.cost[i] ? (100 * ser.pl[i]) / ser.cost[i] : 0 }));

  let benchPts = [];
  try {
    const b = await benchSeries(bench);
    const start = p.entryDate;
    let bi = b.t.findIndex((d) => d >= start);
    if (bi >= 0) {
      const base = b.t[bi] === start && isNum(b.o?.[bi]) ? b.o[bi] : b.c[Math.max(0, bi - 1)];
      if (base) {
        benchPts.push({ time: dayBefore(ser.t[0] || start), value: 0 });
        for (let i = bi; i < b.t.length; i++) if (isNum(b.c[i]) && b.t[i] > (benchPts[benchPts.length - 1]?.time || '')) benchPts.push({ time: b.t[i], value: 100 * (b.c[i] / base - 1) });
      }
    }
  } catch (e) { console.warn('karşılaştırma yok', e); benchPts = []; }
  return { port, bench: benchPts };
}

async function benchSeries(sym) {
  if (sym === 'GRAM') {
    const [g, f] = await Promise.all([data.loadHistory('GC=F'), data.loadHistory('USDTRY=X')]);
    const gq = patchLast({ t: g.t, c: g.c }, data.quote('GC=F'));
    const fq = patchLast({ t: f.t, c: f.c }, data.quote('USDTRY=X'));
    const fm = new Map(fq.t.map((d, i) => [d, fq.c[i]]));
    let lastFx = null;
    const fxDates = fq.t;
    let j = 0;
    const t = [], c = [], o = [];
    for (let i = 0; i < gq.t.length; i++) {
      const d = gq.t[i];
      while (j < fxDates.length && fxDates[j] <= d) { lastFx = fq.c[j]; j++; }
      const rate = fm.get(d) ?? lastFx;
      if (!isNum(rate) || !isNum(gq.c[i])) continue;
      t.push(d); c.push((gq.c[i] * rate) / 31.1035); o.push(isNum(g.o[i]) ? (g.o[i] * rate) / 31.1035 : null);
    }
    return { t, c, o };
  }
  const b = await data.loadHistory(sym);
  const q = data.quote(sym);
  const patched = patchLast({ t: b.t, c: b.c }, q);
  return { t: patched.t, c: patched.c, o: b.o };
}

function positionsPanel(p, v) {
  const cur = p.currency;
  const key = p.id;
  const state = sortState[key] || (sortState[key] = { by: 'value', dir: -1 });
  const cols = [
    { id: 'sym', label: 'Hisse', get: (r) => r.pos.ticker, str: true },
    { id: 'lots', label: 'Lot', get: (r) => r.lots, cls: 'hide-sm' },
    { id: 'entry', label: 'Giriş', get: (r) => r.entry, cls: 'hide-sm' },
    { id: 'price', label: 'Son', get: (r) => r.price, cls: 'hide-sm' },
    { id: 'day', label: 'Günlük', get: (r) => r.dayPct },
    { id: 'value', label: 'Değer', get: (r) => r.value ?? r.cost },
    { id: 'pl', label: 'Kâr/zarar', get: (r) => r.pl, cls: 'hide-sm' },
    { id: 'plPct', label: 'Getiri', get: (r) => r.plPct, cls: 'hide-sm' },
    { id: 'weight', label: 'Ağırlık', get: (r) => r.weight, cls: 'hide-sm' },
  ];
  const panel = h('section.panel', { 'aria-label': 'Pozisyonlar' });
  const draw = () => {
    const col = cols.find((c) => c.id === state.by) || cols[5];
    const rows = v.rows.map((r, i) => ({ r, i })).sort((a, b) => {
      const x = col.get(a.r), y = col.get(b.r);
      if (col.str) return state.dir * String(x).localeCompare(String(y), 'tr');
      return state.dir * ((isNum(x) ? x : -Infinity) - (isNum(y) ? y : -Infinity));
    });
    const maxAbs = Math.max(0.05, ...v.rows.map((r) => Math.abs(r.plPct || 0)));
    const thead = h('thead', h('tr', ...cols.map((c) => h('th', {
      class: c.cls, scope: 'col', 'aria-sort': state.by === c.id ? (state.dir > 0 ? 'ascending' : 'descending') : null, tabindex: '0',
      onclick: () => { if (state.by === c.id) state.dir *= -1; else { state.by = c.id; state.dir = c.str ? 1 : -1; } draw(); },
      onkeydown: (e) => { if (e.key === 'Enter') e.target.click(); },
    }, c.label, state.by === c.id ? (state.dir > 0 ? ' ↑' : ' ↓') : '')), h('th.act', { 'aria-label': 'İşlem' })));
    const tbody = h('tbody');
    for (const { r, i } of rows) {
      const q = r.q;
      tbody.appendChild(h('tr', { onclick: () => { location.hash = `#/s/${encodeURIComponent(r.pos.symbol)}`; } },
        h('td', h('span.sym', r.pos.ticker), h('span.nm.hide-sm', r.pos.name), h('span.nm.show-sm', price(r.price, cur), r.ext && Math.abs(r.ext.pct) >= 0.001 ? ` · ${r.ext.state === 'PRE' ? 'öncesi' : 'sonrası'} ${pct(r.ext.pct, { digits: 1 })}` : '')),
        h('td.hide-sm', num(r.lots, r.lots % 1 ? 2 : 0)),
        h('td.hide-sm', price(r.entry, cur)),
        h('td.hide-sm', price(r.price, cur), r.ext && Math.abs(r.ext.pct) >= 0.001 ? h('span.ext', `${r.ext.state === 'PRE' ? 'Öncesi' : 'Sonrası'} ${pct(r.ext.pct, { digits: 1 })}`) : null, r.missing ? h('span.ext', 'veri yok') : null),
        h('td', { class: trend(r.dayPct) }, pct(r.dayPct)),
        h('td', money(r.value ?? r.cost, cur), h('span.ext.show-sm', { class: `ext show-sm ${trend(r.plPct)}` }, pct(r.plPct))),
        h('td.hide-sm', { class: `hide-sm ${trend(r.pl)}` }, money(r.pl, cur, { sign: true })),
        h('td.hide-sm', h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '10px' } }, devBar(r.plPct, maxAbs, { w: 70 }), h('span', { class: trend(r.plPct), style: { minWidth: '62px', display: 'inline-block' } }, pct(r.plPct)))),
        h('td.hide-sm', pct(r.weight, { sign: false, digits: 1 })),
        h('td.act', h('button.icon-btn', { type: 'button', 'aria-label': `${r.pos.ticker} düzenle`, onclick: (e) => { e.stopPropagation(); openPositionDialog({ portfolioId: p.id, index: i }); } }, icon('edit', 16)))));
    }
    const tfoot = h('tfoot', h('tr',
      h('td', 'Toplam'), h('td.hide-sm'), h('td.hide-sm'), h('td.hide-sm'),
      h('td', { class: trend(v.dayPct) }, pct(v.dayPct)),
      h('td', money(v.value, cur), h('span.ext.show-sm', { class: `ext show-sm ${trend(v.plPct)}` }, pct(v.plPct))),
      h('td.hide-sm', { class: `hide-sm ${trend(v.pl)}` }, money(v.pl, cur, { sign: true })),
      h('td.hide-sm', { class: `hide-sm ${trend(v.plPct)}` }, pct(v.plPct)),
      h('td.hide-sm', v.cash > 0 ? `+ nakit ${money(v.cash, cur)}` : ''), h('td.act')));
    fill(panel, 
      h('div.panel-head', h('h2', 'Pozisyonlar'), h('span.sub', `${v.rows.length} hisse · sıralamak için başlığa dokun`), h('span.spacer'),
        h('button.btn.small', { type: 'button', onclick: () => openPositionDialog({ portfolioId: p.id }) }, icon('plus', 14), 'Hisse ekle')),
      v.rows.length ? h('div.tbl-wrap', h('table.tbl', thead, tbody, tfoot)) : h('p.note', 'Bu defterde henüz hisse yok. "Hisse ekle" ile başla.'));
  };
  draw();
  return panel;
}

function weightsPanel(p, v) {
  const rows = v.rows.slice().sort((a, b) => b.weight - a.weight);
  const top = rows.slice(0, 10);
  const rest = rows.slice(10);
  const ul = h('ul.weights');
  const max = Math.max(...top.map((r) => r.weight), v.total ? v.cash / v.total : 0, 0.01);
  const item = (label, w, href) => h('li',
    href ? h('a', { href, style: { textDecoration: 'none', fontWeight: 600 } }, label) : h('span', label),
    h('span.bar', h('span', { style: { width: `${(w / max) * 100}%` } })),
    h('span.w', pct(w, { sign: false, digits: 1 })));
  for (const r of top) ul.appendChild(item(r.pos.ticker, r.weight, `#/s/${encodeURIComponent(r.pos.symbol)}`));
  if (rest.length) ul.appendChild(item(`Diğer ${rest.length}`, rest.reduce((a, r) => a + r.weight, 0)));
  if (v.cash > 0 && v.total) ul.appendChild(item('Nakit', v.cash / v.total));
  return h('section.panel', h('div.panel-head', h('h2', 'Ağırlıklar'), h('span.sub', 'güncel değere göre')), v.rows.length ? ul : h('p.note', 'Hisse yok.'));
}

function sectorsPanel(v) {
  const parts = sectorAlloc(v);
  const colors = catColors();
  const panel = h('section.panel', h('div.panel-head', h('h2', 'Sektör dağılımı'), h('span.sub', 'pozisyonda yazan sektöre göre')));
  if (!parts.length) { panel.appendChild(h('p.note', 'Hisse yok.')); return panel; }
  const seg = segBar(parts, { colors, label: 'Sektör dağılımı' });
  // sarı dilimde koyu yazı
  seg.querySelectorAll('.seg').forEach((el, i) => { if (colors[i] === '#eda100' || colors[i] === '#c98500') el.firstChild.style.color = '#0b0b0b'; });
  panel.appendChild(seg);
  const folded = parts.find((x) => x.folded);
  if (folded) panel.appendChild(h('p.hint', { style: { marginTop: '8px' } }, `Diğer: ${folded.folded.join(', ')}`));
  return panel;
}
