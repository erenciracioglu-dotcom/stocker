// Pencereler: defter ve pozisyon düzenleme, içe aktarma önizlemesi, bağlantıyla taşıma, onay.
import { h, add, fill, icon, toast, num, price, money, fmtDate, todayISO, isNum, curSymbol, fold } from '../util.js';
import * as store from '../store.js';
import * as data from '../data.js';
import { trSector } from '../calc.js';

function dialogShell(title, { wide = false } = {}) {
  const dlg = h('dialog', { 'aria-label': title, style: wide ? { width: 'min(720px, calc(100vw - 24px))' } : null });
  const body = h('div.dlg-body');
  const foot = h('div.dlg-foot');
  const close = h('button.icon-btn', { type: 'button', 'aria-label': 'Kapat', onclick: () => dlg.close() }, icon('close'));
  dlg.appendChild(h('form.dlg', { method: 'dialog', onsubmit: (e) => e.preventDefault() }, h('div.dlg-head', h('h2', title), close), body, foot));
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 50));
  document.body.appendChild(dlg);
  return { dlg, body, foot, open: () => dlg.showModal() };
}

const field = (label, input, hint) => h('label.field', h('span', label), input, hint ? h('div.hint', hint) : null);
const parseNum = (v) => { const x = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(x) ? x : null; };

export function confirmDialog(title, text, { ok = 'Onayla', danger = false } = {}) {
  return new Promise((resolve) => {
    const d = dialogShell(title);
    d.body.appendChild(h('p', text));
    let result = false;
    add(d.foot, 
      h('button.btn', { type: 'button', onclick: () => d.dlg.close() }, 'Vazgeç'),
      h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: () => { result = true; d.dlg.close(); } }, ok),
    );
    d.dlg.addEventListener('close', () => resolve(result));
    d.open();
  });
}

// ---------------------------------------------------------------- defter

export function openPortfolioDialog(existing, { onSaved } = {}) {
  const isNew = !existing;
  const p = existing ? JSON.parse(JSON.stringify(existing)) : store.newPortfolio('USD');
  const d = dialogShell(isNew ? 'Yeni defter' : 'Defteri düzenle');
  const title = h('input', { value: p.title, required: true, placeholder: 'Örn. Biyotek katalizör sepeti', maxlength: 80 });
  const kicker = h('input', { value: p.kicker || '', placeholder: 'Örn. Yeni USD defteri', maxlength: 60 });
  const desc = h('textarea', { placeholder: 'Bu defterin amacı, stratejisi, çıkış planı…', maxlength: 600 }, p.description || '');
  const cur = h('select', { disabled: !isNew && p.positions.length > 0 },
    ...['USD', 'TRY', 'EUR'].map((c) => h('option', { value: c, selected: c === p.currency }, { USD: 'ABD doları (USD)', TRY: 'Türk lirası (TRY)', EUR: 'Euro (EUR)' }[c])));
  const entry = h('input', { type: 'date', value: p.entryDate, max: todayISO() });
  const cash = h('input', { inputmode: 'decimal', value: p.cash ? String(p.cash) : '0' });
  let accent = p.accent;
  const sw = h('div.swatches', { role: 'group', 'aria-label': 'Defter rengi' });
  const drawSw = () => {
    fill(sw, ...store.ACCENTS.map((a) => h('button.swatch', { type: 'button', style: { background: a }, 'aria-label': a, 'aria-pressed': String(a === accent), onclick: () => { accent = a; drawSw(); } })),
      h('input', { type: 'color', value: accent, 'aria-label': 'Özel renk', style: { width: '36px', height: '28px', border: 0, background: 'none', padding: 0 }, oninput: (e) => { accent = e.target.value; } }));
  };
  drawSw();
  cur.addEventListener('change', () => { if (isNew && !kicker.dataset.touched) kicker.value = cur.value === 'TRY' ? 'Yeni TL defteri' : `Yeni ${cur.value} defteri`; });
  kicker.addEventListener('input', () => { kicker.dataset.touched = '1'; });

  add(d.body, 
    field('Ad', title),
    field('Üst başlık', kicker, 'Defter adının üstünde küçük yazıyla görünür.'),
    field('Açıklama', desc),
    h('div.row2', field('Para birimi', cur, !isNew && p.positions.length ? 'Hisse varken değiştirilemez.' : null), field('Başlangıç tarihi', entry, 'Getiri bu tarihten itibaren hesaplanır.')),
    field(`Nakit (${curSymbol(cur.value)})`, cash, 'Hisseye yatırılmamış, defterde bekleyen para.'),
    h('div.field', h('span', 'Renk'), sw),
  );
  if (!isNew) {
    d.foot.appendChild(h('button.btn.danger.left', {
      type: 'button',
      onclick: async () => {
        const ok = await confirmDialog('Defteri sil', `"${p.title}" ve içindeki ${p.positions.length} hisse silinecek. Bu işlem geri alınamaz; önce dışa aktarmak istersen vazgeç.`, { ok: 'Defteri sil', danger: true });
        if (ok) { store.remove(p.id); d.dlg.close(); toast('Defter silindi'); location.hash = '#/'; }
      },
    }, icon('trash', 16), 'Sil'));
  }
  add(d.foot, 
    h('button.btn', { type: 'button', onclick: () => d.dlg.close() }, 'Vazgeç'),
    h('button.btn.primary', {
      type: 'submit',
      onclick: () => {
        if (!title.value.trim()) { title.focus(); title.reportValidity?.(); return; }
        const c = parseNum(cash.value);
        Object.assign(p, {
          title: title.value.trim(), kicker: kicker.value.trim(), description: desc.value.trim(),
          currency: cur.value, locale: cur.value === 'TRY' ? 'tr-TR' : 'en-US',
          entryDate: entry.value || todayISO(), cash: c ?? 0, accent,
        });
        const saved = store.commit(p);
        d.dlg.close();
        toast(isNew ? 'Defter oluşturuldu' : 'Defter kaydedildi');
        onSaved?.(saved);
      },
    }, isNew ? 'Defteri oluştur' : 'Kaydet'),
  );
  d.open();
  title.focus();
}

