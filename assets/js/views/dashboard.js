// Genel bakış: toplam değer, toplam kâr/zarar seyri, defter dizini, günün hareketleri, yaklaşan tarihler.
import { h, fill, icon, toast, money, pct, price, num, fmtDate, fmtTime, daysUntil, todayISO, trend, curSymbol, isNum, ago } from '../util.js';
import * as store from '../store.js';
import * as data from '../data.js';
import { valuePortfolio, totals, combinedPL, plSeries, spMap, dayBefore } from '../calc.js';
import { createChart, LWC, cssVar, alpha, sparkline, devBar } from '../charts.js';
import { openPortfolioDialog, pickFile, openPasteDialog, openTransferDialog, importFile } from './dialogs.js';
import { removeDemo } from '../demo.js';

export function renderDashboard() {
  const list = store.list();
  const view = h('div.view');
  const cleanups = [];
  if (!list.length) {
    view.appendChild(emptyState());
    return { el: view };
  }
  const st = store.settings();
  const market = data.getMarket();
  // Gerçek defter varsa örnek defter toplamlara katılmaz
  const hasDemo = list.some((p) => p.demo);
  const counted = list.some((p) => !p.demo) ? list.filter((p) => !p.demo) : list;

  view.appendChild(marketStrip(market));

  if (hasDemo) {
    const onlyDemo = counted.every((p) => p.demo);
    view.appendChild(h('div.callout.info', icon('info'), h('div.grow',
      h('div', h('b', onlyDemo ? 'Gördüğün bir örnek defter. ' : 'Örnek defter toplamlara katılmıyor. '),
        onlyDemo ? 'THYAO, ASELS ve ALARK\'tan kurulmuş bir sepetle Stocker\'ın neye benzediğini görebilirsin. Kendi defterlerini içe aktardığında örnek kendiliğinden kalkar.' : 'İstediğinde kaldırabilirsin; bir sonraki içe aktarmada da kendiliğinden kalkar.')),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        onlyDemo ? h('button.btn.small.primary', { type: 'button', onclick: () => pickFile() }, icon('upload', 14), 'Defterlerimi getir') : null,
        h('button.btn.small', { type: 'button', onclick: () => { removeDemo(); toast('Örnek defter kaldırıldı'); } }, 'Örneği kaldır'))));
  }

  const missing = [...new Set(list.flatMap((p) => p.positions.map((x) => x.symbol)).filter((s) => market && !data.hasData(s)))];
  if (market && missing.length) {
    view.appendChild(h('div.callout', icon('alert'), h('div.grow',
      h('div', h('b', `${missing.length} hisse için henüz fiyat yok: `), missing.join(', ')),
      h('div.hint', 'Bunlar maliyet değeriyle hesaba katılıyor. Fiyat gelmesi için sembolleri veri listesine ekle.')),
    h('a.btn.small', { href: '#/ayarlar' }, 'Nasıl eklenir')));
  }

  // ---- toplam
  const cur = st.totalCur || 'TRY';
  const t = totals(counted, cur);
  const curCtl = h('div.seg-ctl', { role: 'group', 'aria-label': 'Toplam para birimi' },
    ...['TRY', 'USD'].map((c) => h('button', { type: 'button', 'aria-pressed': String(c === cur), onclick: () => { store.setSetting('totalCur', c); window.dispatchEvent(new Event('stocker:rerender')); } }, c === 'TRY' ? 'TL' : 'USD')));
  const usdtry = data.fx('USD', 'TRY');
  const hero = h('section.hero', { 'aria-label': 'Toplam portföy' },
    h('div.hero-label', h('span', `Tüm defterler, ${cur === 'TRY' ? 'TL' : 'dolar'} karşılığı`), h('span', { style: { marginLeft: 'auto' } }, curCtl)),
    h('div.readout', { 'aria-live': 'polite' }, splitMoney(t.total, cur)),
    h('div.deltas',
      delta('Günlük', money(t.dayChg, cur, { sign: true }), pct(t.dayPct), trend(t.dayChg)),
      delta('Toplam kâr/zarar', money(t.pl, cur, { sign: true }), pct(t.plPct), trend(t.pl)),
      delta('Maliyet', money(t.cost, cur), null, 'flat')),
    usdtry ? h('div.hint', `${counted.some((p) => p.currency !== cur) ? `Diğer para birimindeki defterler güncel kurla çevrildi: 1 $ = ${money(usdtry, 'TRY', { digits: 2 })}.` : ''} Günlük değişim her hissenin son seansına göredir; ABD piyasası kapalıyken dünkü seans görünür. Fiyatlar sayfa açılınca ve yenile tuşuyla Yahoo Finance'ten anlık alınır; BIST verisi 15 dk gecikmelidir.`) : null,
  );

  const chartBox = h('div.chart-box');
  const tip = h('div.chart-tip');
  chartBox.appendChild(tip);
  const chartPanel = h('section.chart-panel', { 'aria-label': 'Toplam kâr/zarar seyri' },
    h('div.panel-head', h('h2', 'Toplam kâr/zarar seyri'), h('span.sub', 'günlük kapanışlarla, defterlerin başlangıç tarihlerinden bu yana')),
    chartBox);
  view.appendChild(h('div.grid-hero', hero, chartPanel));

  requestAnimationFrame(() => {
    const s = combinedPL(counted, cur);
    if (s.t.length < 2) { chartBox.appendChild(h('div.empty-chart', 'Seri için en az iki işlem günü gerekiyor.')); return; }
    const chart = createChart(chartBox, { priceDigits: 0 });
    const up = cssVar('--up'), down = cssVar('--down');
    const series = chart.addSeries(LWC.BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: up, topFillColor1: alpha(up, 0.18), topFillColor2: alpha(up, 0.02),
      bottomLineColor: down, bottomFillColor1: alpha(down, 0.02), bottomFillColor2: alpha(down, 0.18),
      lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
      priceFormat: { type: 'custom', formatter: (v) => money(v, cur, { digits: 0 }) },
    });
    const first = s.t[0];
    series.setData([{ time: dayBefore(first), value: 0 }, ...s.t.map((d, i) => ({ time: d, value: s.v[i] }))]);
    chart.timeScale().fitContent();
    const showTip = (time, value) => {
      fill(tip, h('span', fmtDate(time)), h('b', { class: trend(value) }, money(value, cur, { sign: true, digits: 0 })));
    };
    showTip(s.t[s.t.length - 1], s.v[s.v.length - 1]);
    chart.subscribeCrosshairMove((param) => {
      const pt = param.time ? param.seriesData.get(series) : null;
      if (pt) showTip(param.time, pt.value); else showTip(s.t[s.t.length - 1], s.v[s.v.length - 1]);
    });
    cleanups.push(() => chart.remove());
  });

  // ---- defter dizini
  const ledger = h('ul.ledger');
  for (const p of list) ledger.appendChild(h('li', ledgerRow(p)));
  view.appendChild(h('section.panel', { 'aria-label': 'Defterler' },
    h('div.panel-head',
      h('h2', 'Defterler'), h('span.sub', `${list.length} defter, ${new Set(list.flatMap((p) => p.positions.map((x) => x.symbol))).size} farklı hisse`),
      h('span.spacer'),
      h('button.btn.small', { type: 'button', onclick: () => openTransferDialog() }, icon('link', 15), 'Başka cihaza taşı'),
      h('button.btn.small', { type: 'button', onclick: () => pickFile() }, icon('upload', 15), 'İçe aktar'),
      h('button.btn.small', { type: 'button', onclick: () => { if (!store.real().length) return toast('Dışa aktarılacak defter yok; örnek defter dışa aktarılmaz'); store.exportFile(); } }, icon('download', 15), 'Dışa aktar'),
      h('button.btn.small.primary', { type: 'button', onclick: () => openPortfolioDialog(null, { onSaved: (p) => { location.hash = `#/p/${p.id}`; } }) }, icon('plus', 15), 'Yeni defter')),
    ledger));

  // ---- günün hareketleri + takvim
  view.appendChild(h('div.grid-2', moversPanel(counted), eventsPanel(counted)));

  return { el: view, cleanup: () => cleanups.forEach((f) => f()) };
}

