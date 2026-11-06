// Hisse sayfası: fiyat grafiği (göstergeli), teknik özet, temel veriler, mali tablolar, haberler, şirket profili.
import { h, fill, icon, money, pct, price, num, compact, fmtDate, fmtDateTime, fmtTime, ago, trend, isNum, priceDigits, todayISO, daysUntil } from '../util.js';
import * as store from '../store.js';
import * as data from '../data.js';
import * as ta from '../ta.js';
import { holdingsOf, trSector } from '../calc.js';
import { TA_TEXT, RISK_TEXT, FUND_TEXT, crossText, bigMoney } from '../explain.js';
import { createChart, LWC, cssVar, alpha, localOffsetSec, rangeBar, columns, epsDots, devBar } from '../charts.js';
import { openPositionDialog } from './dialogs.js';

const UI_KEY = 'stocker.v1.chart';
const ui = Object.assign(
  { range: '6A', type: 'line', ov: { sma20: false, sma50: true, sma200: true, bb: false }, pn: { vol: true, rsi: true, macd: false }, tab: 'teknik', freq: 'y' },
  (() => { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}'); } catch { return {}; } })(),
);
const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* yok say */ } };

const RANGES = [
  ['1G', '1 gün', 'intra1'], ['5G', '5 gün', 'intra5'], ['1A', '1 ay', 31], ['3A', '3 ay', 92], ['6A', '6 ay', 183],
  ['YB', 'Yılbaşından beri', 'ytd'], ['1Y', '1 yıl', 365], ['3Y', '3 yıl', 1096], ['5Y', '5 yıl', 1827], ['Tümü', 'Tüm veri', 'all'],
];
const TYPE_TR = { EQUITY: 'Hisse', ETF: 'Borsa yatırım fonu', INDEX: 'Endeks', CURRENCY: 'Döviz', FUTURE: 'Vadeli', MUTUALFUND: 'Fon', CRYPTOCURRENCY: 'Kripto' };
const EX_TR = { Istanbul: 'Borsa İstanbul', NasdaqGS: 'Nasdaq', NasdaqGM: 'Nasdaq', NasdaqCM: 'Nasdaq', NYSE: 'NYSE', NYSEArca: 'NYSE Arca', 'NYSE American': 'NYSE American', SNP: 'S&P', CCY: 'Döviz', COMEX: 'COMEX' };

