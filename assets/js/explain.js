// Göstergelerin ve oranların günlük dille açıklamaları.
import { num, pct, compact } from './util.js';

const f1 = (v) => num(v, 1);
const f2 = (v) => num(v, 2);

export const TA_TEXT = {
  RSI: (v) => {
    const base = 'Son 14 günde yükselişlerin düşüşlere göre gücünü 0–100 arasında ölçer.';
    if (v < 30) return `${base} ${f1(v)} ile aşırı satım bölgesinde: fiyat kısa sürede çok düşmüş. Tepki yükselişi ihtimali artar, ama düşüşün sürmesi de olağandır.`;
    if (v > 70) return `${base} ${f1(v)} ile aşırı alım bölgesinde: fiyat kısa sürede çok yükselmiş. Soluklanma ya da geri çekilme ihtimali artar.`;
    if (v >= 50) return `${base} ${f1(v)}: alıcılar biraz daha baskın, ama aşırılık yok.`;
    return `${base} ${f1(v)}: satıcılar biraz daha baskın, ama aşırılık yok.`;
  },
  STOCH: (v) => {
    const base = 'Fiyatın son 14 günün en düşük–en yüksek aralığında nerede kapandığını gösterir (0 = dip, 100 = tepe).';
    if (v < 20) return `${base} ${f1(v)}: aralığın dibine yakın; dönüş sinyali için %K'nın %D'yi yukarı kesmesi beklenir.`;
    if (v > 80) return `${base} ${f1(v)}: aralığın tepesine yakın; yükseliş yorulabilir.`;
    return `${base} ${f1(v)}: aralığın ortalarında.`;
  },
  CCI: (v) => `Fiyatın 20 günlük ortalamasından ne kadar saptığını ölçer; ±100 dışı olağan dışı hareket demektir. Şu an ${num(v, 0)}${v > 100 ? ': ortalamanın belirgin üstünde, güçlü yükseliş ama aşırılık riski var.' : v < -100 ? ': ortalamanın belirgin altında, sert düşüş sonrası tepki gelebilir.' : ': olağan aralıkta.'}`,
  ADX: (v, x = {}) => {
    const dir = x.pdi > x.mdi ? 'yukarı yönlü baskı (+DI, −DI\'nın üstünde)' : 'aşağı yönlü baskı (−DI, +DI\'nın üstünde)';
    const strength = v < 20 ? 'belirgin bir trend yok, fiyat yatay ya da kararsız' : v < 25 ? 'trend yeni oluşuyor' : v < 40 ? 'belirgin bir trend var' : 'çok güçlü bir trend var';
    return `Yönü değil, trendin gücünü ölçer. ${num(v, 0)}: ${strength}; ${dir}.`;
  },
  MOM: (v, x = {}) => `Bugünkü fiyatın 10 işlem günü öncesine farkı. Fiyat 10 gün öncesinin ${x.pct != null ? pct(Math.abs(x.pct), { sign: false }) + ' ' + (v >= 0 ? 'üstünde' : 'altında') : (v >= 0 ? 'üstünde' : 'altında')}.`,
  MACD: (v, x = {}) => {
    const cross = v > x.signal ? 'MACD sinyal çizgisinin üstünde: yükseliş ivmesi baskın.' : 'MACD sinyal çizgisinin altında: düşüş ivmesi baskın.';
    const accel = x.hist != null && x.histPrev != null ? (Math.abs(x.hist) > Math.abs(x.histPrev) ? ' Fark açılıyor, ivme güçleniyor.' : ' Fark kapanıyor, ivme zayıflıyor.') : '';
    return `İki üssel ortalamanın (12 ve 26 gün) farkı. ${cross}${accel}`;
  },
  WILLR: (v) => `Stokastiğe benzer; 0 ile −100 arasında. −80 altı aşırı satım, −20 üstü aşırı alım sayılır. Şu an ${num(v, 0)}${v < -80 ? ': aşırı satımda.' : v > -20 ? ': aşırı alımda.' : ': arada.'}`,
  BB: (v, x = {}) => {
    const pos = v == null ? '' : v > 1 ? 'Fiyat üst bandın dışında: olağan dışı güçlü yükseliş, geri çekilme riski.' : v < 0 ? 'Fiyat alt bandın dışında: olağan dışı düşüş, tepki gelebilir.' : v > 0.8 ? 'Fiyat üst banda yakın.' : v < 0.2 ? 'Fiyat alt banda yakın.' : 'Fiyat bandın ortalarında.';
    const w = x.width != null ? ` Bant genişliği ${pct(x.width, { sign: false, digits: 1 })}; daralma çoğu zaman sert bir hareketin habercisidir.` : '';
    return `20 günlük ortalamanın iki standart sapma üstü ve altı. ${pos}${w}`;
  },
  MA: (sig) => sig > 0 ? 'Fiyat bu ortalamanın üstünde: o vadede eğilim yukarı.' : sig < 0 ? 'Fiyat bu ortalamanın altında: o vadede eğilim aşağı.' : 'Fiyat ortalamanın üzerinde ya da çok yakınında.',
};