function splitMoney(v, cur) {
  const s = money(v, cur, { digits: Math.abs(v) >= 100000 ? 0 : 2 });
  const sym = curSymbol(cur);
  const i = s.indexOf(sym);
  if (i < 0) return s;
  return [s.slice(0, i), h('span.cur-sym', sym), s.slice(i + sym.length)];
}

function delta(k, v, p, tr) {
  return h('div.delta', h('span.k', k), h('span.v', { class: `v ${tr}` }, v, p ? h('small', p) : null));
}

export function marketStrip(market) {
  const sessions = data.sessions();
  const strip = h('div.strip', { role: 'status' });
  for (const s of sessions) {
    let text;
    if (s.state === 'open') text = `açık, ${s.close}'e kadar`;
    else if (s.state === 'pre') text = `seans öncesi, ${s.open}'da açılır`;
    else if (s.state === 'post') text = 'seans sonrası işlemler';
    else if (s.minsToOpen != null && s.minsToOpen > 0) text = `kapalı, ${s.open}'da açılır`;
    else text = s.weekend ? 'hafta sonu kapalı' : 'kapalı';
    strip.appendChild(h('span.mkt', h('span', { class: `lamp ${s.state === 'open' ? 'open' : s.state === 'pre' || s.state === 'post' ? 'ext' : ''}` }), h('b', s.name), text));
  }
  const usdtry = data.fx('USD', 'TRY');
  if (usdtry) {
    const q = data.quote('USDTRY=X');
    strip.appendChild(h('span.mkt.fx', h('b', 'USD/TRY'), num(usdtry, 4), q?.pc ? h('span', { class: trend(q.p - q.pc) }, pct(q.p / q.pc - 1)) : null));
  }
  if (market?.generated) strip.appendChild(h('span.mkt.show-sm', { title: market.generated }, `Veri ${fmtTime(market.generated)} (${ago(market.generated)})`));
  return strip;
}

