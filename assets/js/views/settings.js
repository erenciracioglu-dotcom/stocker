// Ayarlar: taşıma ve yedek, görünüm, veri listesi, hakkında.
import { h, icon, toast, fmtDateTime, ago, fmtDate } from '../util.js';
import * as store from '../store.js';
import * as data from '../data.js';
import { pickFile, openPasteDialog, openTransferDialog, confirmDialog, ghAddSymbols, importFile } from './dialogs.js';

export function renderSettings() {
  const view = h('div.view');
  const st = store.settings();
  const list = store.list();
  const market = data.getMarket();

  view.append(h('a.backlink', { href: '#/' }, icon('back', 16), 'Genel bakış'), h('h1', { style: { fontStretch: '112%', fontWeight: 680, fontSize: '1.7rem', letterSpacing: '-0.015em' } }, 'Ayarlar ve taşıma'));

  // ---- taşıma
  const drop = h('div.drop',
    h('b', 'JSON dosyasını buraya bırak ya da seç'),
    h('span.hint', 'Biçim önceki Stocker ile aynı (stocker.portfolios, şema 1). Aynı kimlikli defterlerin daha yeni sürümü eskisinin yerini alır.'),
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
      h('button.btn', { type: 'button', onclick: () => pickFile() }, icon('upload', 16), 'Dosya seç'),
      h('button.btn', { type: 'button', onclick: () => openPasteDialog() }, 'Metin ya da bağlantı yapıştır')));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) importFile(f); });

  const transfer = h('section.panel', { 'aria-label': 'Taşıma ve yedek' },
    h('div.panel-head', h('h2', 'Cihazlar arasında taşıma')),
    h('div.setting-row',
      h('div', h('div.t', 'Bağlantıyla taşı'), h('div.d', 'Tüm defterler sıkıştırılıp tek bir bağlantıya konur. Kendine WhatsApp ya da e-postayla gönder, diğer cihazda aç.')),
      h('button.btn.primary', { type: 'button', disabled: !list.length, onclick: () => openTransferDialog() }, icon('link', 16), 'Bağlantı oluştur')),
    h('div.setting-row',
      h('div', h('div.t', 'Dosyaya aktar'), h('div.d', `portfoylerim-tarih.json olarak iner.${st.lastBackup ? ` Son dışa aktarma: ${fmtDateTime(st.lastBackup)}.` : ''}`)),
      h('button.btn', { type: 'button', disabled: !list.length, onclick: () => { store.exportFile(); toast('Dosya indirildi'); } }, icon('download', 16), 'Dışa aktar')),
    h('div', { style: { paddingTop: '12px' } }, drop));

  // ---- görünüm
  const seg = (key, options, onChange) => h('div.seg-ctl', { role: 'group' },
    ...options.map(([val, label]) => h('button', { type: 'button', 'aria-pressed': String(st[key] === val), onclick: () => { store.setSetting(key, val); onChange?.(val); window.dispatchEvent(new Event('stocker:settings')); } }, label)));
  const look = h('section.panel', { 'aria-label': 'Görünüm' },
    h('div.panel-head', h('h2', 'Görünüm')),
    h('div.setting-row', h('div', h('div.t', 'Tema'), h('div.d', 'Sistem seçeneği telefonun ya da bilgisayarın ayarını izler.')),
      seg('theme', [['system', 'Sistem'], ['light', 'Açık'], ['dark', 'Koyu']])),
    h('div.setting-row', h('div', h('div.t', 'Sayı biçimi'), h('div.d', 'Türkçe: 1.234,56 · İngilizce: 1,234.56')),
      seg('numLocale', [['tr-TR', 'Türkçe'], ['en-US', 'İngilizce']])),
    h('div.setting-row', h('div', h('div.t', 'Toplamın para birimi'), h('div.d', 'Genel bakıştaki toplam değer ve kâr/zarar.')),
      seg('totalCur', [['TRY', 'TL'], ['USD', 'USD']])));

  // ---- veri
  const { owner, repo } = st.gh;
  const held = [...new Set(list.flatMap((p) => p.positions.map((x) => x.symbol)))];
  const missing = held.filter((s) => market && !data.hasData(s));
  const tokenInput = h('input', { type: 'password', value: st.gh.token || '', placeholder: 'github_pat_…', autocomplete: 'off', style: { height: '36px', border: '1px solid var(--rule-strong)', borderRadius: '6px', padding: '0 10px', background: 'var(--raised)', width: 'min(320px, 100%)' } });
  const errCount = Object.keys(market?.errors || {}).length;
  const dataPanel = h('section.panel', { 'aria-label': 'Veri' },
    h('div.panel-head', h('h2', 'Piyasa verisi')),
    h('div.setting-row',
      h('div', h('div.t', 'Son güncelleme'), h('div.d', market ? `${fmtDateTime(market.generated)} (${ago(market.generated)}). ${Object.keys(market.quotes || {}).length} sembol. GitHub Actions hafta içi borsa saatlerinde yarım saatte bir çalışır.${errCount ? ` Son çalıştırmada ${errCount} uyarı var.` : ''}` : 'Veri yüklenemedi.')),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button.btn', { type: 'button', onclick: async () => { try { await data.loadMarket({ force: true }); toast('Veri yenilendi'); window.dispatchEvent(new Event('stocker:rerender')); } catch { toast('Veri alınamadı', { kind: 'error' }); } } }, icon('refresh', 16), 'Yenile'),
        h('a.btn.quiet', { href: `https://github.com/${owner}/${repo}/actions`, target: '_blank', rel: 'noopener' }, 'Çalıştırmalar'))),
    h('div.setting-row',
      h('div', h('div.t', 'Veri listesi'), h('div.d', `Fiyatı izlenen semboller tickers.json dosyasında. Yeni bir hisse eklediğinde sembolünü "portfolio" listesine yaz; bir sonraki çalıştırmada verisi gelir.`),
        missing.length ? h('div', { style: { marginTop: '8px' } }, h('span.badge.warn', `Listede olmayan: ${missing.join(', ')}`)) : h('div.hint', { style: { marginTop: '6px' } }, 'Defterlerindeki tüm hisseler listede.')),
      h('a.btn', { href: `https://github.com/${owner}/${repo}/edit/main/tickers.json`, target: '_blank', rel: 'noopener' }, icon('github', 16), 'tickers.json\'u düzenle')),
    h('div.setting-row',
      h('div', h('div.t', 'Otomatik ekleme (isteğe bağlı)'),
        h('div.d', 'Yalnız bu repoya "Contents: Read and write" izni olan ince ayarlı bir GitHub anahtarı girersen, listede olmayan hisseler tek dokunuşla eklenir. Anahtar yalnız bu tarayıcıda saklanır.'),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } }, tokenInput,
          h('button.btn.small', { type: 'button', onclick: () => { store.setSetting('gh', { ...st.gh, token: tokenInput.value.trim() }); toast(tokenInput.value.trim() ? 'Anahtar kaydedildi' : 'Anahtar silindi'); } }, 'Kaydet'))),
      h('button.btn.primary', {
        type: 'button', disabled: !missing.length,
        onclick: async (e) => {
          const btn = e.currentTarget;
          if (!store.settings().gh.token) return toast('Önce anahtarı kaydet ya da tickers.json\'u elle düzenle', { kind: 'error', ms: 4500 });
          btn.disabled = true;
          try {
            const added = await ghAddSymbols(missing);
            toast(added.length ? `${added.join(', ')} eklendi; veri birkaç dakika içinde gelir` : 'Hepsi zaten listede', { ms: 5000 });
          } catch (err) { toast(err.message, { kind: 'error', ms: 6000 }); btn.disabled = false; }
        },
      }, 'Eksikleri ekle')));

  // ---- tehlikeli bölge ve hakkında
  const about = h('section.panel', { 'aria-label': 'Hakkında' },
    h('div.panel-head', h('h2', 'Hakkında')),
    h('p.note', 'Stocker defterlerini yalnız bu tarayıcıda (localStorage) tutar; sitede ya da GitHub\'da portföy verin durmaz. Tarayıcı verisini silersen defterler de gider, ara ara dışa aktarmak iyi olur.'),
    h('p.note', { style: { marginTop: '8px' } }, 'Fiyat ve temel veriler Yahoo Finance\'ten yfinance ile alınır; gecikmeli ve hatalı olabilir. Bu uygulama yatırım tavsiyesi vermez.'),
    h('p.note', { style: { marginTop: '8px' } }, 'Grafikler: ', h('a', { href: 'https://www.tradingview.com/', target: '_blank', rel: 'noopener' }, 'TradingView Lightweight Charts™'), '. Yazı tipi: Archivo (SIL OFL).'),
    h('div.setting-row', { style: { marginTop: '10px' } },
      h('div', h('div.t', 'Bu cihazdaki tüm defterleri sil'), h('div.d', `${list.length} defter silinir. Önce dışa aktarmayı unutma.`)),
      h('button.btn.danger', { type: 'button', disabled: !list.length, onclick: async () => {
        const ok = await confirmDialog('Tümünü sil', 'Bu cihazdaki tüm defterler silinecek. Geri alınamaz.', { ok: 'Tümünü sil', danger: true });
        if (ok) { store.clearAll(); toast('Defterler silindi'); location.hash = '#/'; }
      } }, icon('trash', 16), 'Tümünü sil')));

  view.appendChild(h('div.settings-grid', h('div.view', transfer, dataPanel), h('div.view', look, about)));
  return { el: view };
}