export function crossText(s50, s200) {
  if (s50 == null || s200 == null) return null;
  return s50 > s200
    ? '50 günlük ortalama 200 günlüğün üstünde: uzun vadeli eğilim yukarı ("altın kesişim" bölgesi).'
    : '50 günlük ortalama 200 günlüğün altında: uzun vadeli eğilim aşağı ("ölüm kesişimi" bölgesi).';
}

export const RISK_TEXT = {
  vol: (v) => `Günlük hareketlerin yıllığa çevrilmiş oynaklığı. ${v > 0.8 ? 'Çok yüksek: küçük biyotek ve spekülatif hisselerde görülür, bir yılda fiyatın yarıya inmesi ya da ikiye katlanması olağandır.' : v > 0.45 ? 'Yüksek: sert iniş çıkışlara hazırlıklı olmak gerekir.' : v > 0.25 ? 'Orta düzey.' : 'Düşük: büyük, oturmuş şirketler gibi sakin.'}`,
  mdd: (v) => `Son bir yılda zirveden dibe en büyük düşüş. Bu hisseyi tutan biri en kötü anda değerinin ${pct(Math.abs(v), { sign: false, digits: 0 })} kadarını kaybetmiş görünüyordu.`,
  beta: (b, bench) => `${bench} %1 hareket ettiğinde bu hisse ortalama %${num(b, 2)} hareket etmiş. ${b > 1.3 ? 'Piyasadan belirgin oynak.' : b > 0.8 ? 'Piyasayla benzer oynaklıkta.' : b > 0 ? 'Piyasadan sakin.' : 'Piyasayla ters ya da ilişkisiz.'}`,
  atr: (v, p) => `Hisse günde tipik olarak ${p ? pct(v / p, { sign: false, digits: 1 }) : ''} kadar oynuyor (14 günlük ortalama gerçek aralık). Zarar-kes mesafesini ayarlarken işe yarar.`,
  range52: (pos) => `Fiyat 52 haftalık aralığın ${pct(pos, { sign: false, digits: 0 })} noktasında (sol uç yılın dibi, sağ uç yılın zirvesi).`,
  rvol: (x) => `Son işlem gününün hacmi 20 günlük ortalamanın ${num(x, 1)} katı.${x > 2 ? ' Olağan dışı ilgi var; çoğu zaman bir haber ya da beklentiyle gelir.' : x < 0.5 ? ' İlgi zayıf.' : ''}`,
  pivots: 'Önceki günün yüksek, düşük ve kapanışından hesaplanan kısa vadeli destek (S) ve direnç (R) seviyeleri. Yatırımcılar çoğu zaman bu seviyelerde tepki verir.',
};

// ---------------------------------------------------------------- temel veriler

export function sizeClass(mc) {
  if (!(mc > 0)) return null;
  if (mc < 300e6) return 'mikro ölçek';
  if (mc < 2e9) return 'küçük ölçek';
  if (mc < 10e9) return 'orta ölçek';
  if (mc < 200e9) return 'büyük ölçek';
  return 'dev ölçek';
}