function ledgerRow(p) {
  const v = valuePortfolio(p);
  const cur = p.currency;
  const s = plSeries(p, spMap(p.positions.map((x) => x.symbol)));
  const sp = s.t.length > 1 ? sparkline([0, ...s.pl], { w: 132, h: 34, color: p.accent, baseline: 0, stretch: true, label: `${p.title} kâr/zarar seyri` }) : h('span');
  return h('a.ledger-row', { href: `#/p/${p.id}`, style: { '--acc': p.accent } },
    h('span.spine'),
    h('div', h('div.ledger-title', p.title, p.demo ? h('span.badge.demo', 'Örnek') : null), h('div.ledger-meta', h('span', p.kicker || cur), h('span', `${p.positions.length} hisse`), h('span.hide-sm', `${fmtDate(p.entryDate)}'den beri`))),
    h('div.cell.c-val', h('span.k', 'Değer'), h('span.v', money(v.total, cur)),
      h('span.v2.show-sm', h('span', { class: trend(v.pl) }, pct(v.plPct)), h('span.muted', ' toplam')),
      h('span.v2.show-sm', h('span', { class: trend(v.dayChg) }, pct(v.dayPct)), h('span.muted', ' günlük'))),
    h('div.cell.c-cost', h('span.k', 'Kâr/zarar'), h('span.v', { class: `v ${trend(v.pl)}` }, money(v.pl, cur, { sign: true })), h('span.v2', { class: `v2 ${trend(v.pl)}` }, pct(v.plPct))),
    h('div.cell.c-day', h('span.k', 'Günlük'), h('span.v', { class: `v ${trend(v.dayChg)}` }, money(v.dayChg, cur, { sign: true })), h('span.v2', { class: `v2 ${trend(v.dayChg)}` }, pct(v.dayPct))),
    sp,
  );
}

function moversPanel(list) {
  const seen = new Map();
  for (const p of list) for (const x of p.positions) {
    const q = data.quote(x.symbol);
    if (q && isNum(q.p) && isNum(q.pc) && q.pc && !seen.has(x.symbol)) seen.set(x.symbol, { s: x.symbol, t: x.ticker, n: x.name && x.name !== x.ticker ? x.name : (q.n || x.name), q, chg: q.p / q.pc - 1 });
  }
  const all = [...seen.values()].sort((a, b) => b.chg - a.chg);
  const panel = h('section.panel', { 'aria-label': 'Günün hareketleri' },
    h('div.panel-head', h('h2', 'Son seansın hareketleri'), h('span.sub', 'defterlerindeki hisseler, önceki kapanışa göre')));
  if (!all.length) { panel.appendChild(h('p.note', 'Fiyat verisi gelince burada görünür.')); return panel; }
  const top = all.filter((x) => x.chg > 0).slice(0, 4);
  const bottom = all.filter((x) => x.chg < 0).slice(-4).reverse();
  const maxAbs = Math.max(...all.map((x) => Math.abs(x.chg)), 0.01);
  const row = (x) => h('li',
    h('a', { href: `#/s/${encodeURIComponent(x.s)}` }, h('span.sym', x.t), h('span.nm', x.n)),
    h('span.px', price(x.q.p, x.q.cur)),
    devBar(x.chg, maxAbs, { w: 104 }),
    h('span.chg', { class: `chg ${trend(x.chg)}` }, pct(x.chg)));
  const ul = h('ul.movers');
  [...top, ...bottom].forEach((x) => ul.appendChild(row(x)));
  panel.appendChild(ul);
  const ext = all.filter((x) => isNum(x.q.xp) && Math.abs(x.q.xp / x.q.p - 1) >= 0.02);
  if (ext.length) {
    panel.appendChild(h('div.hint', { style: { marginTop: '10px' } },
      `Seans dışında belirgin hareket: ${ext.map((x) => `${x.t} ${pct(x.q.xp / x.q.p - 1, { digits: 1 })}`).join(', ')}.`));
  }
  return panel;
}