export function renderStock(rawSym) {
  const sym = decodeURIComponent(rawSym).toUpperCase();
  const view = h('div.view');
  const cleanups = [];
  const q = data.quote(sym);
  const back = h('a.backlink', { href: '#/', onclick: (e) => { if (history.length > 1) { e.preventDefault(); history.back(); } } }, icon('back', 16), 'Geri');
  view.appendChild(back);
  if (!q) {
    view.appendChild(noData(sym));
    return { el: view };
  }
  const cur = q.cur || 'USD';
  const pd = priceDigits(q.p || 1);
  const ty = q.ty || 'EQUITY';
  const isEquity = ty === 'EQUITY';
  const display = sym.replace(/\.IS$/, '');

  // ---- başlık
  const chg = isNum(q.p) && isNum(q.pc) ? q.p - q.pc : null;
  const chgPct = chg != null && q.pc ? chg / q.pc : null;
  const stateText = { REGULAR: 'Piyasa açık', PRE: 'Seans öncesi', POST: 'Seans sonrası', CLOSED: 'Piyasa kapalı' }[q.ms] || '';
  const asof = q.t ? `${stateText} · son işlem ${fmtDateTime(q.t)}` : stateText;
  const held = holdingsOf(sym, store.list());
  view.appendChild(h('header.sh',
    h('div.sh-id',
      h('h1', display),
      h('div.nm', q.n || sym),
      h('div.tags',
        h('span.badge', EX_TR[q.ex] || q.ex || ''), h('span.badge', cur), h('span.badge', TYPE_TR[ty] || ty),
        q.sec ? h('span.badge', trSector(q.sec)) : null, q.ind ? h('span.badge', q.ind) : null,
        isNum(q.mc) ? h('span.badge', `Piyasa değeri ${bigMoney(q.mc, cur)}`) : null)),
    h('div.sh-px',
      h('div.readout', price(q.p, cur)),
      h('div.chg', { class: `chg ${trend(chg)}` }, `${chg != null ? money(chg, cur, { sign: true, digits: pd }) : ''}  ${pct(chgPct)}`),
      isNum(q.xp) ? h('div.ext', `${q.xs === 'PRE' ? 'Seans öncesi' : 'Kapanış sonrası'} ${price(q.xp, cur)} `, h('span', { class: trend(q.xp - q.p) }, pct(q.xp / q.p - 1)), q.xt ? ` · ${fmtDateTime(q.xt)}` : '') : null,
      h('div.asof', asof),
      isEquity || ty === 'ETF' ? h('div', { style: { marginTop: '10px' } }, h('button.btn.small', { type: 'button', onclick: () => openPositionDialog({ symbol: sym }) }, icon('plus', 14), held.length ? 'Bir deftere daha ekle' : 'Deftere ekle')) : null)));

  // ---- defterlerdeki pozisyonlar
  if (held.length) {
    const strip = h('div.holding-strip', { 'aria-label': 'Bu hisse defterlerinde' });
    let lots = 0, cost = 0, value = 0;
    for (const { p, pos, row } of held) {
      if (p.currency === cur) { lots += row.lots; cost += row.cost; value += row.value ?? row.cost; }
      strip.appendChild(h('a.holding', { href: `#/p/${p.id}`, style: { '--acc': p.accent } },
        h('span.spine'),
        h('span.t', p.title),
        h('span', h('span.v', `${num(row.lots, row.lots % 1 ? 2 : 0)} lot · ${price(pos.entryPrice, p.currency)}`), ' ', h('span', { class: trend(row.pl) }, `${money(row.pl, p.currency, { sign: true })} (${pct(row.plPct)})`))));
    }
    view.appendChild(strip);
    const evs = held.flatMap(({ pos }) => (pos.events || []).filter((e) => e.date >= todayISO())).sort((a, b) => a.date.localeCompare(b.date));
    const notes = [...new Set(held.map(({ pos }) => pos.note).filter(Boolean))];
    if (evs.length || notes.length) {
      view.appendChild(h('div.callout.info', icon('calendar'), h('div.grow',
        ...evs.map((e) => { const n = daysUntil(e.date); return h('div', h('b', fmtDate(e.date)), ` ${n === 0 ? 'bugün' : n === 1 ? 'yarın' : `${n} gün sonra`}: ${e.label}`); }),
        ...notes.map((t) => h('div.hint', t)))));
    }
    if (held.length > 1 && cost) {
      view.appendChild(h('p.note', `Toplam ${num(lots, lots % 1 ? 2 : 0)} lot, ortalama maliyet ${price(cost / lots, cur)}, değer ${money(value, cur)}, kâr/zarar `, h('span', { class: trend(value - cost) }, `${money(value - cost, cur, { sign: true })} (${pct(value / cost - 1)})`), '.'));
    }
  }

  // ---- grafik
  const box = h('div.chart-box.tall');
  const tip = h('div.chart-tip');
  const retEl = h('span.note');
  const rangeCtl = h('div.seg-ctl', { role: 'group', 'aria-label': 'Zaman aralığı', style: { overflowX: 'auto', maxWidth: '100%' } });
  const typeCtl = h('div.seg-ctl', { role: 'group', 'aria-label': 'Grafik türü' });
  const chips = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
  const chartPanel = h('section.chart-panel', { 'aria-label': 'Fiyat grafiği' },
    h('div.toolbar', rangeCtl, typeCtl, h('span.spacer'), retEl),
    h('div.toolbar', chips),
    h('div', { style: { position: 'relative' } }, tip, box));
  view.appendChild(chartPanel);

  // ---- sekmeler
  const tabs = [['teknik', 'Teknik'], ...(isEquity || ty === 'ETF' ? [['temel', 'Temel']] : []), ...(isEquity ? [['tablolar', 'Mali tablolar']] : []), ['haberler', 'Haberler'], ...(isEquity || ty === 'ETF' ? [['sirket', ty === 'ETF' ? 'Fon' : 'Şirket']] : [])];
  if (!tabs.find((t) => t[0] === ui.tab)) ui.tab = 'teknik';
  const tabBar = h('div.tabs', { role: 'tablist' });
  const tabBody = h('div', { role: 'tabpanel' });
  view.appendChild(h('section', tabBar, tabBody));

  const ctx = { sym, q, cur, pd, ty, isEquity, held, hist: null, intra: null, fund: null, daily: null, bench: null };
  let chart = null;

  const drawTabs = () => {
    fill(tabBar, ...tabs.map(([id, label]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(ui.tab === id),
      onclick: () => { ui.tab = id; saveUi(); drawTabs(); },
    }, label)));
    fill(tabBody);
    try {
      if (ui.tab === 'teknik') tabBody.appendChild(technicalTab(ctx));
      else if (ui.tab === 'temel') tabBody.appendChild(fundamentalsTab(ctx));
      else if (ui.tab === 'tablolar') tabBody.appendChild(statementsTab(ctx, drawTabs));
      else if (ui.tab === 'haberler') tabBody.appendChild(newsTab(ctx));
      else if (ui.tab === 'sirket') tabBody.appendChild(profileTab(ctx));
    } catch (e) {
      console.error(e);
      tabBody.appendChild(h('p.note', 'Bu bölüm gösterilemedi.'));
    }
  };

  const drawControls = () => {
    fill(rangeCtl, ...RANGES.map(([id, label]) => h('button', { type: 'button', title: label, 'aria-pressed': String(ui.range === id), onclick: () => { ui.range = id; saveUi(); drawControls(); drawChart(); } }, id)));
    fill(typeCtl, 
      h('button', { type: 'button', 'aria-pressed': String(ui.type === 'line'), onclick: () => { ui.type = 'line'; saveUi(); drawControls(); drawChart(); } }, 'Çizgi'),
      h('button', { type: 'button', 'aria-pressed': String(ui.type === 'candle'), onclick: () => { ui.type = 'candle'; saveUi(); drawControls(); drawChart(); } }, 'Mum'));
    const intraday = ui.range === '1G' || ui.range === '5G';
    const chip = (group, key, label, color) => h('button.chip', {
      type: 'button', 'aria-pressed': String(!!ui[group][key]), disabled: group === 'ov' && intraday,
      onclick: () => { ui[group][key] = !ui[group][key]; saveUi(); drawControls(); drawChart(); },
    }, color ? h('span.key', { style: { background: color } }) : null, label);
    fill(chips, 
      chip('ov', 'sma20', 'Ort. 20', cssVar('--s1')), chip('ov', 'sma50', 'Ort. 50', cssVar('--s2')), chip('ov', 'sma200', 'Ort. 200', cssVar('--s3')), chip('ov', 'bb', 'Bollinger', cssVar('--bench')),
      h('span', { style: { width: '10px' } }),
      chip('pn', 'vol', 'Hacim'), chip('pn', 'rsi', 'RSI'), chip('pn', 'macd', 'MACD'));
  };

  const drawChart = () => {
    if (chart) { chart.remove(); chart = null; }
    fill(box);
    const intraday = ui.range === '1G' || ui.range === '5G';
    const d = ctx.daily;
    if (!d || !d.t.length) { box.appendChild(h('div.empty-chart', 'Fiyat geçmişi yükleniyor…')); return; }
    if (intraday && !ctx.intra?.t?.length) { box.appendChild(h('div.empty-chart', 'Gün içi veri şu an alınamadı; yenile tuşuyla yeniden dene.')); retEl.textContent = ''; return; }
    chart = createChart(box, { intraday, priceDigits: pd });
    const up = cssVar('--up'), down = cssVar('--down'), ink = cssVar('--ink');
    let bars;
    if (intraday) {
      const it = ctx.intra;
      const off = localOffsetSec();
      let idx = it.t.map((_, i) => i).filter((i) => isNum(it.c[i]));
      if (ui.range === '1G') {
        const lastDay = new Date((it.t[idx[idx.length - 1]] + off) * 1000).toISOString().slice(0, 10);
        idx = idx.filter((i) => new Date((it.t[i] + off) * 1000).toISOString().slice(0, 10) === lastDay);
      }
      bars = idx.map((i) => ({ time: it.t[i] + off, open: it.o[i], high: it.h[i], low: it.l[i], close: it.c[i], volume: it.v[i] }));
    } else {
      bars = d.t.map((t, i) => ({ time: t, open: d.o[i] ?? d.c[i], high: d.h[i] ?? d.c[i], low: d.l[i] ?? d.c[i], close: d.c[i], volume: d.v[i] })).filter((b) => isNum(b.close));
    }
    const fmt = (v) => num(v, Math.abs(v) >= 1000 ? 0 : pd);
    const main = ui.type === 'candle'
      ? chart.addSeries(LWC.CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false, priceLineVisible: false, priceFormat: { type: 'custom', formatter: fmt } })
      : chart.addSeries(LWC.AreaSeries, { lineColor: ink, topColor: alpha(ink, 0.08), bottomColor: alpha(ink, 0), lineWidth: 2, priceLineVisible: false, crosshairMarkerRadius: 4, priceFormat: { type: 'custom', formatter: fmt } });
    main.setData(ui.type === 'candle' ? bars.map(({ volume, ...b }) => b) : bars.map((b) => ({ time: b.time, value: b.close })));
    const hasVol = ui.pn.vol && bars.some((b) => b.volume > 0);
    main.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.06 } });
    if (intraday && ui.range === '1G' && isNum(q.pc)) main.createPriceLine({ price: q.pc, color: cssVar('--rule-strong'), lineWidth: 1, lineStyle: LWC.LineStyle.Solid, axisLabelVisible: true, title: 'önceki kapanış' });

    // hareketli ortalamalar ve Bollinger (yalnız günlük)
    if (!intraday) {
      const line = (vals, color, w = 1.5) => {
        const s = chart.addSeries(LWC.LineSeries, { color, lineWidth: w, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: { type: 'custom', formatter: fmt } });
        s.setData(d.t.map((t, i) => (vals[i] == null ? null : { time: t, value: vals[i] })).filter(Boolean));
      };
      if (ui.ov.sma20) line(ta.sma(d.c, 20), cssVar('--s1'));
      if (ui.ov.sma50) line(ta.sma(d.c, 50), cssVar('--s2'));
      if (ui.ov.sma200) line(ta.sma(d.c, 200), cssVar('--s3'));
      if (ui.ov.bb) { const bb = ta.bollinger(d.c); line(bb.upper, cssVar('--bench'), 1); line(bb.lower, cssVar('--bench'), 1); }
    }
    let pane = 1;
    // hacim: kendi küçük panelinde (fiyat ekseni sıfırın altına uzamaz, etiketler çakışmaz)
    if (hasVol) {
      const vs = chart.addSeries(LWC.HistogramSeries, { priceFormat: { type: 'custom', formatter: (v) => compact(v) }, priceLineVisible: false, lastValueVisible: false }, pane);
      vs.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0 } });
      vs.setData(bars.map((b, i) => ({ time: b.time, value: b.volume || 0, color: alpha(i && b.close < bars[i - 1].close ? down : up, 0.45) })));
      chart.panes()[pane]?.setStretchFactor(0.16);
      pane++;
    }
    const closes = bars.map((b) => b.close);
    if (ui.pn.rsi) {
      const r = ta.rsi(closes);
      const rs = chart.addSeries(LWC.LineSeries, { color: cssVar('--s1'), lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, priceFormat: { type: 'custom', formatter: (v) => num(v, 0) } }, pane);
      rs.setData(bars.map((b, i) => (r[i] == null ? null : { time: b.time, value: r[i] })).filter(Boolean));
      for (const lvl of [70, 30]) rs.createPriceLine({ price: lvl, color: cssVar('--rule-strong'), lineWidth: 1, lineStyle: LWC.LineStyle.Solid, axisLabelVisible: false, title: String(lvl) });
      chart.panes()[pane]?.setStretchFactor(0.24);
      pane++;
    }
    if (ui.pn.macd) {
      const m = ta.macd(closes);
      const hs = chart.addSeries(LWC.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'custom', formatter: (v) => num(v, pd) } }, pane);
      hs.setData(bars.map((b, i) => (m.hist[i] == null ? null : { time: b.time, value: m.hist[i], color: alpha(m.hist[i] >= 0 ? up : down, 0.45) })).filter(Boolean));
      const ml = chart.addSeries(LWC.LineSeries, { color: cssVar('--s1'), lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane);
      ml.setData(bars.map((b, i) => (m.macd[i] == null ? null : { time: b.time, value: m.macd[i] })).filter(Boolean));
      const sl = chart.addSeries(LWC.LineSeries, { color: cssVar('--s2'), lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane);
      sl.setData(bars.map((b, i) => (m.signal[i] == null ? null : { time: b.time, value: m.signal[i] })).filter(Boolean));
      chart.panes()[pane]?.setStretchFactor(0.24);
      pane++;
    }
    chart.panes()[0]?.setStretchFactor(1);

    // görünür aralık
    let firstIdx = 0;
    const r = RANGES.find((x) => x[0] === ui.range);
    if (!intraday && r) {
      const lastT = d.t[d.t.length - 1];
      let from = null;
      if (typeof r[2] === 'number') from = new Date(new Date(lastT).getTime() - r[2] * 86400000).toISOString().slice(0, 10);
      else if (r[2] === 'ytd') from = `${lastT.slice(0, 4)}-01-01`;
      if (from) {
        firstIdx = Math.max(0, bars.findIndex((b) => b.time >= from));
        chart.timeScale().setVisibleRange({ from: bars[firstIdx].time, to: lastT });
      } else chart.timeScale().fitContent();
    } else chart.timeScale().fitContent();
    const baseIdx = intraday ? 0 : Math.max(0, firstIdx - 1);
    const base = intraday && ui.range === '1G' && isNum(q.pc) ? q.pc : bars[baseIdx]?.close;
    const lastClose = bars[bars.length - 1]?.close;
    if (isNum(base) && isNum(lastClose) && base) {
      const rr = lastClose / base - 1;
      fill(retEl, `${r ? r[1] : ''} değişim `, h('b', { class: trend(rr) }, pct(rr)));
    }

    // imleç bilgisi
    const showTip = (b, prev) => {
      if (!b) { fill(tip); return; }
      const c = b.close ?? b.value;
      const ch = prev && isNum(prev.close) ? c / prev.close - 1 : null;
      fill(tip, 
        h('span', typeof b.time === 'number' ? fmtDateTime((b.time - localOffsetSec()) * 1000) : fmtDate(b.time)),
        ui.type === 'candle' || intraday ? h('span', 'A ', h('b', fmt(b.open)), ' Y ', h('b', fmt(b.high)), ' D ', h('b', fmt(b.low))) : null,
        h('span', 'K ', h('b', fmt(c)), ch != null ? h('span', { class: trend(ch) }, ` ${pct(ch)}`) : null),
        b.volume ? h('span', 'Hacim ', h('b', compact(b.volume))) : null);
    };
    const byTime = new Map(bars.map((b, i) => [String(b.time), i]));
    showTip(bars[bars.length - 1], bars[bars.length - 2]);
    chart.subscribeCrosshairMove((param) => {
      if (!param.time) return showTip(bars[bars.length - 1], bars[bars.length - 2]);
      const t = typeof param.time === 'object' ? `${param.time.year}-${String(param.time.month).padStart(2, '0')}-${String(param.time.day).padStart(2, '0')}` : String(param.time);
      const i = byTime.get(t);
      if (i != null) showTip(bars[i], bars[i - 1]);
    });
  };

  drawControls();
  box.appendChild(h('div.empty-chart', 'Fiyat geçmişi yükleniyor…'));
  drawTabs();

  // izleme listesindeki bir hisseye açılışta anlık fiyat alınmadıysa şimdi al; gelince sayfa yenilenir
  if (!q.live) data.loadLive([sym]).then((r) => { if (r.ok && view.isConnected) window.dispatchEvent(new Event('stocker:rerender')); }).catch(() => {});

  (async () => {
    const [hist, intra, fund, liveIntra] = await Promise.all([
      data.loadHistory(sym).catch(() => null),
      data.loadIntraday(sym).catch(() => null),
      q.fund ? data.loadFund(sym).catch(() => null) : Promise.resolve(null),
      data.loadLiveBars(sym),
    ]);
    // gün içi grafik: aracıdan gelen güncel mumlar, alınamazsa kayıtlı olanlar
    ctx.hist = hist; ctx.intra = liveIntra || intra; ctx.fund = fund;
    ctx.daily = hist ? mergeToday(hist, q) : null;
    const benchSym = cur === 'TRY' ? 'XU100.IS' : '^GSPC';
    if (sym !== benchSym) ctx.bench = await data.loadHistory(benchSym).then((b) => ({ sym: benchSym, ...mergeToday(b, data.quote(benchSym)) })).catch(() => null);
    if (!view.isConnected) return;
    drawChart();
    drawTabs();
  })();

  cleanups.push(() => chart?.remove());
  return { el: view, cleanup: () => cleanups.forEach((f) => f()) };
}

