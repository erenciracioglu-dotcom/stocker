// Değerleme: pozisyon ve defter değerleri, kâr/zarar serileri, dağılımlar.
import { fx, fxSeries, getMarket } from './data.js';
import { isNum } from './util.js';

const sum = (a) => a.reduce((x, y) => x + (isNum(y) ? y : 0), 0);

export const SECTOR_TR = {
  'Technology': 'Teknoloji', 'Healthcare': 'Sağlık', 'Financial Services': 'Finans', 'Real Estate': 'Gayrimenkul',
  'Basic Materials': 'Temel malzemeler', 'Consumer Cyclical': 'Döngüsel tüketim', 'Consumer Defensive': 'Temel tüketim',
  'Industrials': 'Sanayi', 'Communication Services': 'İletişim', 'Energy': 'Enerji', 'Utilities': 'Kamu hizmetleri',
};
export const trSector = (s) => SECTOR_TR[s] || s;

export function valuePosition(pos, pcur) {
  const q = getMarket()?.quotes?.[pos.symbol] || null;
  const qcur = q?.cur || pcur;
  const r = fx(qcur, pcur) ?? 1;
  const lots = +pos.lots || 0;
  const entry = +pos.entryPrice || 0;
  const cost = lots * entry;
  const price = isNum(q?.p) ? q.p * r : null;
  const prev = isNum(q?.pc) ? q.pc * r : null;
  const value = price != null ? lots * price : null;
  const pl = value != null ? value - cost : null;
  const plPct = value != null && cost ? pl / cost : null;
  const dayChg = price != null && prev != null ? lots * (price - prev) : null;
  const dayPct = isNum(q?.p) && isNum(q?.pc) && q.pc ? q.p / q.pc - 1 : null;
  const ext = isNum(q?.xp) && isNum(q?.p) ? { price: q.xp * r, pct: q.xp / q.p - 1, state: q.xs, time: q.xt } : null;
  const sector = pos.sector && pos.sector !== 'Diğer' ? pos.sector : (q?.sec ? trSector(q.sec) : (pos.sector || 'Diğer'));
  return { pos, q, r, lots, entry, cost, price, prev, value, pl, plPct, dayChg, dayPct, ext, sector, missing: !q };
}

export function valuePortfolio(p) {
  const rows = p.positions.map((x) => valuePosition(x, p.currency));
  const cost = sum(rows.map((r) => r.cost));
  const value = sum(rows.map((r) => (r.value != null ? r.value : r.cost)));
  const cash = +p.cash || 0;
  const total = value + cash;
  const pl = value - cost;
  const plPct = cost ? pl / cost : null;
  const dayChg = sum(rows.map((r) => r.dayChg));
  const prevTotal = total - dayChg;
  const dayPct = prevTotal ? dayChg / prevTotal : null;
  for (const r of rows) r.weight = total ? (r.value ?? r.cost) / total : 0;
  return { p, rows, cost, value, cash, total, pl, plPct, dayChg, dayPct, missing: rows.filter((r) => r.missing).map((r) => r.pos.symbol) };
}

/** Tüm defterlerin toplamı, istenen para biriminde (güncel kurla). */
export function totals(portfolios, cur) {
  let total = 0, dayChg = 0, pl = 0, cost = 0, ok = true;
  const parts = [];
  for (const p of portfolios) {
    const v = valuePortfolio(p);
    const r = fx(p.currency, cur);
    if (r == null) { ok = false; continue; }
    total += v.total * r; dayChg += v.dayChg * r; pl += v.pl * r; cost += v.cost * r;
    parts.push({ p, v, r });
  }
  const prev = total - dayChg;
  return { total, dayChg, dayPct: prev ? dayChg / prev : null, pl, plPct: cost ? pl / cost : null, cost, parts, ok };
}

/** Bir sembolün tüm defterlerdeki pozisyonları. */
export function holdingsOf(symbol, portfolios) {
  const out = [];
  for (const p of portfolios) for (const pos of p.positions) if (pos.symbol === symbol) out.push({ p, pos, row: valuePosition(pos, p.currency) });
  return out;
}

