// Teknik göstergeler ve risk istatistikleri. Girdiler aynı uzunlukta diziler; hesaplanamayan yerler null.

const ok = (x) => typeof x === 'number' && Number.isFinite(x);

export function sma(a, n) {
  const out = new Array(a.length).fill(null);
  let s = 0, cnt = 0;
  for (let i = 0; i < a.length; i++) {
    if (ok(a[i])) { s += a[i]; cnt++; }
    if (i >= n && ok(a[i - n])) { s -= a[i - n]; cnt--; }
    if (i >= n - 1 && cnt === n) out[i] = s / n;
  }
  return out;
}

export function ema(a, n) {
  const out = new Array(a.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null, seed = 0, cnt = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (!ok(x)) { out[i] = prev; continue; }
    if (prev == null) {
      seed += x; cnt++;
      if (cnt === n) { prev = seed / n; out[i] = prev; }
      continue;
    }
    prev = x * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function wilder(a, n) {
  const out = new Array(a.length).fill(null);
  let prev = null, seed = 0, cnt = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (!ok(x)) { out[i] = prev; continue; }
    if (prev == null) {
      seed += x; cnt++;
      if (cnt === n) { prev = seed / n; out[i] = prev; }
      continue;
    }
    prev = (prev * (n - 1) + x) / n;
    out[i] = prev;
  }
  return out;
}

export function rsi(c, n = 14) {
  const up = [null], dn = [null];
  for (let i = 1; i < c.length; i++) {
    const d = ok(c[i]) && ok(c[i - 1]) ? c[i] - c[i - 1] : null;
    up.push(d == null ? null : Math.max(d, 0));
    dn.push(d == null ? null : Math.max(-d, 0));
  }
  const au = wilder(up, n), ad = wilder(dn, n);
  return c.map((_, i) => (au[i] == null || ad[i] == null ? null : ad[i] === 0 ? 100 : 100 - 100 / (1 + au[i] / ad[i])));
}

export function macd(c, f = 12, sl = 26, sig = 9) {
  const ef = ema(c, f), es = ema(c, sl);
  const m = c.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const firstIdx = m.findIndex((x) => x != null);
  const sigLine = new Array(c.length).fill(null);
  if (firstIdx >= 0) {
    const e = ema(m.slice(firstIdx), sig);
    e.forEach((x, j) => { sigLine[firstIdx + j] = x; });
  }
  const hist = m.map((x, i) => (x != null && sigLine[i] != null ? x - sigLine[i] : null));
  return { macd: m, signal: sigLine, hist };
}

export function stdev(a, n) {
  const out = new Array(a.length).fill(null);
  for (let i = n - 1; i < a.length; i++) {
    let s = 0, s2 = 0, cnt = 0;
    for (let j = i - n + 1; j <= i; j++) if (ok(a[j])) { s += a[j]; s2 += a[j] * a[j]; cnt++; }
    if (cnt === n) out[i] = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
  }
  return out;
}

export function bollinger(c, n = 20, k = 2) {
  const mid = sma(c, n), sd = stdev(c, n);
  const upper = mid.map((m, i) => (m == null || sd[i] == null ? null : m + k * sd[i]));
  const lower = mid.map((m, i) => (m == null || sd[i] == null ? null : m - k * sd[i]));
  const pctB = c.map((x, i) => (upper[i] == null || upper[i] === lower[i] ? null : (x - lower[i]) / (upper[i] - lower[i])));
  const width = mid.map((m, i) => (m ? (upper[i] - lower[i]) / m : null));
  return { mid, upper, lower, pctB, width };
}

function rollMax(a, n) { return a.map((_, i) => (i < n - 1 ? null : Math.max(...a.slice(i - n + 1, i + 1).filter(ok)))); }
function rollMin(a, n) { return a.map((_, i) => (i < n - 1 ? null : Math.min(...a.slice(i - n + 1, i + 1).filter(ok)))); }

export function stoch(h, l, c, n = 14, smooth = 3, d = 3) {
  const hh = rollMax(h, n), ll = rollMin(l, n);
  const raw = c.map((x, i) => (hh[i] == null || hh[i] === ll[i] ? null : (100 * (x - ll[i])) / (hh[i] - ll[i])));
  const k = sma(raw, smooth);
  return { k, d: sma(k, d) };
}

export function willr(h, l, c, n = 14) {
  const hh = rollMax(h, n), ll = rollMin(l, n);
  return c.map((x, i) => (hh[i] == null || hh[i] === ll[i] ? null : (-100 * (hh[i] - x)) / (hh[i] - ll[i])));
}

export function cci(h, l, c, n = 20) {
  const tp = c.map((x, i) => (ok(x) && ok(h[i]) && ok(l[i]) ? (h[i] + l[i] + x) / 3 : null));
  const m = sma(tp, n);
  return tp.map((x, i) => {
    if (m[i] == null) return null;
    let md = 0;
    for (let j = i - n + 1; j <= i; j++) md += Math.abs(tp[j] - m[i]);
    md /= n;
    return md ? (x - m[i]) / (0.015 * md) : 0;
  });
}

export function trueRange(h, l, c) {
  return c.map((_, i) => {
    if (!ok(h[i]) || !ok(l[i])) return null;
    if (i === 0 || !ok(c[i - 1])) return h[i] - l[i];
    return Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  });
}

export function atr(h, l, c, n = 14) { return wilder(trueRange(h, l, c), n); }

export function adx(h, l, c, n = 14) {
  const pdm = [null], mdm = [null];
  for (let i = 1; i < c.length; i++) {
    const upMove = h[i] - h[i - 1], dnMove = l[i - 1] - l[i];
    pdm.push(upMove > dnMove && upMove > 0 ? upMove : 0);
    mdm.push(dnMove > upMove && dnMove > 0 ? dnMove : 0);
  }
  const tr = wilder(trueRange(h, l, c), n);
  const sp = wilder(pdm, n), sm = wilder(mdm, n);
  const pdi = c.map((_, i) => (tr[i] ? (100 * sp[i]) / tr[i] : null));
  const mdi = c.map((_, i) => (tr[i] ? (100 * sm[i]) / tr[i] : null));
  const dx = c.map((_, i) => (pdi[i] == null || mdi[i] == null || pdi[i] + mdi[i] === 0 ? null : (100 * Math.abs(pdi[i] - mdi[i])) / (pdi[i] + mdi[i])));
  return { adx: wilder(dx, n), pdi, mdi };
}

export function obv(c, v) {
  const out = [0];
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    out.push(out[i - 1] + (d > 0 ? v[i] || 0 : d < 0 ? -(v[i] || 0) : 0));
  }
  return out;
}