export function mergeToday(hist, q) {
  const d = { t: hist.t.slice(), o: hist.o.slice(), h: hist.h.slice(), l: hist.l.slice(), c: hist.c.slice(), v: hist.v.slice() };
  if (!q || !isNum(q.p) || !q.d || !d.t.length) return d;
  const n = d.t.length - 1;
  if (d.t[n] === q.d) {
    d.c[n] = q.p;
    if (isNum(q.h)) d.h[n] = Math.max(d.h[n] ?? q.h, q.h, q.p);
    if (isNum(q.l)) d.l[n] = Math.min(d.l[n] ?? q.l, q.l, q.p);
    if (isNum(q.v)) d.v[n] = Math.max(d.v[n] || 0, q.v);
  } else if (q.d > d.t[n]) {
    d.t.push(q.d); d.o.push(q.o ?? q.p); d.h.push(Math.max(q.h ?? q.p, q.p)); d.l.push(Math.min(q.l ?? q.p, q.p)); d.c.push(q.p); d.v.push(q.v || 0);
  }
  // Yahoo bazı günleri eksik ya da gün içi son fiyatla verir; önceki seansı resmi önceki kapanışla eşitle
  const k = d.t.length - 2;
  if (k >= 0 && isNum(q.pc) && isNum(d.c[k]) && Math.abs(d.c[k] / q.pc - 1) > 0.0005 && Math.abs(d.c[k] / q.pc - 1) < 0.05) {
    d.c[k] = q.pc;
    if (isNum(d.h[k])) d.h[k] = Math.max(d.h[k], q.pc);
    if (isNum(d.l[k])) d.l[k] = Math.min(d.l[k], q.pc);
  }
  return d;
}