/** market.json içindeki 6 aylık kapanışlardan seri haritası. */
export function spMap(symbols) {
  const q = getMarket()?.quotes || {};
  const out = {};
  for (const s of symbols) if (q[s]?.sp?.t) out[s] = { t: q[s].sp.t, c: q[s].sp.c, cur: q[s].cur };
  return out;
}

/** Bir defterin günlük kâr/zarar serisi (giriş tarihinden bugüne). */
export function plSeries(p, seriesMap) {
  const start = p.entryDate;
  const pos = p.positions.filter((x) => seriesMap[x.symbol]?.t?.length);
  const dates = new Set();
  for (const x of pos) for (const d of seriesMap[x.symbol].t) if (d >= (x.entryDate || start)) dates.add(d);
  const sorted = [...dates].sort();
  const idx = pos.map(() => -1);
  const conv = pos.map((x) => fx(seriesMap[x.symbol].cur || p.currency, p.currency) ?? 1);
  const out = { t: [], pl: [], cost: [], value: [] };
  for (const d of sorted) {
    let pl = 0, cost = 0, value = 0, active = 0;
    pos.forEach((x, k) => {
      const s = seriesMap[x.symbol];
      while (idx[k] + 1 < s.t.length && s.t[idx[k] + 1] <= d) idx[k]++;
      if (d < (x.entryDate || start) || idx[k] < 0) return;
      const c = s.c[idx[k]];
      if (!isNum(c)) return;
      const lots = +x.lots || 0;
      const px = c * conv[k];
      pl += lots * (px - x.entryPrice);
      cost += lots * x.entryPrice;
      value += lots * px;
      active++;
    });
    if (!active) continue;
    out.t.push(d); out.pl.push(pl); out.cost.push(cost); out.value.push(value + (+p.cash || 0));
  }
  return out;
}

/** Tüm defterlerin toplam kâr/zararı, istenen para biriminde, günlük kurla. */
export function combinedPL(portfolios, cur) {
  const usdtry = fxSeries('USDTRY=X');
  const liveRate = fx('USD', 'TRY');
  const per = portfolios.map((p) => ({ p, s: plSeries(p, spMap(p.positions.map((x) => x.symbol))) })).filter((x) => x.s.t.length);
  const dates = [...new Set(per.flatMap((x) => x.s.t))].sort();
  let lastRate = liveRate;
  const rateAt = (d) => {
    const r = usdtry?.get(d);
    if (isNum(r)) lastRate = r;
    return lastRate;
  };
  const ptr = per.map(() => -1);
  const t = [], v = [];
  for (const d of dates) {
    const rate = rateAt(d);
    let tot = 0, any = false;
    per.forEach(({ p, s }, k) => {
      while (ptr[k] + 1 < s.t.length && s.t[ptr[k] + 1] <= d) ptr[k]++;
      if (ptr[k] < 0) return;
      let val = s.pl[ptr[k]];
      if (p.currency !== cur) {
        if (p.currency === 'USD' && cur === 'TRY') val *= rate;
        else if (p.currency === 'TRY' && cur === 'USD') val /= rate;
        else val *= fx(p.currency, cur) ?? 1;
      }
      tot += val; any = true;
    });
    if (any) { t.push(d); v.push(tot); }
  }
  return { t, v };
}

/** Sektör dağılımı: en büyük beş ve "Diğer". */
export function sectorAlloc(vp, max = 5) {
  const m = new Map();
  for (const r of vp.rows) m.set(r.sector, (m.get(r.sector) || 0) + (r.value ?? r.cost));
  if (vp.cash > 0) m.set('Nakit', (m.get('Nakit') || 0) + vp.cash);
  let arr = [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  if (arr.length > max + 1) {
    const rest = arr.slice(max);
    arr = arr.slice(0, max).concat([{ name: 'Diğer', value: sum(rest.map((x) => x.value)), folded: rest.map((x) => x.name) }]);
  }
  const tot = sum(arr.map((x) => x.value));
  return arr.map((x) => ({ ...x, weight: tot ? x.value / tot : 0 }));
}

export function dayBefore(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.toISOString().slice(0, 10);
}