// ---------------------------------------------------------------- pozisyon

/** portfolioId verilmezse defter seçtirilir (hisse sayfasındaki "Deftere ekle"). */
export function openPositionDialog({ portfolioId, index = -1, symbol = '' } = {}) {
  const list = store.list();
  if (!list.length) { toast('Önce bir defter oluştur'); openPortfolioDialog(null); return; }
  let p = store.get(portfolioId) || null;
  const editing = p && index >= 0 ? JSON.parse(JSON.stringify(p.positions[index])) : null;
  const d = dialogShell(editing ? `${editing.ticker} pozisyonunu düzenle` : 'Hisse ekle');

  const pick = h('select', null, ...list.map((x) => h('option', { value: x.id, selected: p ? x.id === p.id : false }, `${x.title} (${x.currency})`)));
  if (!p) p = list[0];
  const sym = h('input', { value: editing?.symbol || symbol, placeholder: 'Örn. PYPD ya da THYAO', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', list: 'sym-options' });
  const dl = h('datalist#sym-options', null, ...data.directory().filter((x) => !x.s.startsWith('^') && !x.s.includes('=')).map((x) => h('option', { value: x.s }, x.n)));
  const name = h('input', { value: editing?.name || '' });
  const sector = h('input', { value: editing?.sector || '', placeholder: 'Diğer' });
  const mode = { by: 'lots' };
  const lots = h('input', { inputmode: 'decimal', value: editing ? String(editing.lots) : '' });
  const amount = h('input', { inputmode: 'decimal', placeholder: 'Örn. 1000' });
  const entry = h('input', { inputmode: 'decimal', value: editing ? String(editing.entryPrice) : '' });
  const date = h('input', { type: 'date', value: editing?.entryDate || (editing ? p.entryDate : todayISO()), max: todayISO() });
  const note = h('textarea', { placeholder: 'Örn. PDUFA kararı bekleniyor; 11 $ üstünde kâr al.', maxlength: 500 }, editing?.note || '');
  const events = (editing?.events || []).map((e) => ({ ...e }));
  const evBox = h('div', { style: { display: 'grid', gap: '8px' } });
  let priceSource = editing?.priceSource || 'manual';
  const status = h('div.hint');
  const quickRow = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
  const lotsField = field('Lot (adet)', lots, 'Kesirli lot da girebilirsin, örn. 179,86.');
  const amountField = field('Tutar', amount, 'Lot, tutar ÷ giriş fiyatı olarak hesaplanır.');
  amountField.hidden = true;
  const byCtl = h('div.seg-ctl', { role: 'group', 'aria-label': 'Miktar girişi' },
    h('button', { type: 'button', 'aria-pressed': 'true', onclick: (e) => setBy('lots', e) }, 'Lot ile'),
    h('button', { type: 'button', 'aria-pressed': 'false', onclick: (e) => setBy('amount', e) }, 'Tutar ile'));
  function setBy(by) {
    mode.by = by;
    byCtl.children[0].setAttribute('aria-pressed', String(by === 'lots'));
    byCtl.children[1].setAttribute('aria-pressed', String(by === 'amount'));
    lotsField.hidden = by !== 'lots';
    amountField.hidden = by !== 'amount';
  }

  const normSym = () => {
    let v = sym.value.trim().toUpperCase();
    if (!v) return '';
    if (!data.hasData(v) && p.currency === 'TRY' && !v.includes('.') && !v.startsWith('^') && data.hasData(v + '.IS')) v += '.IS';
    else if (!data.hasData(v) && p.currency === 'TRY' && !v.includes('.') && !v.startsWith('^')) v += '.IS';
    return v;
  };
  async function refreshSym() {
    const v = normSym();
    fill(quickRow);
    if (!v) { status.textContent = ''; return; }
    const q = data.quote(v);
    if (!q) {
      status.innerHTML = '';
      add(status, h('span', { class: 'badge warn' }, 'Veri yok'), ` ${v} henüz veri listesinde değil. Ekleyebilirsin; fiyatı, sembol tickers.json'a eklenip veri güncellenince gelir.`);
      return;
    }
    status.textContent = `${q.n || v} · son fiyat ${price(q.p, q.cur)}${q.cur !== p.currency ? ` (${q.cur})` : ''}`;
    if (!name.value || name.dataset.auto) { name.value = q.n || v; name.dataset.auto = '1'; }
    if (!sector.value || sector.dataset.auto) { sector.value = q.sec ? trSector(q.sec) : 'Diğer'; sector.dataset.auto = '1'; }
    const r = data.fx(q.cur, p.currency) ?? 1;
    add(quickRow, h('button.btn.small', { type: 'button', onclick: () => { entry.value = String(+(q.p * r).toFixed(4)); priceSource = 'manual'; } }, `Son fiyat ${num(q.p * r, 2)}`));
    try {
      const hist = await data.loadHistory(v);
      const di = hist.t.lastIndexOf(hist.t.filter((t) => t <= (date.value || todayISO())).pop());
      if (di >= 0) {
        add(quickRow, 
          h('button.btn.small', { type: 'button', onclick: () => { entry.value = String(+(hist.o[di] * r).toFixed(4)); priceSource = 'opening'; } }, `Açılış ${fmtDate(hist.t[di], { year: false })}: ${num(hist.o[di] * r, 2)}`),
          h('button.btn.small', { type: 'button', onclick: () => { entry.value = String(+(hist.c[di] * r).toFixed(4)); priceSource = 'closing'; } }, `Kapanış: ${num(hist.c[di] * r, 2)}`),
        );
      }
    } catch { /* geçmiş yoksa yalnız son fiyat */ }
  }
  sym.addEventListener('change', refreshSym);
  sym.addEventListener('blur', refreshSym);
  date.addEventListener('change', refreshSym);
  name.addEventListener('input', () => { delete name.dataset.auto; });
  sector.addEventListener('input', () => { delete sector.dataset.auto; });
  pick.addEventListener('change', () => { p = store.get(pick.value); refreshSym(); });

  function drawEvents() {
    fill(evBox, ...events.map((e, i) => h('div', { style: { display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: '8px' } },
      h('input', { type: 'date', value: e.date || '', 'aria-label': 'Olay tarihi', oninput: (ev) => { e.date = ev.target.value; }, style: { height: '36px', border: '1px solid var(--rule-strong)', borderRadius: '6px', padding: '0 8px', background: 'var(--raised)' } }),
      h('input', { value: e.label || '', placeholder: 'Örn. FDA kararı (PDUFA)', 'aria-label': 'Olay açıklaması', oninput: (ev) => { e.label = ev.target.value; }, style: { height: '36px', border: '1px solid var(--rule-strong)', borderRadius: '6px', padding: '0 10px', background: 'var(--raised)' } }),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Olayı kaldır', onclick: () => { events.splice(i, 1); drawEvents(); } }, icon('close', 16)))),
    h('button.btn.small', { type: 'button', style: { justifySelf: 'start' }, onclick: () => { events.push({ date: '', label: '' }); drawEvents(); } }, icon('plus', 14), 'Tarih ekle'));
  }
  drawEvents();

  add(d.body, 
    portfolioId && index >= 0 ? null : field('Defter', pick),
    dl,
    field('Sembol', sym, 'Yahoo Finance kodu. BIST hisseleri .IS ile biter; TL defterinde sonek otomatik eklenir.'),
    status,
    h('div.row2', field('Ad', name), field('Sektör', sector)),
    byCtl,
    h('div.row2', lotsField, amountField, field('Giriş fiyatı', entry), field('Alış tarihi', date)),
    quickRow,
    field('Not', note),
    h('div.field', h('span', 'Önemli tarihler'), h('div.hint', 'FDA kararı, bilanço, temettü gibi tarihler genel bakıştaki takvimde görünür.'), evBox),
  );
  if (editing) {
    d.foot.appendChild(h('button.btn.danger.left', {
      type: 'button',
      onclick: async () => {
        const ok = await confirmDialog('Pozisyonu sil', `${editing.ticker} bu defterden çıkarılacak.`, { ok: 'Çıkar', danger: true });
        if (!ok) return;
        const fresh = store.get(p.id);
        fresh.positions.splice(index, 1);
        store.commit(fresh);
        d.dlg.close();
        toast(`${editing.ticker} çıkarıldı`);
      },
    }, icon('trash', 16), 'Çıkar'));
  }
  add(d.foot, 
    h('button.btn', { type: 'button', onclick: () => d.dlg.close() }, 'Vazgeç'),
    h('button.btn.primary', {
      type: 'submit',
      onclick: () => {
        const s = normSym();
        const ep = parseNum(entry.value);
        let lt = parseNum(lots.value);
        if (mode.by === 'amount') { const a = parseNum(amount.value); lt = a && ep ? +(a / ep).toFixed(4) : null; }
        if (!s) { sym.focus(); return toast('Sembol gerekli', { kind: 'error' }); }
        if (!(lt > 0)) return toast('Lot ya da tutar gir', { kind: 'error' });
        if (!(ep > 0)) { entry.focus(); return toast('Giriş fiyatı gerekli', { kind: 'error' }); }
        const target = store.get(p.id);
        const ticker = s.replace(/\.IS$/, '');
        const pos = {
          ...(editing || {}),
          ticker, symbol: s, name: name.value.trim() || ticker, sector: sector.value.trim() || 'Diğer',
          lots: lt, entryPrice: ep, priceSource,
        };
        if (date.value && date.value !== target.entryDate) pos.entryDate = date.value; else delete pos.entryDate;
        if (note.value.trim()) pos.note = note.value.trim(); else delete pos.note;
        const ev = events.filter((e) => e.date && e.label?.trim()).map((e) => ({ date: e.date, label: e.label.trim() }));
        if (ev.length) pos.events = ev; else delete pos.events;
        if (editing && portfolioId === target.id && index >= 0) target.positions[index] = pos;
        else target.positions.push(pos);
        store.commit(target);
        d.dlg.close();
        toast(editing ? `${ticker} güncellendi` : `${ticker}, ${target.title} defterine eklendi`);
      },
    }, editing ? 'Kaydet' : 'Ekle'),
  );
  d.open();
  if (sym.value) refreshSym(); else sym.focus();
}

// ---------------------------------------------------------------- içe aktarma

const STATUS = { new: 'Yeni', newer: 'Daha yeni', older: 'Daha eski', same: 'Aynı' };

export function openImportDialog(incoming, { source = 'dosya', onDone } = {}) {
  const plan = store.planImport(incoming);
  const d = dialogShell('İçe aktar');
  const counts = { new: 0, newer: 0, older: 0, same: 0 };
  plan.forEach((x) => counts[x.status]++);
  add(d.body, 
    h('p', `${source === 'bağlantı' ? 'Bağlantıda' : 'Dosyada'} ${incoming.length} defter var. Birleştirince yeni defterler eklenir, aynı defterin daha yeni sürümü eskisinin yerini alır.`),
    h('ul.import-list', null, ...plan.map(({ p, status }) => h('li', { style: { '--acc': p.accent } },
      h('span.spine'),
      h('div', h('div.t', p.title), h('div.m', `${p.positions.length} hisse · ${p.currency} · ${fmtDate(p.updatedAt)}`)),
      h('span', { class: `badge ${status === 'older' ? 'warn' : ''}` }, STATUS[status])))),
    counts.older ? h('div.callout', icon('alert'), h('div.grow', `${counts.older} defterin bu cihazdaki hali daha yeni; birleştirmede korunur. Gelen sürümü zorla almak için "Hepsini üzerine yaz"ı seç.`)) : null,
  );
  const finish = (mode) => {
    const r = store.applyImport(incoming, mode);
    d.dlg.close();
    const parts = [];
    if (r.added) parts.push(`${r.added} defter eklendi`);
    if (r.updated) parts.push(`${r.updated} güncellendi`);
    if (r.skipped) parts.push(`${r.skipped} değişmedi`);
    toast(parts.join(', ') || 'Değişiklik yok');
    onDone?.(r);
  };
  add(d.foot, 
    store.list().length ? h('button.btn.danger.left', { type: 'button', onclick: async () => {
      const ok = await confirmDialog('Tümünü değiştir', `Bu cihazdaki ${store.list().length} defter silinip yerine gelen ${incoming.length} defter konacak.`, { ok: 'Tümünü değiştir', danger: true });
      if (ok) finish('replace');
    } }, 'Tümünü değiştir') : null,
    counts.older ? h('button.btn', { type: 'button', onclick: () => finish('all') }, 'Hepsini üzerine yaz') : null,
    h('button.btn', { type: 'button', onclick: () => d.dlg.close() }, 'Vazgeç'),
    h('button.btn.primary', { type: 'submit', onclick: () => finish('merge') }, 'Birleştir'),
  );
  d.open();
}

export async function importFile(file, opts) {
  try {
    const text = await file.text();
    const list = store.parseImport(text);
    openImportDialog(list, opts);
  } catch (e) {
    toast(e.message || 'Dosya okunamadı', { kind: 'error', ms: 5000 });
  }
}

export function pickFile(opts) {
  // accept kısıtı yok: Android'de WhatsApp/Drive'dan inen .json dosyaları bazen türsüz görünür
  const input = h('input', { type: 'file', style: { display: 'none' } });
  input.addEventListener('change', () => { if (input.files[0]) importFile(input.files[0], opts); input.remove(); });
  document.body.appendChild(input);
  input.click();
}

export function openPasteDialog(opts) {
  const d = dialogShell('JSON yapıştır');
  const ta = h('textarea', { style: { minHeight: '180px', fontSize: '12.5px' }, placeholder: '{ "format": "stocker.portfolios", … }' });
  add(d.body, field('Dışa aktarılmış JSON ya da taşıma bağlantısı', ta));
  add(d.foot, 
    h('button.btn', { type: 'button', onclick: () => d.dlg.close() }, 'Vazgeç'),
    h('button.btn.primary', { type: 'submit', onclick: async () => {
      const v = ta.value.trim();
      try {
        let list;
        const m = v.match(/#\/al\?d=([\w.\-]+)/);
        if (m) list = store.parseImport(await store.decodePayload(m[1]));
        else list = store.parseImport(v);
        d.dlg.close();
        openImportDialog(list, opts);
      } catch (e) { toast(e.message || 'Okunamadı', { kind: 'error', ms: 5000 }); }
    } }, 'Devam'),
  );
  d.open();
  ta.focus();
}

/** #/al?d=... bağlantısıyla gelen defterleri içe aktarır. */
export async function importFromLink(payload) {
  try {
    const obj = await store.decodePayload(payload);
    const list = store.parseImport(obj);
    history.replaceState(null, '', location.pathname + location.search + '#/');
    openImportDialog(list, { source: 'bağlantı', onDone: () => { location.hash = '#/'; } });
  } catch (e) {
    toast(e.message || 'Bağlantı açılamadı', { kind: 'error', ms: 6000 });
    location.hash = '#/';
  }
}

// ---------------------------------------------------------------- bağlantıyla taşıma

export async function openTransferDialog(list = store.list()) {
  if (!list.length) return toast('Taşınacak defter yok');
  const d = dialogShell('Başka cihaza taşı');
  const link = await store.makeLink(list);
  const box = h('div.linkbox', link);
  add(d.body, 
    h('p', `${list.length === 1 ? `"${list[0].title}" defteri` : `${list.length} defterin tamamı`} bu bağlantının içinde. Bağlantıyı WhatsApp'ta ya da e-postayla kendine gönder; diğer cihazda açınca defterler içe aktarılır.`),
    box,
    h('div.callout.info', icon('info'), h('div.grow', h('span', 'Veri bağlantının # işaretinden sonraki kısmında durur; tarayıcı bu kısmı hiçbir sunucuya göndermez. Bağlantıyı ele geçiren defterlerini görebilir, o yüzden yalnız kendine gönder.'))),
  );
  add(d.foot, 
    h('button.btn.left', { type: 'button', onclick: () => { store.exportFile(list); } }, icon('download', 16), 'Dosya olarak indir'),
    navigator.share ? h('button.btn', { type: 'button', onclick: async () => { try { await navigator.share({ title: 'Stocker defterleri', url: link }); } catch { /* vazgeçildi */ } } }, icon('share', 16), 'Paylaş') : null,
    h('button.btn.primary', { type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(link); toast('Bağlantı kopyalandı'); } catch {
        const r = document.createRange(); r.selectNodeContents(box); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        toast('Seçili bağlantıyı kopyala (Ctrl+C)');
      }
    } }, icon('copy', 16), 'Kopyala'),
  );
  d.open();
}

/** Veri listesinde olmayan sembolleri tickers.json'a ekler (isteğe bağlı GitHub anahtarıyla). */
export async function ghAddSymbols(symbols) {
  const { owner, repo, token } = store.settings().gh;
  if (!token) throw new Error('GitHub anahtarı tanımlı değil.');
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/tickers.json`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const res = await fetch(api, { headers, cache: 'no-store' });
  if (!res.ok) throw new Error(`tickers.json okunamadı (${res.status}). Anahtarın bu repoda "Contents: Read and write" izni olmalı.`);
  const cur = await res.json();
  const text = new TextDecoder().decode(Uint8Array.from(atob(cur.content.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
  const cfg = JSON.parse(text);
  const have = new Set([...(cfg.portfolio || []), ...(cfg.benchmarks || []), ...(cfg.watch || [])]);
  const add = symbols.filter((s) => !have.has(s));
  if (!add.length) return [];
  cfg.portfolio = [...(cfg.portfolio || []), ...add];
  cfg.watch = (cfg.watch || []).filter((s) => !add.includes(s));
  const out = JSON.stringify(cfg, null, 2) + '\n';
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(out)));
  const put = await fetch(api, { method: 'PUT', headers, body: JSON.stringify({ message: `Takip listesine eklendi: ${add.join(', ')}`, content: b64, sha: cur.sha }) });
  if (!put.ok) throw new Error(`tickers.json güncellenemedi (${put.status}).`);
  return add;
}

export { fold };