function noData(sym) {
  const { owner, repo } = store.settings().gh;
  const inPortfolios = store.list().some((p) => p.positions.some((x) => x.symbol === sym));
  return h('section.panel.empty',
    h('h2', `${sym} için veri yok`),
    h('p', inPortfolios
      ? 'Bu hisse defterlerinde var ama veri listesinde değil. Sembolü tickers.json dosyasındaki "portfolio" listesine ekleyince bir sonraki güncellemede (en geç yarım saat) fiyatları, grafiği ve temel verileri gelir.'
      : 'Sembol veri listesinde değil ya da yanlış yazılmış olabilir. Yahoo Finance kodunu kullan: ABD hisseleri yalın (ör. AAPL), Borsa İstanbul hisseleri .IS ekiyle (ör. THYAO.IS).'),
    h('div.row', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
      h('a.btn', { href: `https://github.com/${owner}/${repo}/edit/main/tickers.json`, target: '_blank', rel: 'noopener' }, icon('github', 16), 'tickers.json\'u düzenle'),
      h('a.btn.quiet', { href: '#/ayarlar' }, 'Veri ayarları')));
}

// ---------------------------------------------------------------- teknik

function sigTag(sig) {
  return h('span', { class: `sigtag ${sig > 0 ? 'buy' : sig < 0 ? 'sell' : 'neutral'}` }, sig > 0 ? 'Al' : sig < 0 ? 'Sat' : 'Nötr');
}

function gauge(title, score, count) {
  const v = ta.verdict(score);
  const idx = v.key + 2;
  return h('section.panel.gauge', { 'aria-label': `${title}: ${v.label}` },
    h('h3', title),
    h('div.gauge-verdict', { class: `gauge-verdict ${v.key > 0 ? 'up' : v.key < 0 ? 'down' : ''}` }, v.label),
    h('div.gauge-scale', ...[0, 1, 2, 3, 4].map((i) => h('span', { class: i === idx ? `on ${i > 2 ? 'buy' : i < 2 ? 'sell' : ''}` : '' }))),
    h('div.gauge-labels', h('span', 'Güçlü sat'), h('span', 'Sat'), h('span', 'Nötr'), h('span', 'Al'), h('span', 'Güçlü al')),
    h('div.gauge-counts', h('span', `Al ${count.buy}`), h('span', `Nötr ${count.neutral}`), h('span', `Sat ${count.sell}`)));
}

