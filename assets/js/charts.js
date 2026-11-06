// Grafikler: fiyat grafikleri için TradingView Lightweight Charts™, küçük göstergeler için SVG.
import { h, s, isNum, num, compact, fmtDate, pct, numberLocale } from './util.js';

export const LWC = window.LightweightCharts;
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const localOffsetSec = () => -new Date().getTimezoneOffset() * 60;

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

function timeParts(t) {
  if (typeof t === 'string') { const [y, m, d] = t.split('-').map(Number); return { y, m, d, hh: null }; }
  if (typeof t === 'object' && t && 'year' in t) return { y: t.year, m: t.month, d: t.day, hh: null };
  const dt = new Date(t * 1000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), hh: dt.getUTCHours(), mm: dt.getUTCMinutes() };
}

export function chartOptions({ intraday = false, priceDigits = 2 } = {}) {
  const ink = cssVar('--ink');
  return {
    autoSize: true,
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: cssVar('--muted'),
      fontFamily: cssVar('--font-chart') || 'system-ui, sans-serif',
      fontSize: 11,
      attributionLogo: false,
      panes: { separatorColor: cssVar('--rule'), separatorHoverColor: cssVar('--wash'), enableResize: false },
    },
    grid: { vertLines: { visible: false }, horzLines: { color: cssVar('--grid') } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 }, minimumWidth: 56 },
    leftPriceScale: { visible: false },
    timeScale: {
      borderVisible: false, timeVisible: intraday, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true,
      lockVisibleTimeRangeOnResize: true, rightOffset: 2,
      tickMarkFormatter: (t, type) => {
        const p = timeParts(t);
        if (p.hh != null && type >= 3) return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
        if (type === 0) return String(p.y);
        if (type === 1) return MONTHS[p.m - 1];
        return `${p.d} ${MONTHS[p.m - 1]}`;
      },
    },
    crosshair: {
      mode: LWC.CrosshairMode.Magnet,
      vertLine: { color: cssVar('--rule-strong'), width: 1, style: LWC.LineStyle.Solid, labelBackgroundColor: ink },
      horzLine: { color: cssVar('--rule-strong'), width: 1, style: LWC.LineStyle.Solid, labelBackgroundColor: ink },
    },
    localization: {
      locale: numberLocale(),
      priceFormatter: (v) => num(v, Math.abs(v) >= 1000 ? 0 : priceDigits),
      timeFormatter: (t) => {
        const p = timeParts(t);
        const day = `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
        return p.hh != null ? `${day} ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}` : day;
      },
    },
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
  };
}

export function createChart(el, opts = {}) {
  return LWC.createChart(el, chartOptions(opts));
}

/** Hex rengi saydamlıkla döndürür. */
export function alpha(hex, a) {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ---------------------------------------------------------------- SVG küçük grafikler

/** Küçük çizgi grafik. baseline verilirse o değerde ince bir yatay çizgi çizer. */
export function sparkline(values, { w = 120, h = 32, color = 'currentColor', baseline = null, area = true, label, stretch = false } = {}) {
  const vals = values.filter(isNum);
  const svgEl = s('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'spark', role: 'img', 'aria-label': label || 'Küçük grafik', preserveAspectRatio: stretch ? 'none' : null });
  if (vals.length < 2) return svgEl;
  let min = Math.min(...vals), max = Math.max(...vals);
  if (baseline != null) { min = Math.min(min, baseline); max = Math.max(max, baseline); }
  if (max === min) { max += 1; min -= 1; }
  const pad = 3;
  const x = (i) => pad + (i / (values.length - 1)) * (w - pad * 2);
  const y = (v) => pad + (1 - (v - min) / (max - min)) * (h - pad * 2);
  const pts = values.map((v, i) => (isNum(v) ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : null)).filter(Boolean);
  if (baseline != null) svgEl.appendChild(s('line', { x1: pad, x2: w - pad, y1: y(baseline), y2: y(baseline), class: 'spark-base', 'vector-effect': 'non-scaling-stroke' }));
  if (area) {
    const yb = baseline != null ? y(baseline) : h - pad;
    svgEl.appendChild(s('polygon', { points: `${x(0)},${yb} ${pts.join(' ')} ${x(values.length - 1)},${yb}`, fill: color, opacity: 0.1 }));
  }
  svgEl.appendChild(s('polyline', { points: pts.join(' '), fill: 'none', stroke: color, 'stroke-width': 1.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
  const lastI = values.length - 1;
  if (isNum(values[lastI])) svgEl.appendChild(s('circle', { cx: x(lastI), cy: y(values[lastI]), r: 2.6, fill: color, class: 'spark-dot' }));
  return svgEl;
}

/** Sıfırdan sağa (yeşil) ya da sola (kırmızı) uzayan sapma çubuğu. */
export function devBar(v, maxAbs, { w = 96 } = {}) {
  const el = h('span.dev', { style: { width: `${w}px` }, 'aria-hidden': 'true' });
  if (!isNum(v) || !maxAbs) return el;
  const frac = Math.min(1, Math.abs(v) / maxAbs);
  const bar = h('span.dev-bar', { class: `dev-bar ${v >= 0 ? 'up' : 'down'}`, style: { width: `${(frac * 50).toFixed(2)}%`, [v >= 0 ? 'left' : 'right']: '50%' } });
  el.appendChild(h('span.dev-zero'));
  el.appendChild(bar);
  return el;
}

/** Aralık çubuğu: min–max ve üzerinde işaretler [{v, label, kind}]. */
export function rangeBar(min, max, marks = [], { fmt = (v) => num(v) } = {}) {
  const el = h('div.range');
  const track = h('div.range-track');
  el.appendChild(track);
  if (!(isNum(min) && isNum(max)) || max <= min) return el;
  const posOf = (v) => Math.max(0, Math.min(1, (v - min) / (max - min)));
  for (const m of marks) {
    if (!isNum(m.v)) continue;
    const left = `${(posOf(m.v) * 100).toFixed(2)}%`;
    track.appendChild(h('span', { class: `range-mark ${m.kind || ''}`, style: { left }, title: `${m.label}: ${fmt(m.v)}` }));
  }
  el.appendChild(h('div.range-ends', h('span', fmt(min)), h('span', fmt(max))));
  return el;
}

/** Bütünün parçaları: yüksek segmentli çubuk (≤ 6 parça), etiket sığarsa içine. */
export function segBar(parts, { colors, fmt = (p) => pct(p.weight, { sign: false, digits: 0 }), label = 'Dağılım' } = {}) {
  const wrap = h('div.segwrap');
  const bar = h('div.segbar', { role: 'img', 'aria-label': `${label}: ${parts.map((p) => `${p.name} ${fmt(p)}`).join(', ')}` });
  parts.forEach((p, i) => {
    if (!(p.weight > 0)) return;
    const seg = h('div.seg', { style: { flexGrow: p.weight, background: colors[i % colors.length] }, title: `${p.name}: ${fmt(p)}` });
    seg.appendChild(h('span.seg-label', fmt(p)));
    bar.appendChild(seg);
  });
  wrap.appendChild(bar);
  const legend = h('ul.legend');
  parts.forEach((p, i) => {
    if (!(p.weight > 0)) return;
    legend.appendChild(h('li', h('span.key', { style: { background: colors[i % colors.length] } }), h('span', p.name), h('span.legend-val', fmt(p))));
  });
  wrap.appendChild(legend);
  // sığmayan etiketleri gizle (kırpmak yerine)
  requestAnimationFrame(() => {
    for (const seg of bar.children) {
      const lab = seg.firstChild;
      if (lab && lab.scrollWidth + 12 > seg.clientWidth) lab.style.visibility = 'hidden';
    }
  });
  return wrap;
}

/**
 * Gruplu sütun grafiği (negatif değerler tabanın altına).
 * groups: [{label, values:[v1, v2]}], series: [{name, color}]
 */
export function columns(groups, series, { height = 180, fmt = (v) => compact(v), unitLabel = '' } = {}) {
  const W = 560, H = height, padL = 46, padR = 8, padT = 10, padB = 26;
  const all = groups.flatMap((g) => g.values).filter(isNum);
  const svgEl = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cols', role: 'img', 'aria-label': `${series.map((x) => x.name).join(' ve ')} sütun grafiği` });
  if (!all.length) return svgEl;
  let max = Math.max(0, ...all), min = Math.min(0, ...all);
  const ticks = niceTicks(min, max, 4);
  min = ticks[0]; max = ticks[ticks.length - 1];
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  for (const t of ticks) {
    svgEl.appendChild(s('line', { x1: padL, x2: W - padR, y1: y(t), y2: y(t), class: t === 0 ? 'axis0' : 'grid' }));
    svgEl.appendChild(s('text', { x: padL - 6, y: y(t) + 3.5, 'text-anchor': 'end', class: 'tick', text: fmt(t) }));
  }
  const band = (W - padL - padR) / groups.length;
  const barW = Math.min(24, (band - 10) / series.length - 2);
  groups.forEach((g, gi) => {
    const cx = padL + band * gi + band / 2;
    const totalW = series.length * barW + (series.length - 1) * 2;
    g.values.forEach((v, si) => {
      if (!isNum(v)) return;
      const x0 = cx - totalW / 2 + si * (barW + 2);
      const y0 = y(Math.max(0, v)), y1 = y(Math.min(0, v));
      const hgt = Math.max(1, y1 - y0);
      const r = Math.min(4, barW / 2, hgt);
      // veri ucu yuvarlak, taban düz
      const d = v >= 0
        ? `M${x0},${y1} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + barW - r} Q${x0 + barW},${y0} ${x0 + barW},${y0 + r} V${y1} Z`
        : `M${x0},${y0} V${y1 - r} Q${x0},${y1} ${x0 + r},${y1} H${x0 + barW - r} Q${x0 + barW},${y1} ${x0 + barW},${y1 - r} V${y0} Z`;
      const p = s('path', { d, fill: series[si].color, class: 'col' });
      p.appendChild(s('title', { text: `${g.label} · ${series[si].name}: ${fmt(v)}${unitLabel}` }));
      svgEl.appendChild(p);
    });
    svgEl.appendChild(s('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'tick', text: g.label }));
  });
  return svgEl;
}

export function niceTicks(min, max, count = 4) {
  if (min === max) { max = min + 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.abs(v) < step / 1e6 ? 0 : v);
  return out;
}

/** Beklenti vs gerçekleşen (nokta grafiği). */
export function epsDots(rows, { fmt = (v) => num(v, 2) } = {}) {
  const pts = rows.filter((r) => isNum(r.est) || isNum(r.act)).slice(0, 8).reverse();
  const W = 560, H = 170, padL = 46, padR = 8, padT = 12, padB = 26;
  const svgEl = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cols', role: 'img', 'aria-label': 'Hisse başına kâr: beklenti ve gerçekleşen' });
  const all = pts.flatMap((r) => [r.est, r.act]).filter(isNum);
  if (!all.length) return svgEl;
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 4);
  const min = ticks[0], max = ticks[ticks.length - 1];
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  for (const t of ticks) {
    svgEl.appendChild(s('line', { x1: padL, x2: W - padR, y1: y(t), y2: y(t), class: t === 0 ? 'axis0' : 'grid' }));
    svgEl.appendChild(s('text', { x: padL - 6, y: y(t) + 3.5, 'text-anchor': 'end', class: 'tick', text: fmt(t) }));
  }
  const band = (W - padL - padR) / pts.length;
  pts.forEach((r, i) => {
    const cx = padL + band * i + band / 2;
    if (isNum(r.est)) {
      const c = s('circle', { cx, cy: y(r.est), r: 5, class: 'eps-est' });
      c.appendChild(s('title', { text: `Beklenti: ${fmt(r.est)}` }));
      svgEl.appendChild(c);
    }
    if (isNum(r.act)) {
      const beat = isNum(r.est) ? r.act >= r.est : true;
      const c = s('circle', { cx, cy: y(r.act), r: 5, class: `eps-act ${beat ? 'up' : 'down'}` });
      c.appendChild(s('title', { text: `Gerçekleşen: ${fmt(r.act)}${isNum(r.sur) ? ` (sürpriz ${num(r.sur, 0)}%)` : ''}` }));
      svgEl.appendChild(c);
    }
    const d = String(r.d || '').slice(0, 10);
    svgEl.appendChild(s('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'tick', text: d ? fmtDate(d, { year: false }).replace('.', '') + ` ’${d.slice(2, 4)}` : '' }));
  });
  return svgEl;
}