export function momentum(c, n = 10) { return c.map((x, i) => (i >= n && ok(x) && ok(c[i - n]) ? x - c[i - n] : null)); }

export const last = (a) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };
export const prevOf = (a, back = 1) => { let seen = 0; for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) { if (seen === back) return a[i]; seen++; } return null; };

// ---------------------------------------------------------------- istatistikler

/** t (YYYY-MM-DD) ve c dizilerinde, bugünden `days` takvim günü öncesine göre getiri. */
export function changeSince(t, c, days) {
  if (!t.length) return null;
  const end = new Date(t[t.length - 1]);
  const target = new Date(end.getTime() - days * 86400000).toISOString().slice(0, 10);
  if (t[0] > target) return null;
  let i = t.length - 1;
  while (i > 0 && t[i] > target) i--;
  const base = c[i], now = c[c.length - 1];
  return ok(base) && base ? now / base - 1 : null;
}

export function ytdChange(t, c) {
  if (!t.length) return null;
  const y = t[t.length - 1].slice(0, 4);
  let i = t.findIndex((d) => d.slice(0, 4) === y);
  if (i <= 0) return null;
  const base = c[i - 1];
  return base ? c[c.length - 1] / base - 1 : null;
}

export function dailyReturns(c) {
  const r = [];
  for (let i = 1; i < c.length; i++) r.push(ok(c[i]) && ok(c[i - 1]) && c[i - 1] ? c[i] / c[i - 1] - 1 : null);
  return r;
}

export function volatility(c, n = 252) {
  const r = dailyReturns(c.slice(-n - 1)).filter(ok);
  if (r.length < 20) return null;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v) * Math.sqrt(252);
}

export function maxDrawdown(c, n = 252) {
  const a = c.slice(-n).filter(ok);
  let peak = -Infinity, mdd = 0, peakAt = 0, troughAt = 0, curPeakAt = 0;
  a.forEach((x, i) => {
    if (x > peak) { peak = x; curPeakAt = i; }
    const dd = x / peak - 1;
    if (dd < mdd) { mdd = dd; peakAt = curPeakAt; troughAt = i; }
  });
  return a.length > 5 ? { mdd, peakAt, troughAt, fromPeak: a[a.length - 1] / Math.max(...a) - 1 } : null;
}

/** Hisse ile endeksin günlük getirileri üzerinden beta ve korelasyon. */
export function beta(t, c, bt, bc, n = 252) {
  const bm = new Map(bt.map((d, i) => [d, bc[i]]));
  const pairs = [];
  for (let i = Math.max(1, t.length - n); i < t.length; i++) {
    const b0 = bm.get(t[i - 1]), b1 = bm.get(t[i]);
    if (ok(c[i]) && ok(c[i - 1]) && ok(b0) && ok(b1) && c[i - 1] && b0) pairs.push([c[i] / c[i - 1] - 1, b1 / b0 - 1]);
  }
  if (pairs.length < 40) return null;
  const mx = pairs.reduce((a, p) => a + p[0], 0) / pairs.length;
  const my = pairs.reduce((a, p) => a + p[1], 0) / pairs.length;
  let cov = 0, vy = 0, vx = 0;
  for (const [x, y] of pairs) { cov += (x - mx) * (y - my); vy += (y - my) ** 2; vx += (x - mx) ** 2; }
  return { beta: vy ? cov / vy : null, corr: vx && vy ? cov / Math.sqrt(vx * vy) : null, n: pairs.length };
}