function technicalTab(ctx) {
  const wrap = h('div.view');
  const d = ctx.daily;
  if (!d) { wrap.appendChild(h('p.skeleton', 'Teknik veriler yükleniyor…')); return wrap; }
  if (d.c.filter(isNum).length < 30) { wrap.appendChild(h('p.note', 'Teknik göstergeler için en az 30 işlem günü gerekiyor.')); return wrap; }
  const sg = ta.signals(d);
  wrap.appendChild(h('div.summary-row',
    gauge('Genel teknik görünüm', sg.total, sg.count),
    gauge('Hareketli ortalamalar', sg.maScore, sg.maCount),
    gauge('Osilatörler', sg.oscScore, sg.oscCount)));

  const oscList = h('ul.kv');
  for (const o of sg.osc) {
    const valText = o.key === 'BB' ? (isNum(o.value) ? `%B ${num(o.value, 2)}` : '—') : o.key === 'MOM' ? num(o.value, ctx.pd) : o.key === 'MACD' ? num(o.value, ctx.pd) : num(o.value, 1);
    oscList.appendChild(h('li', h('span.k', o.name), h('span.v', valText, sigTag(o.sig)), h('div.x', TA_TEXT[o.key]?.(o.value, o.extra) || '')));
  }
  const maList = h('ul.kv');
  for (const m of sg.ma.filter((x) => x.key.startsWith('SMA'))) {
    const e = sg.ma.find((x) => x.key === m.key.replace('SMA', 'EMA'));
    maList.appendChild(h('li', h('span.k', `${m.key.replace('SMA', '')} günlük`), h('span.v', `${num(m.value, ctx.pd)}`, sigTag(m.sig)),
      h('div.x', `Basit ${num(m.value, ctx.pd)}${e ? `, üssel ${num(e.value, ctx.pd)} (${e.sig > 0 ? 'üstünde' : e.sig < 0 ? 'altında' : 'yakınında'})` : ''}. ${TA_TEXT.MA(m.sig)}`)));
  }
  const s50 = ta.last(ta.sma(d.c, 50)), s200 = ta.last(ta.sma(d.c, 200));
  const cross = crossText(s50, s200);
  wrap.appendChild(h('div.grid-2',
    h('section.panel', h('div.panel-head', h('h2', 'Göstergeler'), h('span.sub', 'günlük kapanışlarla')), oscList),
    h('section.panel', h('div.panel-head', h('h2', 'Hareketli ortalamalar'), h('span.sub', `fiyat ${num(sg.price, ctx.pd)}`)), cross ? h('p.note', { style: { marginBottom: '6px' } }, cross) : null, maList)));

  // getiri ve risk
  const R = (label, days) => ({ label, v: days === 'ytd' ? ta.ytdChange(d.t, d.c) : ta.changeSince(d.t, d.c, days) });
  const rets = [R('1 hafta', 7), R('1 ay', 30), R('3 ay', 91), R('6 ay', 182), R('Yılbaşı', 'ytd'), R('1 yıl', 365), R('3 yıl', 1095), R('5 yıl', 1826)];
  const vol = ta.volatility(d.c);
  const mdd = ta.maxDrawdown(d.c);
  const atrV = ta.last(ta.atr(d.h, d.l, d.c));
  const b = ctx.bench ? ta.beta(d.t, d.c, ctx.bench.t, ctx.bench.c) : null;
  const benchName = ctx.bench?.sym === 'XU100.IS' ? 'BIST 100' : 'S&P 500';
  const v20 = ta.sma(d.v, 20);
  const rvol = d.v[d.v.length - 1] && ta.prevOf(v20) ? d.v[d.v.length - 1] / ta.prevOf(v20) : null;
  const risk = h('ul.kv');
  if (isNum(vol)) risk.appendChild(h('li', h('span.k', 'Yıllık oynaklık'), h('span.v', pct(vol, { sign: false, digits: 0 })), h('div.x', RISK_TEXT.vol(vol))));
  if (mdd) risk.appendChild(h('li', h('span.k', 'En büyük düşüş (1 yıl)'), h('span.v.down', pct(mdd.mdd, { digits: 0 })), h('div.x', `${RISK_TEXT.mdd(mdd.mdd)} Şu an zirvenin ${pct(Math.abs(mdd.fromPeak), { sign: false, digits: 0 })} altında.`)));
  if (b?.beta != null) risk.appendChild(h('li', h('span.k', `Beta (${benchName}, 1 yıl)`), h('span.v', num(b.beta, 2)), h('div.x', RISK_TEXT.beta(b.beta, benchName))));
  if (isNum(atrV)) risk.appendChild(h('li', h('span.k', 'Günlük ortalama oynama (ATR 14)'), h('span.v', num(atrV, ctx.pd)), h('div.x', RISK_TEXT.atr(atrV, sg.price))));
  if (isNum(rvol)) risk.appendChild(h('li', h('span.k', 'Göreli hacim'), h('span.v', `${num(rvol, 1)}×`), h('div.x', RISK_TEXT.rvol(rvol))));

  // seviyeler
  const lo52 = Math.min(...d.l.slice(-252).filter(isNum)), hi52 = Math.max(...d.h.slice(-252).filter(isNum));
  const costMarks = ctx.held.filter((x) => x.p.currency === ctx.cur).map((x) => ({ v: x.pos.entryPrice, label: `${x.p.title} giriş`, kind: 'cost' }));
  const pv = ta.pivots(d.h.slice(0, -1), d.l.slice(0, -1), d.c.slice(0, -1));
  const levels = h('div', { style: { display: 'grid', gap: '12px' } },
    h('div', h('h3', '52 haftalık aralık'),
      rangeBar(Math.min(lo52, ...costMarks.map((m) => m.v)), Math.max(hi52, ...costMarks.map((m) => m.v)), [{ v: sg.price, label: 'Son fiyat' }, ...costMarks], { fmt: (x) => num(x, ctx.pd) }),
      h('div.range-legend', h('span', h('i'), 'son fiyat'), costMarks.length ? h('span', h('i', { style: { background: 'var(--s2)' } }), 'giriş fiyatın') : null),
      h('p.hint', { style: { marginTop: '6px' } }, `${RISK_TEXT.range52((sg.price - lo52) / (hi52 - lo52 || 1))} Dip ${num(lo52, ctx.pd)}, zirve ${num(hi52, ctx.pd)}.`)),
    pv ? h('div', h('h3', 'Pivot seviyeleri'), h('ul.kv', ...[['R2', pv.R2], ['R1', pv.R1], ['Pivot', pv.P], ['S1', pv.S1], ['S2', pv.S2]].map(([k, val]) => h('li', h('span.k', k), h('span.v', num(val, ctx.pd), h('span.muted', { style: { fontWeight: 420, marginLeft: '8px', fontSize: '12.5px' } }, pct(val / sg.price - 1, { digits: 1 })))))), h('p.hint', RISK_TEXT.pivots)) : null);

  const retGrid = h('div.returns', ...rets.map((x) => h('div', h('div.k', x.label), h('div.v', { class: `v ${trend(x.v)}` }, isNum(x.v) ? pct(x.v, { digits: Math.abs(x.v) >= 1 ? 0 : 1 }) : '—'))));
  wrap.appendChild(h('div.grid-2',
    h('section.panel', h('div.panel-head', h('h2', 'Getiri ve risk')), retGrid, risk),
    h('section.panel', h('div.panel-head', h('h2', 'Seviyeler')), levels)));
  wrap.appendChild(h('p.hint', 'Göstergeler geçmiş fiyatlardan mekanik olarak hesaplanır; gelecek hakkında kesinlik taşımaz ve yatırım tavsiyesi değildir. Özellikle haber akışına bağlı hisselerde (ör. FDA kararı beklenen biyotekler) teknik sinyaller kolayca boşa çıkar.'));
  return wrap;
}

// ---------------------------------------------------------------- temel