export const FUND_TEXT = {
  marketCap: (v) => `Şirketin borsadaki toplam değeri (hisse sayısı × fiyat). ${sizeClass(v) ? sizeClass(v)[0].toLocaleUpperCase('tr-TR') + sizeClass(v).slice(1) + ' bir şirket.' : ''}`,
  enterpriseValue: () => 'Piyasa değerine borç eklenip nakit düşülmüş hali: şirketi bütünüyle satın almanın maliyeti.',
  trailingPE: (v) => v > 0 ? `Şirketin değeri son 12 aylık net kârının ${f1(v)} katı. Kabaca: kâr sabit kalsa yatırım kendini ${num(v, 0)} yılda öder. ${v > 40 ? 'Yüksek; piyasa güçlü büyüme bekliyor.' : v < 8 ? 'Düşük; ucuz ya da piyasa kârların düşmesini bekliyor.' : ''}` : 'Şirket zarar ettiği için F/K hesaplanamıyor.',
  forwardPE: (v) => v > 0 ? `Analistlerin önümüzdeki 12 ayın kâr tahminine göre F/K: ${f1(v)}. Mevcut F/K'dan düşükse kârın artması bekleniyor.` : 'Analistler önümüzdeki dönemde de zarar bekliyor.',
  pegRatio: (v) => `F/K'nın beklenen büyüme hızına oranı. 1 civarı "büyümesine göre makul", 2 üstü pahalı sayılır. Şu an ${f2(v)}.`,
  priceToBook: (v) => `Piyasa değerinin özsermayeye oranı. ${v < 1 ? 'Şirket defter değerinin altında işlem görüyor.' : v > 5 ? 'Piyasa, şirketi defter değerinin çok üstünde fiyatlıyor (marka, teknoloji ya da büyüme beklentisi).' : 'Olağan aralıkta.'}`,
  priceToSalesTrailing12Months: (v) => `Piyasa değeri yıllık satışların ${f1(v)} katı. Kâr etmeyen büyüme şirketlerinde F/K yerine buna bakılır.`,
  enterpriseToEbitda: (v) => v > 0 ? `Firma değeri faaliyet kârının (FAVÖK) ${f1(v)} katı. Borçlu ve borçsuz şirketleri karşılaştırmayı kolaylaştırır.` : 'Faaliyet kârı negatif olduğu için anlamlı değil.',
  grossMargins: (v) => `Her 100 birim satıştan üretim maliyeti düşüldükten sonra ${num(v * 100, 0)} birim kalıyor.`,
  operatingMargins: (v) => `Faaliyet giderleri de düşülünce her 100 birim satıştan ${num(v * 100, 0)} birim ${v < 0 ? 'zarar' : 'kalıyor'}.`,
  profitMargins: (v) => v < 0 ? `Şirket her 100 birim satışta ${num(Math.abs(v) * 100, 0)} birim net zarar ediyor.` : `Her 100 birim satıştan ${num(v * 100, 0)} birim net kâr.`,
  returnOnEquity: (v) => `Özsermaye kârlılığı: ortakların koyduğu her 100 birimle yılda ${num(v * 100, 0)} birim ${v < 0 ? 'zarar' : 'kâr'}. ${v > 0.2 ? 'Güçlü.' : ''}`,
  returnOnAssets: (v) => `Şirketin tüm varlıkları üzerinden yıllık kârlılık: %${num(v * 100, 1)}.`,
  revenueGrowth: (v) => `Son çeyreğin satışları geçen yılın aynı çeyreğine göre ${pct(v, { digits: 0 })}.`,
  earningsGrowth: (v) => `Son çeyreğin kârı geçen yılın aynı çeyreğine göre ${pct(v, { digits: 0 })}.`,
  totalCash: () => 'Kasadaki nakit ve kısa vadeli yatırımlar.',
  totalDebt: () => 'Toplam finansal borç.',
  debtToEquity: (v) => `Her 100 birim özsermayeye karşı ${num(v, 0)} birim borç. ${v > 200 ? 'Borç yükü ağır.' : v < 50 ? 'Borç yükü hafif.' : ''}`,
  currentRatio: (v) => `Bir yıl içinde nakde dönecek varlıklar, bir yıl içinde ödenecek borçların ${f1(v)} katı. ${v < 1 ? '1\'in altı kısa vadede nakit sıkışıklığı riskine işaret eder.' : ''}`,
  runway: (months) => `Mevcut nakit, son 12 aydaki yakım hızıyla yaklaşık ${num(months, 0)} ay yeter. ${months < 12 ? 'Bir yılın altı: yakın vadede sermaye artırımı (yeni hisse satışı ve sulandırma) ya da borçlanma ihtimali yüksek.' : months < 24 ? 'Orta vadede yeni finansman gerekebilir.' : 'Rahat bir nakit tamponu var.'}`,
  dividendYield: (v) => v > 0 ? `Hisse fiyatına göre yıllık temettü getirisi: ${pct(v, { sign: false })}.` : 'Şirket temettü ödemiyor.',
  payoutRatio: (v) => `Kârın ${pct(v, { sign: false, digits: 0 })} kadarı temettü olarak dağıtılıyor.`,
  shortPercentOfFloat: (v) => `Dolaşımdaki hisselerin ${pct(v, { sign: false, digits: 1 })} kadarı açığa satılmış. ${v > 0.2 ? 'Çok yüksek: iyi bir haberde açığa satanların toplu kapatmasıyla sert yükseliş (short squeeze) görülebilir; kötü haberde baskı artar.' : v > 0.1 ? 'Yüksek: piyasada belirgin bir düşüş beklentisi var.' : 'Düşük: açığa satış baskısı yok.'}`,
  shortRatio: (v) => `Açığa satılan hisselerin, ortalama günlük hacimle geri alınması yaklaşık ${f1(v)} gün sürer. Uzadıkça short squeeze potansiyeli artar.`,
  heldPercentInsiders: (v) => `Hisselerin ${pct(v, { sign: false, digits: 1 })} kadarı yöneticiler ve büyük ortaklarda.`,
  heldPercentInstitutions: (v) => `Hisselerin ${pct(v, { sign: false, digits: 0 })} kadarı fonlar ve kurumlar elinde.`,
  beta: (v) => `Yahoo'nun 5 yıllık betası: piyasa %1 oynadığında hisse ortalama %${f2(v)} oynamış.`,
  trailingEps: (v) => `Hisse başına son 12 aylık ${v < 0 ? 'zarar' : 'kâr'}.`,
  bookValue: () => 'Hisse başına özsermaye (defter değeri).',
  recommendationMean: (v, n) => `${n || ''} analistin ortalaması ${f1(v)} (1 = güçlü al, 3 = tut, 5 = güçlü sat).`,
  target: (mean, price) => price && mean ? `Analistlerin ortalama 12 aylık hedefi bugünkü fiyatın ${pct(mean / price - 1, { digits: 0 })} ${mean >= price ? 'üstünde' : 'altında'}. Hedefler sık sık güncellenir; kesinlik değil, beklenti gösterir.` : '',
  shares: (chg) => chg > 0.02 ? `Hisse sayısı dönem içinde ${pct(chg, { digits: 0 })} arttı: yeni hisse satışı (sulandırma) var; mevcut ortağın payı küçülüyor.` : chg < -0.02 ? `Hisse sayısı ${pct(chg, { digits: 0 })} azaldı: şirket geri alım yapıyor.` : 'Hisse sayısı dönem içinde kayda değer değişmedi.',
};

export function bigMoney(v, cur) {
  if (!Number.isFinite(v)) return '—';
  const sym = { USD: '$', TRY: '₺', EUR: '€' }[cur] || '';
  return `${v < 0 ? '−' : ''}${sym}${compact(Math.abs(v), { digits: 1 })}`;
}
