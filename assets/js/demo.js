// Örnek defter: hiç defteri olmayan bir tarayıcıda ilk açılışta kurulur, Stocker'ın neye benzediğini gösterir.
// Dışa aktarmaya ve taşıma bağlantısına girmez; ilk içe aktarmada kendiliğinden kalkar.
import * as store from './store.js';
import * as data from './data.js';
import { isoDate, isNum } from './util.js';

export const DEMO_ID = 'ornek-bist-uclusu';
const BUDGET = 100000;
const PICKS = [
  { symbol: 'THYAO.IS', ticker: 'THYAO', name: 'Türk Hava Yolları', sector: 'Havacılık' },
  { symbol: 'ASELS.IS', ticker: 'ASELS', name: 'Aselsan', sector: 'Savunma' },
  { symbol: 'ALARK.IS', ticker: 'ALARK', name: 'Alarko Holding', sector: 'Holding' },
];

/** Üç ay önceki ilk ortak işlem gününün açılış fiyatlarıyla, eşit tutarlı ve tam lotlu bir sepet. */
export async function buildDemo() {
  const hists = await Promise.all(PICKS.map((p) => data.loadHistory(p.symbol)));
  const target = isoDate(new Date(Date.now() - 91 * 86400000));
  const sets = hists.map((x) => new Set(x.t));
  const entry = hists[0].t.find((d) => d >= target && sets.every((s) => s.has(d)));
  if (!entry) throw new Error('Örnek defter için ortak işlem günü bulunamadı');
  const per = BUDGET / PICKS.length;
  let spent = 0;
  const positions = PICKS.map((p, i) => {
    const x = hists[i];
    const k = x.t.indexOf(entry);
    const px = isNum(x.o[k]) ? x.o[k] : x.c[k];
    const lots = Math.floor(per / px);
    spent += lots * px;
    return { ticker: p.ticker, symbol: p.symbol, name: p.name, sector: p.sector, lots, priceSource: 'opening', entryPrice: px };
  });
  return store.normPortfolio({
    id: DEMO_ID,
    demo: true,
    title: 'Örnek defter',
    kicker: 'Borsa İstanbul, deneme',
    description: `Stocker'ın neye benzediğini görmen için hazır bir örnek: THY, Aselsan ve Alarko'ya eşit pay ayrılmış 100.000 TL, üç ay önceki açılış fiyatlarıyla. Tam lot sonrası kalan tutar nakitte. Kendi defterlerini içe aktardığında bu örnek kendiliğinden kalkar.`,
    capital: BUDGET,
    cash: Math.round((BUDGET - spent) * 100) / 100,
    currency: 'TRY',
    locale: 'tr-TR',
    entryDate: entry,
    accent: '#0f766e',
    revision: 1,
    updatedAt: new Date().toISOString(),
    positions,
  });
}

/** Tarayıcıda hiç defter yoksa ve örnek daha önce kurulmadıysa kurar. */
export async function seedDemoIfNeeded() {
  if (store.list().length || store.settings().demoSeeded || location.hash.startsWith('#/al')) return false;
  const demo = await buildDemo();
  store.addDemo(demo);
  store.setSetting('demoSeeded', true);
  return true;
}

/** Ayarlardan örneği yeniden ekler (bugünden üç ay geriye bakarak). */
export async function restoreDemo() {
  if (store.get(DEMO_ID)) return false;
  store.addDemo(await buildDemo());
  return true;
}

export function removeDemo() {
  store.list().filter((p) => p.demo).forEach((p) => store.remove(p.id));
}