function fundamentalsTab(ctx) {
  const wrap = h('div.view');
  const f = ctx.fund;
  if (!f) {
    wrap.appendChild(h('p.note', ctx.q.fund === false ? 'Bu sembolün temel verileri henüz toplanmadı; en geç birkaç güncelleme sonra gelir.' : 'Temel veriler yükleniyor…'));
    return wrap;
  }
  const st = f.stats || {};
  const prof = f.profile || {};
  const fcur = prof.financialCurrency || ctx.cur;
  const qcur = ctx.cur;
  const row = (label, value, text, cls) => (value == null || value === '—' ? null : h('li', h('span.k', label), h('span.v', { class: `v ${cls || ''}` }, value), text ? h('div.x', text) : null));
  const sec = (title, sub, ...rows) => {
    const items = rows.flat().filter(Boolean);
    return items.length ? h('section.panel', h('div.panel-head', h('h2', title), sub ? h('span.sub', sub) : null), h('ul.kv', ...items)) : null;
  };
  const r2 = (v) => (isNum(v) ? num(v, 2) : null);
  const pc = (v, d = 1) => (isNum(v) ? pct(v, { sign: false, digits: d }) : null);
  const pcs = (v, d = 0) => (isNum(v) ? pct(v, { digits: d }) : null);

  if (ctx.ty === 'ETF') {
    wrap.appendChild(h('div.fund-grid',
      sec('Fon bilgileri', null,
        row('Toplam varlık', isNum(st.totalAssets) ? bigMoney(st.totalAssets, qcur) : null),
        row('Yıllık gider oranı', isNum(st.netExpenseRatio) ? pct(st.netExpenseRatio / 100, { sign: false, digits: 2 }) : null, 'Fonun yönetim için her yıl varlıklarından aldığı pay.'),
        row('Getiri (temettü)', isNum(st.yield) ? pct(st.yield, { sign: false }) : null),
        row('Yılbaşından beri', isNum(st.ytdReturn) ? pct(st.ytdReturn / 100) : null),
        row('3 yıllık ortalama getiri', isNum(st.threeYearAverageReturn) ? pct(st.threeYearAverageReturn) : null),
        row('Kategori', prof.category || null),
        row('Fon ailesi', prof.fundFamily || null))));
    return wrap;
  }

  const mc = isNum(st.marketCap) ? st.marketCap : ctx.q.mc;
  const peg = isNum(st.pegRatio) ? st.pegRatio : st.trailingPegRatio;
  let divY = st.dividendYield;
  if (isNum(divY) && divY > 0.2) divY = divY / 100;  // Yahoo bazen yüzde olarak verir
  if (!isNum(divY) || divY === 0) divY = isNum(st.trailingAnnualDividendYield) ? st.trailingAnnualDividendYield : divY;
  const burn = isNum(st.operatingCashflow) && st.operatingCashflow < 0 ? -st.operatingCashflow : isNum(st.freeCashflow) && st.freeCashflow < 0 ? -st.freeCashflow : null;
  const lossMaking = (isNum(st.netIncomeToCommon) && st.netIncomeToCommon < 0) || (isNum(st.trailingEps) && st.trailingEps < 0);
  const runway = lossMaking && burn && isNum(st.totalCash) ? (st.totalCash / burn) * 12 : null;
  const bsDate = f.bs?.q?.d?.[f.bs.q.d.length - 1] || f.bs?.y?.d?.[f.bs.y.d.length - 1];

  const valuation = sec('Değerleme', `fiyat ${qcur}`,
    row('Piyasa değeri', isNum(mc) ? bigMoney(mc, qcur) : null, FUND_TEXT.marketCap(mc)),
    row('Firma değeri', isNum(st.enterpriseValue) ? bigMoney(st.enterpriseValue, qcur) : null, FUND_TEXT.enterpriseValue()),
    row('F/K (son 12 ay)', isNum(st.trailingPE) ? r2(st.trailingPE) : (isNum(st.trailingEps) && st.trailingEps < 0 ? 'zarar' : null), FUND_TEXT.trailingPE(st.trailingPE ?? -1)),
    row('İleri F/K', r2(st.forwardPE), isNum(st.forwardPE) ? FUND_TEXT.forwardPE(st.forwardPE) : null),
    row('PEG', isNum(peg) && peg > 0 ? r2(peg) : null, isNum(peg) ? FUND_TEXT.pegRatio(peg) : null),
    row('PD/DD', r2(st.priceToBook), isNum(st.priceToBook) ? FUND_TEXT.priceToBook(st.priceToBook) : null),
    row('Fiyat/satış', r2(st.priceToSalesTrailing12Months), isNum(st.priceToSalesTrailing12Months) ? FUND_TEXT.priceToSalesTrailing12Months(st.priceToSalesTrailing12Months) : null),
    row('FD/FAVÖK', r2(st.enterpriseToEbitda), isNum(st.enterpriseToEbitda) ? FUND_TEXT.enterpriseToEbitda(st.enterpriseToEbitda) : null));

  const hasRevenue = isNum(st.totalRevenue) && st.totalRevenue > 0;
  const profitability = sec('Kârlılık ve büyüme', null,
    hasRevenue && st.grossMargins ? row('Brüt marj', pc(st.grossMargins, 1), isNum(st.grossMargins) ? FUND_TEXT.grossMargins(st.grossMargins) : null) : null,
    hasRevenue ? row('Faaliyet marjı', pc(st.operatingMargins, 1), isNum(st.operatingMargins) ? FUND_TEXT.operatingMargins(st.operatingMargins) : null, trend(st.operatingMargins)) : null,
    hasRevenue ? row('Net marj', pc(st.profitMargins, 1), isNum(st.profitMargins) ? FUND_TEXT.profitMargins(st.profitMargins) : null, trend(st.profitMargins)) : null,
    row('Özsermaye kârlılığı', pc(st.returnOnEquity, 1), isNum(st.returnOnEquity) ? FUND_TEXT.returnOnEquity(st.returnOnEquity) : null, trend(st.returnOnEquity)),
    row('Aktif kârlılığı', pc(st.returnOnAssets, 1), isNum(st.returnOnAssets) ? FUND_TEXT.returnOnAssets(st.returnOnAssets) : null, trend(st.returnOnAssets)),
    row('Satış büyümesi (yıllık)', pcs(st.revenueGrowth), isNum(st.revenueGrowth) ? FUND_TEXT.revenueGrowth(st.revenueGrowth) : null, trend(st.revenueGrowth)),
    row('Kâr büyümesi (yıllık)', pcs(st.earningsGrowth), isNum(st.earningsGrowth) ? FUND_TEXT.earningsGrowth(st.earningsGrowth) : null, trend(st.earningsGrowth)),
    row('Hisse başına kâr (12 ay)', isNum(st.trailingEps) ? num(st.trailingEps, 2) : null, isNum(st.trailingEps) ? FUND_TEXT.trailingEps(st.trailingEps) : null, trend(st.trailingEps)),
    !hasRevenue ? row('Satış', 'henüz yok', 'Şirketin kayda değer satış geliri yok; değeri büyük ölçüde gelecekteki ürünlerine (ör. onay bekleyen ilaçlarına) bağlı.') : null);

  const balance = sec('Bilanço ve nakit', fcur !== qcur ? `tablolar ${fcur}` : null,
    row(bsDate ? `Nakit (${fmtDate(bsDate)})` : 'Nakit', isNum(st.totalCash) ? bigMoney(st.totalCash, fcur) : null, `${FUND_TEXT.totalCash()}${bsDate ? ' Son açıklanan bilanço tarihindeki tutar; sonrasında yapılan sermaye artırımları burada henüz görünmez.' : ''}`),
    row('Toplam borç', isNum(st.totalDebt) ? bigMoney(st.totalDebt, fcur) : null, FUND_TEXT.totalDebt()),
    row('Borç/özsermaye', isNum(st.debtToEquity) ? num(st.debtToEquity / 100, 2) : null, isNum(st.debtToEquity) ? FUND_TEXT.debtToEquity(st.debtToEquity) : null),
    row('Cari oran', r2(st.currentRatio), isNum(st.currentRatio) ? FUND_TEXT.currentRatio(st.currentRatio) : null, st.currentRatio < 1 ? 'down' : ''),
    row('İşletme nakit akışı (12 ay)', isNum(st.operatingCashflow) ? bigMoney(st.operatingCashflow, fcur) : null, null, trend(st.operatingCashflow)),
    row('Serbest nakit akışı (12 ay)', isNum(st.freeCashflow) ? bigMoney(st.freeCashflow, fcur) : null, null, trend(st.freeCashflow)),
    isNum(runway) ? row('Nakit yetme süresi', `≈ ${num(runway, 0)} ay`, FUND_TEXT.runway(runway), runway < 12 ? 'down' : '') : null);

  const shortChg = isNum(st.sharesShort) && isNum(st.sharesShortPriorMonth) && st.sharesShortPriorMonth ? st.sharesShort / st.sharesShortPriorMonth - 1 : null;
  const ownership = sec('Sahiplik ve açığa satış', st.dateShortInterest ? `açığa satış verisi ${fmtDate(st.dateShortInterest)}` : null,
    row('İçeriden sahiplik', pc(st.heldPercentInsiders, 1), isNum(st.heldPercentInsiders) ? FUND_TEXT.heldPercentInsiders(st.heldPercentInsiders) : null),
    row('Kurumsal sahiplik', pc(st.heldPercentInstitutions, 0), isNum(st.heldPercentInstitutions) ? FUND_TEXT.heldPercentInstitutions(st.heldPercentInstitutions) : null),
    row('Açığa satış (dolaşımdakinin)', pc(st.shortPercentOfFloat, 1), isNum(st.shortPercentOfFloat) ? FUND_TEXT.shortPercentOfFloat(st.shortPercentOfFloat) + (shortChg != null ? ` Bir önceki aya göre açık pozisyon ${pct(shortChg, { digits: 0 })}.` : '') : null),
    row('Kapatma süresi', isNum(st.shortRatio) ? `${num(st.shortRatio, 1)} gün` : null, isNum(st.shortRatio) ? FUND_TEXT.shortRatio(st.shortRatio) : null),
    row('Dolaşımdaki hisse', isNum(st.floatShares) ? compact(st.floatShares) : null, isNum(st.sharesOutstanding) ? `Toplam hisse sayısı ${compact(st.sharesOutstanding)}.` : null),
    row('Beta (5 yıl)', r2(st.beta), isNum(st.beta) ? FUND_TEXT.beta(st.beta) : null));

  // analistler
  let analysts = null;
  const tg = f.targets || {};
  const tMean = st.targetMeanPrice ?? tg.mean, tLo = st.targetLowPrice ?? tg.low, tHi = st.targetHighPrice ?? tg.high;
  const recs = f.recs?.[0];
  if (isNum(tMean) || recs || f.updown?.length) {
    const pr = ctx.q.p;
    const costs = ctx.held.filter((x) => x.p.currency === qcur).map((x) => x.pos.entryPrice);
    const lo = Math.min(...[tLo, pr, ...costs].filter(isNum)), hi = Math.max(...[tHi, pr, ...costs].filter(isNum));
    const kids = [];
    if (isNum(tMean)) {
      kids.push(h('div',
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' } },
          h('span.k', { style: { fontWeight: 560 } }, `Ortalama hedef ${price(tMean, qcur)}`),
          h('b', { class: trend(tMean - pr) }, `${pct(tMean / pr - 1, { digits: 0 })} potansiyel`)),
        rangeBar(lo, hi, [{ v: pr, label: 'Son fiyat' }, { v: tMean, label: 'Ortalama hedef', kind: 'mean' }, ...costs.map((c) => ({ v: c, label: 'Giriş', kind: 'cost' }))], { fmt: (x) => price(x, qcur) }),
        h('div.range-legend', h('span', h('i'), 'son fiyat'), h('span', h('i', { style: { background: 'var(--s1)' } }), 'ortalama hedef'), costs.length ? h('span', h('i', { style: { background: 'var(--s2)' } }), 'giriş fiyatın') : null,
          isNum(tLo) && isNum(tHi) ? h('span', `en düşük ${price(tLo, qcur)}, en yüksek ${price(tHi, qcur)}`) : null),
        h('p.hint', { style: { marginTop: '6px' } }, FUND_TEXT.target(tMean, pr))));
    }
    if (recs) {
      const rows = [['Güçlü al', recs.strongBuy], ['Al', recs.buy], ['Tut', recs.hold], ['Sat', recs.sell], ['Güçlü sat', recs.strongSell]];
      const total = rows.reduce((a, r) => a + (r[1] || 0), 0);
      if (total) {
        kids.push(h('div', h('h3', { style: { marginTop: '6px' } }, `Analist önerileri (${total})`),
          h('ul.analyst-bars', ...rows.map(([k, n]) => h('li', h('span', k), h('span.bar', h('span', { style: { width: `${((n || 0) / total) * 100}%` } })), h('span.n', String(n || 0))))),
          isNum(st.recommendationMean) ? h('p.hint', { style: { marginTop: '6px' } }, FUND_TEXT.recommendationMean(st.recommendationMean, st.numberOfAnalystOpinions)) : null));
      }
    }
    if (f.updown?.length) {
      const ACT = { init: 'İlk not', up: 'Yükseltti', down: 'Düşürdü', main: 'Korudu', reit: 'Yineledi' };
      kids.push(h('div', h('h3', { style: { marginTop: '6px' } }, 'Son not değişiklikleri'),
        h('ul.updown', ...f.updown.slice(0, 6).map((u) => h('li', h('span.d', fmtDate(String(u.date).slice(0, 10), { year: true })), h('span', `${u.firm}: ${ACT[u.action] || u.action || ''} ${u.to ? `→ ${u.to}` : ''}`), h('span', isNum(u.pt) && u.pt > 0 ? price(u.pt, qcur) : ''))))));
    }
    analysts = h('section.panel', h('div.panel-head', h('h2', 'Analistler')), h('div', { style: { display: 'grid', gap: '14px' } }, ...kids));
  }

  // temettü ve takvim
  const cal = f.cal || {};
  const eds = (Array.isArray(cal['Earnings Date']) ? cal['Earnings Date'] : [cal['Earnings Date']]).filter(Boolean).map((x) => String(x).slice(0, 10));
  const nextEd = eds.find((x) => x >= todayISO()) || ctx.q.ed;
  const calendar = sec('Temettü ve takvim', null,
    nextEd ? row('Sonraki bilanço', fmtDate(nextEd), `${daysUntil(nextEd) >= 0 ? `${daysUntil(nextEd)} gün sonra.` : ''}${isNum(cal['Earnings Average']) ? ` Hisse başına kâr beklentisi ${num(cal['Earnings Average'], 2)} (aralık ${num(cal['Earnings Low'], 2)} … ${num(cal['Earnings High'], 2)}).` : ''}${isNum(cal['Revenue Average']) ? ` Satış beklentisi ${bigMoney(cal['Revenue Average'], fcur)}.` : ''}`) : null,
    row('Temettü verimi', isNum(divY) ? pct(divY, { sign: false }) : null, isNum(divY) ? FUND_TEXT.dividendYield(divY) : null),
    isNum(st.payoutRatio) && st.payoutRatio > 0 ? row('Dağıtım oranı', pct(st.payoutRatio, { sign: false, digits: 0 }), FUND_TEXT.payoutRatio(st.payoutRatio)) : null,
    cal['Ex-Dividend Date'] ? row(String(cal['Ex-Dividend Date']).slice(0, 10) < todayISO() ? 'Son hak kesim tarihi' : 'Hak kesim tarihi', fmtDate(String(cal['Ex-Dividend Date']).slice(0, 10))) : null,
    st.lastSplitDate && Date.now() / 1000 - st.lastSplitDate < 5 * 365 * 86400 ? row('Son bölünme', `${st.lastSplitFactor || ''}`, `${fmtDate(st.lastSplitDate)} tarihinde.`) : null);

  wrap.appendChild(h('div.fund-grid', valuation, profitability, balance, ownership, analysts, calendar));
  wrap.appendChild(h('p.hint', `Kaynak: Yahoo Finance, ${fmtDateTime(f.upd)} itibarıyla. Borsa İstanbul hisselerinde bazı oranlar eksik olabilir.`));
  return wrap;
}