/** Klasik pivot seviyeleri (son tamamlanan günün yüksek/düşük/kapanışı). */
export function pivots(h, l, c) {
  const i = c.length - 1;
  if (i < 0 || !ok(h[i]) || !ok(l[i]) || !ok(c[i])) return null;
  const P = (h[i] + l[i] + c[i]) / 3;
  return { P, R1: 2 * P - l[i], S1: 2 * P - h[i], R2: P + (h[i] - l[i]), S2: P - (h[i] - l[i]) };
}

// ---------------------------------------------------------------- özet sinyaller

/** Her gösterge için al/sat/nötr; toplam skor -1..1. Mekanik bir okuma, tavsiye değil. */
export function signals(d) {
  const { c, h, l } = d;
  const price = last(c);
  const ma = [];
  for (const n of [10, 20, 50, 100, 200]) {
    for (const [kind, fn] of [['SMA', sma], ['EMA', ema]]) {
      const v = last(fn(c, n));
      if (v == null || c.filter(ok).length < n) continue;
      ma.push({ key: `${kind}${n}`, name: `${kind === 'SMA' ? 'Basit' : 'Üssel'} ortalama ${n}`, value: v, sig: price > v * 1.001 ? 1 : price < v * 0.999 ? -1 : 0 });
    }
  }
  const osc = [];
  const r = rsi(c), rv = last(r), rp = prevOf(r);
  if (rv != null) osc.push({ key: 'RSI', name: 'RSI (14)', value: rv, sig: rv < 30 ? 1 : rv > 70 ? -1 : 0, extra: { prev: rp } });
  const st = stoch(h, l, c), kv = last(st.k), dv = last(st.d);
  if (kv != null && dv != null) osc.push({ key: 'STOCH', name: 'Stokastik %K (14, 3, 3)', value: kv, sig: kv < 20 && kv > dv ? 1 : kv > 80 && kv < dv ? -1 : 0, extra: { d: dv } });
  const cc = cci(h, l, c), cv = last(cc), cpv = prevOf(cc);
  if (cv != null) osc.push({ key: 'CCI', name: 'Emtia kanal endeksi CCI (20)', value: cv, sig: cv < -100 && cv > cpv ? 1 : cv > 100 && cv < cpv ? -1 : 0 });
  const ax = adx(h, l, c), av = last(ax.adx), pdi = last(ax.pdi), mdi = last(ax.mdi);
  if (av != null) osc.push({ key: 'ADX', name: 'ADX trend gücü (14)', value: av, sig: av > 20 ? (pdi > mdi ? 1 : -1) : 0, extra: { pdi, mdi } });
  const mo = momentum(c, 10), mv = last(mo);
  if (mv != null) osc.push({ key: 'MOM', name: 'Momentum (10)', value: mv, sig: mv > 0 ? 1 : mv < 0 ? -1 : 0, extra: { pct: price ? mv / (price - mv) : null } });
  const md = macd(c), mdv = last(md.macd), sgv = last(md.signal), hv = last(md.hist), hpv = prevOf(md.hist);
  if (mdv != null && sgv != null) osc.push({ key: 'MACD', name: 'MACD (12, 26, 9)', value: mdv, sig: mdv > sgv ? 1 : mdv < sgv ? -1 : 0, extra: { signal: sgv, hist: hv, histPrev: hpv } });
  const w = willr(h, l, c), wv = last(w);
  if (wv != null) osc.push({ key: 'WILLR', name: 'Williams %R (14)', value: wv, sig: wv < -80 ? 1 : wv > -20 ? -1 : 0 });
  const bb = bollinger(c), bu = last(bb.upper), bl = last(bb.lower), pb = last(bb.pctB);
  if (bu != null) osc.push({ key: 'BB', name: 'Bollinger bantları (20, 2)', value: pb, sig: price < bl ? 1 : price > bu ? -1 : 0, extra: { upper: bu, lower: bl, mid: last(bb.mid), width: last(bb.width) } });
  const score = (arr) => (arr.length ? arr.reduce((a, x) => a + x.sig, 0) / arr.length : 0);
  const all = [...ma, ...osc];
  const count = (arr) => ({ buy: arr.filter((x) => x.sig > 0).length, sell: arr.filter((x) => x.sig < 0).length, neutral: arr.filter((x) => x.sig === 0).length });
  return {
    price, ma, osc,
    maScore: score(ma), oscScore: score(osc), total: score(all),
    maCount: count(ma), oscCount: count(osc), count: count(all),
  };
}

export function verdict(score) {
  if (score >= 0.5) return { key: 2, label: 'Güçlü al' };
  if (score > 0.1) return { key: 1, label: 'Al' };
  if (score >= -0.1) return { key: 0, label: 'Nötr' };
  if (score > -0.5) return { key: -1, label: 'Sat' };
  return { key: -2, label: 'Güçlü sat' };
}