function eventsPanel(list) {
  const today = todayISO();
  const items = [];
  const seen = new Set();
  for (const p of list) for (const x of p.positions) {
    const q = data.quote(x.symbol);
    if (q?.ed && !seen.has(x.symbol + 'ed')) { seen.add(x.symbol + 'ed'); items.push({ date: q.ed, s: x.symbol, t: x.ticker, what: 'Bilanço açıklaması', src: 'Yahoo' }); }
    if (q?.exd && !seen.has(x.symbol + 'exd')) { seen.add(x.symbol + 'exd'); items.push({ date: q.exd, s: x.symbol, t: x.ticker, what: 'Temettü hak kesimi', src: 'Yahoo' }); }
    for (const e of x.events || []) if (e.date >= today) items.push({ date: e.date, s: x.symbol, t: x.ticker, what: e.label, src: p.title, mine: true, acc: p.accent });
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  const panel = h('section.panel', { 'aria-label': 'Yaklaşan tarihler' },
    h('div.panel-head', h('h2', 'Yaklaşan tarihler'), h('span.sub', 'bilanço, temettü ve kendi eklediğin olaylar')));
  // Kendi işaretlediğin tarihler (FDA kararı gibi) her zaman görünür; kalan yer bilanço ve temettüyle dolar
  const future = items.filter((x) => x.date >= today);
  const mine = future.filter((x) => x.mine).slice(0, 8);
  const auto = future.filter((x) => !x.mine).slice(0, Math.max(3, 10 - mine.length));
  const upcoming = [...mine, ...auto].sort((a, b) => a.date.localeCompare(b.date) || (b.mine ? 1 : 0) - (a.mine ? 1 : 0));
  if (!upcoming.length) {
    panel.appendChild(h('p.note', 'Yaklaşan bir tarih yok. Bir hissenin FDA kararı gibi önemli tarihlerini pozisyonu düzenlerken ekleyebilirsin.'));
    return panel;
  }
  const ul = h('ul.events');
  for (const e of upcoming) {
    const d = new Date(e.date + 'T00:00:00');
    const left = daysUntil(e.date);
    ul.appendChild(h('li', e.mine ? { class: 'mine', style: { '--acc': e.acc } } : null,
      h('div.event-date', h('b', String(d.getDate())), h('span', fmtDate(e.date, { year: false }).split(' ').slice(1).join(' '))),
      h('div.event-what', h('a', { href: `#/s/${encodeURIComponent(e.s)}` }, e.t), h('div', e.what)),
      h('span.event-in', left === 0 ? 'bugün' : left === 1 ? 'yarın' : `${left} gün`)));
  }
  panel.appendChild(ul);
  return panel;
}

function emptyState() {
  const drop = h('div.drop',
    h('b', 'Dışa aktarılmış JSON dosyanı buraya bırak'),
    h('span.hint', 'Önceki Stocker\'dan ya da başka bir cihazdan aldığın portfoylerim-….json dosyası.'),
    h('div.row', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
      h('button.btn.primary', { type: 'button', onclick: () => pickFile() }, icon('upload', 16), 'Dosya seç'),
      h('button.btn', { type: 'button', onclick: () => openPasteDialog() }, 'JSON ya da bağlantı yapıştır')));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) importFile(f); });
  return h('section.panel.empty',
    h('h2', 'Defterlerin bu cihazda henüz yok'),
    h('p', 'Stocker portföylerini sunucuda değil, bu tarayıcıda saklar. Başka bir cihazdaki defterlerini dosyayla ya da taşıma bağlantısıyla getirebilir, ya da sıfırdan bir defter açabilirsin.'),
    drop,
    h('div.row', h('button.btn', { type: 'button', onclick: () => openPortfolioDialog(null, { onSaved: (p) => { location.hash = `#/p/${p.id}`; } }) }, icon('plus', 16), 'Yeni defter oluştur')),
    h('p.hint', 'Taşıma bağlantısı: diğer cihazda Defterler › "Başka cihaza taşı" ile oluşturulur; açtığın anda içe aktarma penceresi gelir.'),
  );
}