// ---------------------------------------------------------------- mali tablolar

function periodLabel(d, freq) {
  const [y, m] = d.split('-').map(Number);
  if (freq === 'y') return String(y);
  return `${Math.ceil(m / 3)}Ç ’${String(y).slice(2)}`;
}

function statementsTab(ctx, redraw) {
  const wrap = h('div.view');
  const f = ctx.fund;
  if (!f) { wrap.appendChild(h('p.note', 'Mali tablolar yükleniyor ya da henüz toplanmadı.')); return wrap; }
  const fcur = f.profile?.financialCurrency || ctx.cur;
  const freq = ui.freq;
  const fin = f.fin?.[freq], bs = f.bs?.[freq], cf = f.cf?.[freq];
  const ctl = h('div.seg-ctl', { role: 'group', 'aria-label': 'Dönem' },
    h('button', { type: 'button', 'aria-pressed': String(freq === 'y'), onclick: () => { ui.freq = 'y'; saveUi(); redraw(); } }, 'Yıllık'),
    h('button', { type: 'button', 'aria-pressed': String(freq === 'q'), onclick: () => { ui.freq = 'q'; saveUi(); redraw(); } }, 'Çeyreklik'));
  wrap.appendChild(h('div.toolbar', ctl, h('span.note', `Tutarlar ${fcur}`)));
  const colors = [cssVar('--s1'), cssVar('--s2')];
  const fmtM = (v) => bigMoney(v, fcur);

  const panel = (title, sub, dates, series, { fmt = fmtM, note } = {}) => {
    const idx = dates.map((_, i) => i).filter((i) => series.some((s) => isNum(s.values[i])));
    if (!idx.length) return null;
    const groups = idx.map((i) => ({ label: periodLabel(dates[i], freq), values: series.map((s) => s.values[i]) }));
    const chartEl = columns(groups, series.map((s, k) => ({ name: s.name, color: colors[k] })), { fmt });
    const table = h('table.tbl', { hidden: true },
      h('thead', h('tr', h('th', 'Dönem'), ...series.map((s) => h('th', s.name)))),
      h('tbody', ...groups.map((g) => h('tr', h('td', g.label), ...g.values.map((v) => h('td', isNum(v) ? fmt(v) : '—'))))));
    const toggle = h('button.btn.small.quiet', { type: 'button', onclick: () => { table.hidden = !table.hidden; chartEl.style.display = table.hidden ? '' : 'none'; toggle.textContent = table.hidden ? 'Tablo' : 'Grafik'; } }, 'Tablo');
    return h('section.panel',
      h('div.panel-head', h('h2', title), sub ? h('span.sub', sub) : null, h('span.spacer'), toggle),
      series.length > 1 ? h('div.chart-legend', { style: { marginBottom: '8px' } }, ...series.map((s, k) => h('span', h('span.key', { style: { background: colors[k] } }), s.name))) : null,
      chartEl, table, note ? h('p.hint', { style: { marginTop: '8px' } }, note) : null);
  };

  const panels = [];
  if (fin) {
    const revAll = (fin.rev || []).filter(isNum);
    const noRevenue = !revAll.length || revAll.every((v) => Math.abs(v) < 1e5);
    panels.push(noRevenue
      ? panel('Ar-Ge gideri ve net kâr', 'satış geliri yok', fin.d, [{ name: 'Ar-Ge gideri', values: fin.rd || fin.opex || [] }, { name: 'Net kâr/zarar', values: fin.ni || [] }], { note: 'Henüz ürün satmayan şirketlerde zarar, büyük ölçüde araştırma-geliştirme harcamasından gelir.' })
      : panel('Satış ve net kâr', null, fin.d, [{ name: 'Satış', values: fin.rev || [] }, { name: 'Net kâr/zarar', values: fin.ni || [] }]));
  }
  if (bs) {
    const cfMap = new Map((cf?.d || []).map((d, i) => [d, cf.ocf?.[i]]));
    const ocf = bs.d.map((d) => cfMap.get(d));
    const ser = [{ name: 'Nakit', values: bs.cash || [] }];
    if (ocf.some(isNum)) ser.push({ name: 'İşletme nakit akışı', values: ocf });
    panels.push(panel('Nakit', ocf.some(isNum) ? 'dönem sonu nakit ve dönemin nakit akışı' : 'dönem sonu nakit', bs.d, ser,
      { note: 'Nakit azalırken işletme nakit akışı negatifse şirket kasasındaki parayı harcıyor demektir.' }));
    if ((bs.shares || []).filter(isNum).length > 1) {
      const sh = bs.shares.filter(isNum);
      const chg = sh[sh.length - 1] / sh[0] - 1;
      panels.push(panel('Hisse sayısı', null, bs.d, [{ name: 'Hisse sayısı', values: bs.shares }], { fmt: (v) => compact(v), note: FUND_TEXT.shares(chg) }));
    }
  }
  if (f.eps?.length) {
    const rows = f.eps.filter((r) => isNum(r.est) || isNum(r.act));
    if (rows.length) {
      panels.push(h('section.panel', h('div.panel-head', h('h2', 'Hisse başına kâr'), h('span.sub', 'beklenti ve gerçekleşen')),
        h('div.chart-legend', { style: { marginBottom: '8px' } },
          h('span', h('span.key', { style: { background: 'transparent', border: '2px solid var(--muted)', width: '10px', height: '10px', borderRadius: '50%' } }), 'Beklenti'),
          h('span', h('span.key', { style: { background: 'var(--up)', width: '10px', height: '10px', borderRadius: '50%' } }), 'Beklentiyi geçti'),
          h('span', h('span.key', { style: { background: 'var(--down)', width: '10px', height: '10px', borderRadius: '50%' } }), 'Beklentinin altında')),
        epsDots(rows)));
    }
  }
  const ok = panels.filter(Boolean);
  if (!ok.length) wrap.appendChild(h('p.note', 'Bu şirket için mali tablo verisi yok.'));
  else wrap.appendChild(h('div.grid-2', ...ok));
  return wrap;
}

// ---------------------------------------------------------------- haberler, profil

function newsTab(ctx) {
  const wrap = h('div.view');
  const items = ctx.fund?.news || [];
  if (!ctx.fund && ctx.q.fund) { wrap.appendChild(h('p.skeleton', 'Haberler yükleniyor…')); return wrap; }
  if (!items.length) { wrap.appendChild(h('p.note', 'Bu sembol için haber yok.')); return wrap; }
  wrap.appendChild(h('section.panel', h('div.panel-head', h('h2', 'Son haberler'), h('span.sub', 'Yahoo Finance üzerinden, İngilizce')),
    h('ul.news', ...items.map((n) => h('li',
      h('a', { href: n.url, target: '_blank', rel: 'noopener noreferrer' }, n.title),
      h('div.meta', n.src ? h('span', n.src) : null, n.time ? h('span', ago(n.time)) : null))))));
  return wrap;
}

function profileTab(ctx) {
  const wrap = h('div.view');
  const p = ctx.fund?.profile;
  if (!p) { wrap.appendChild(h('p.note', ctx.q.fund ? 'Yükleniyor…' : 'Profil bilgisi yok.')); return wrap; }
  const kv = h('ul.kv',
    p.sector ? h('li', h('span.k', 'Sektör'), h('span.v', trSector(p.sectorDisp || p.sector))) : null,
    p.industry ? h('li', h('span.k', 'Endüstri'), h('span.v', p.industryDisp || p.industry)) : null,
    p.country ? h('li', h('span.k', 'Ülke'), h('span.v', [p.city, p.country].filter(Boolean).join(', '))) : null,
    isNum(p.fullTimeEmployees) ? h('li', h('span.k', 'Çalışan'), h('span.v', num(p.fullTimeEmployees, 0))) : null,
    p.fullExchangeName ? h('li', h('span.k', 'Borsa'), h('span.v', p.fullExchangeName)) : null,
    p.firstTradeDateMilliseconds ? h('li', h('span.k', 'Halka arz'), h('span.v', fmtDate(p.firstTradeDateMilliseconds))) : null,
    p.website ? h('li', h('span.k', 'İnternet sitesi'), h('span.v', h('a', { href: p.website, target: '_blank', rel: 'noopener noreferrer' }, p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')))) : null);
  wrap.appendChild(h('div.grid-2',
    h('section.panel', h('div.panel-head', h('h2', p.longName || ctx.sym), h('span.sub', 'Yahoo Finance açıklaması, İngilizce')), h('p.profile-text', p.longBusinessSummary || 'Açıklama yok.')),
    h('section.panel', h('div.panel-head', h('h2', 'Künye')), kv)));
  return wrap;
}
