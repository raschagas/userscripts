// ==UserScript==
// @name         Filtro de lojas — nota e vendas em cada anúncio
// @namespace    raschagas/userscripts
// @version      1.1.0
// @description  Marca cada anúncio com um círculo verde, vermelho ou cinza pela nota e pela quantidade de avaliações ou vendas, esmaece ou oculta os reprovados, some com patrocinados reprovados e corrige links de combos do AliExpress. Ajustes por site.
// @match        https://*.aliexpress.com/*
// @match        https://www.amazon.com.br/*
// @match        https://www.kabum.com.br/*
// @match        https://*.mercadolivre.com.br/*
// @match        https://shopee.com.br/*
// @match        https://www.magazineluiza.com.br/*
// @match        https://www.americanas.com.br/*
// @match        https://www.casasbahia.com.br/*
// @match        https://www.temu.com/*
// @match        https://*.shein.com/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/raschagas/userscripts/main/src/shop-filter.user.js
// @updateURL    https://raw.githubusercontent.com/raschagas/userscripts/main/src/shop-filter.user.js
// ==/UserScript==

(() => {
  'use strict';

  // ---------- armazenamento (por dispositivo) ----------
  const get = (k, d) => { try { const v = GM_getValue(k, d); return v === undefined ? d : v; } catch (_) { return d; } };
  const set = (k, v) => { try { GM_setValue(k, v); } catch (_) { /* sem gerenciador: só nesta visita */ } };
  const menu = (t, f) => { try { GM_registerMenuCommand(t, f); } catch (_) { /* sem menu */ } };

  // ---------- tokens do padrão visual (--us-*, iguais nos quatro scripts) ----------
  const TOKENS = `:root{--us-font:system-ui,"Segoe UI",Roboto,"Noto Sans",sans-serif;--us-pass:#16a34a;--us-fail:#dc2626;--us-unknown:#64748b;--us-accent:#2563eb;--us-surface:#ffffff;--us-surface-2:#f3f4f6;--us-text:#111827;--us-text-2:#4b5563;--us-border:#e5e7eb;--us-float-bg:rgba(17,24,39,.92);--us-float-text:#f9fafb;--us-chip-bg:rgba(17,24,39,.85);--us-radius-s:6px;--us-radius-m:14px;--us-radius-pill:999px;--us-shadow:0 8px 28px rgba(0,0,0,.28);--us-motion:.15s;--us-gap:12px;--us-dot:16px;--us-target:44px;--us-veil:rgba(255,255,255,.55);--us-z:2147483646;--us-svc-jellyfin:#0077a8;--us-svc-seerr:#4f46e5;--us-svc-mealie:#b45309;--us-svc-skyscanner:#0062e3;--us-svc-gflights:#1a73e8}
@media (prefers-color-scheme:dark){:root{--us-surface:#1f2937;--us-surface-2:#111827;--us-text:#f9fafb;--us-text-2:#cbd5e1;--us-border:#374151;--us-float-bg:rgba(249,250,251,.94);--us-float-text:#111827}}
@media (prefers-reduced-motion:reduce){:root{--us-motion:0s}}`;
  function injectTokens() {
    if (document.getElementById('us-tokens')) return;
    const s = document.createElement('style'); s.id = 'us-tokens'; s.textContent = TOKENS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ---------- números (pt-BR e en) ----------
  const NBSP = /[   ]/g;
  // Contagens são inteiras ("1.234 vendidos", "1,234 sold", "5 mil+", "1,2k"):
  // '.' e ',' só são milhar, exceto com multiplicador (1,2 mil = 1200).
  function toInt(raw) {
    if (raw == null) return null;
    let s = String(raw).trim().toLowerCase().replace(NBSP, ' ').replace(/\+\s*$/, '').trim();
    if (!s) return null;
    let mult = 1;
    const suf = s.match(/^(.*?)\s*(mil|k|m)\.?$/);
    if (suf) { s = suf[1].trim(); mult = suf[2] === 'm' ? 1e6 : 1e3; }
    if (!s) return null;
    let v;
    if (mult > 1 && /^\d{1,3}[.,]\d{1,2}$/.test(s)) v = parseFloat(s.replace(',', '.'));
    else { const d = s.replace(/[.,\s]/g, ''); if (!/^\d+$/.test(d)) return null; v = parseInt(d, 10); }
    return isFinite(v) ? Math.round(v * mult) : null;
  }
  const toRating = raw => { const v = parseFloat(String(raw).replace(',', '.')); return isFinite(v) ? Math.round(v * 10) / 10 : null; };
  const round1 = x => Math.round(x * 10) / 10;

  const NUM = '(\\d+(?:[.,\\u00a0]\\d+)*)';
  const RE_REVIEWS = new RegExp(NUM + '\\s*(k|mil)?\\s*\\+?\\s*(?:avalia[çc][õo]es|avalia[çc][ãa]o|classifica[çc][õo]es|classifica[çc][ãa]o|opini[õo]es|reviews?|ratings?)', 'i');
  const RE_SOLD = new RegExp(NUM + '\\s*(k|mil|m)?\\s*\\+?\\s*(?:vendid[oa]s?|vendid[oa]\\(s\\)|vendas|sold|orders)', 'i');
  const RE_OF5 = /([0-5](?:[.,]\d{1,2})?)\s*(?:de|\/|out of)\s*5(?:[.,]0)?(?!\d)/i;
  const RE_STARS = /([0-5](?:[.,]\d)?)\s*(?:estrelas?|stars?)/i;
  const RE_BARE = /^([1-5](?:[.,]\d)?)$/;
  const STAR_CTX = '[class*="star" i], [class*="rating" i], [aria-label*="estrela" i], [aria-label*="star" i]';
  // Número solto só é nota com contexto: estrelas/"de 5" no cartão ou vizinho (até 2 linhas) da linha de vendidos.
  function bareRating(c, L) {
    const i = L.findIndex(s => RE_BARE.test(s)); if (i < 0) return null;
    const ctx = !!c.querySelector(STAR_CTX) || /★|de 5\b|out of 5/i.test(L.join('\n'));
    const j = L.findIndex(s => RE_SOLD.test(s));
    if (!ctx && !(j >= 0 && Math.abs(j - i) <= 2)) return null;
    return RE_BARE.exec(L[i]);
  }
  const RE_PARENS = /^\(\s*(\d+(?:[.,]\d+)*)\s*(k|mil)?\s*\+?\s*\)$/i;
  const SPONSORED = /(^|\n)\s*(Anúncio|Patrocinado|Patrocinados|Sponsored|Promovido|Publicidade)\b/;

  const qsa = (sel, root) => { try { return [...(root || document).querySelectorAll(sel)]; } catch (_) { return []; } };
  const linesOf = el => (el.innerText || el.textContent || '').split('\n').map(s => s.replace(NBSP, ' ').trim()).filter(Boolean);
  function attrTexts(el) {
    const out = [];
    for (const n of [el, ...qsa('[aria-label],[title],[alt]', el).slice(0, 80)]) {
      for (const a of ['aria-label', 'title', 'alt']) { const v = n.getAttribute && n.getAttribute(a); if (v) out.push(v); }
    }
    return out;
  }
  // Extração genérica: atributos semânticos primeiro, texto como reserva. Ausente = null.
  function genericRating(el, lines) {
    for (const t of attrTexts(el)) { const m = RE_OF5.exec(t) || RE_STARS.exec(t); if (m) return toRating(m[1]); }
    const txt = lines.join('\n'); const m = RE_OF5.exec(txt) || RE_STARS.exec(txt);
    return m ? toRating(m[1]) : null;
  }
  function genericCount(el, lines) {
    for (const t of attrTexts(el)) { const m = RE_REVIEWS.exec(t); if (m) return { count: toInt(m[1] + (m[2] ? ' ' + m[2] : '')), countKind: 'reviews' }; }
    const txt = lines.join('\n');
    let m = RE_REVIEWS.exec(txt); if (m) return { count: toInt(m[1] + (m[2] ? ' ' + m[2] : '')), countKind: 'reviews' };
    for (const l of lines) { m = RE_PARENS.exec(l); if (m) return { count: toInt(m[1] + (m[2] ? ' ' + m[2] : '')), countKind: 'reviews' }; }
    m = RE_SOLD.exec(txt); if (m) return { count: toInt(m[1] + (m[2] ? ' ' + m[2] : '')), countKind: 'sold' };
    return { count: null, countKind: null };
  }
  const generic = el => { const L = linesOf(el); return Object.assign({ rating: genericRating(el, L) }, genericCount(el, L)); };
  const sponsoredText = el => SPONSORED.test(el.innerText || '');
  // Pai da primeira imagem; sem caixa (display:contents dá retângulo zerado), a própria imagem.
  const imgAnchor = c => {
    const i = c.querySelector('img'); if (!i) return c;
    const p = i.parentElement;
    if (p && p !== c && c.contains(p)) { const r = p.getBoundingClientRect(); if (r.width && r.height) return p; }
    return i;
  };
  // A maior imagem já desenhada do cartão (a foto do produto); selos, bandeiras e ícones ficam de fora.
  function bigImg(c, sel) {
    let best = null, area = 400;
    for (const i of qsa(sel || 'img', c)) { const r = i.getBoundingClientRect(); if (r.width * r.height > area) { area = r.width * r.height; best = i; } }
    return best;
  }
  // Um cartão por elemento externo: evita contar o mesmo produto duas vezes.
  function outermost(list) { const s = new Set(list); return list.filter(e => { for (let p = e.parentElement; p; p = p.parentElement) if (s.has(p)) return false; return true; }); }

  // ---------- adaptadores (só sabem ler a página) ----------
  // Contrato: cards() lista os cartões; wrapper/anchor/extract/sponsored leem cada um e devolvem
  // nota e contagem na escala nativa, ou null quando o cartão não mostra o dado.
  const ADAPTERS = [
    { id: 'aliexpress', name: 'AliExpress', host: /(^|\.)aliexpress\.com$/, scale: 5, product: /\/item\/(\d{6,})\.html|productIds?=(\d{6,})/i,
      cards: () => {
        const pc = qsa('a[class*="cards--card--"]'); if (pc.length) return pc;
        const seen = new Set(), out = [];
        for (const a of qsa('[class^="galleryItem--"] a[href*="/item/"], [class*=" galleryItem--"] a[href*="/item/"]')) {
          const g = a.closest('[class^="galleryItem--"], [class*=" galleryItem--"]'); if (seen.has(g)) continue; seen.add(g); out.push(a);
        }
        return out;
      },
      extract: c => {
        const L = linesOf(c);
        const r = bareRating(c, L);
        const m = RE_SOLD.exec(L.join('\n'));
        const g = r || m ? null : generic(c);
        return g || { rating: r ? toRating(r[1]) : null, count: m ? toInt(m[1] + (m[2] ? ' ' + m[2] : '')) : null, countKind: m ? 'sold' : null };
      },
      anchor: imgAnchor,
      wrapper: c => c.closest('[class*="card-out-wrapper"]') || c.closest('[class^="galleryItem--"], [class*=" galleryItem--"]') || c,
      sponsored: (c, w) => sponsoredText(c) || sponsoredText(w) },
    { id: 'amazon', name: 'Amazon', host: /(^|\.)amazon\.com\.br$/, scale: 5, product: /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/,
      cards: () => qsa('[data-component-type="s-search-result"]'),
      extract: c => {
        const s = (c.querySelector('.a-icon-alt') || {}).textContent || '';
        const m = RE_OF5.exec(s);
        let n = null;
        for (const t of attrTexts(c)) { const x = /^([\d.,]+\s*(?:mil|k)?)\s*\+?\s*(?:classifica|avalia)/i.exec(t.trim()); if (x) { n = toInt(x[1]); break; } }
        if (n == null) { const u = c.querySelector('a[href*="customerReviews"] .s-underline-text, a[href*="customerReviews"] span'); const x = u && RE_PARENS.exec(`(${u.textContent.trim().replace(/[()]/g, '')})`); if (x) n = toInt(x[1] + (x[2] ? ' ' + x[2] : '')); }
        const g = m && n != null ? null : generic(c);
        return { rating: m ? toRating(m[1]) : g.rating, count: n != null ? n : g.count, countKind: 'reviews' };
      },
      // Grade (PC): a moldura quadrada da foto fica no mesmo lugar em todos os cartões da fileira, e a foto
      // dentro dela muda com a proporção; selos ("Escolha da Amazon") ficam acima da moldura. Lista (celular):
      // a foto fica centrada num contêiner mais alto e o círculo vai na própria imagem.
      anchor: c => {
        for (const f of qsa('.s-image-square-aspect', c)) { const r = f.getBoundingClientRect(); if (r.width * r.height > 400) return f; }
        return bigImg(c, 'img.s-image') || c.querySelector('.s-product-image-container') || imgAnchor(c);
      },
      wrapper: c => c,
      sponsored: c => !!c.querySelector('.puis-sponsored-label-text, [data-component-type="sp-sponsored-result"], .s-sponsored-label-text') || sponsoredText(c) },
    { id: 'kabum', name: 'KaBuM', host: /(^|\.)kabum\.com\.br$/, scale: 5, product: /\/produto\/(\d+)/, noCount: true,
      cards: () => qsa('a[href*="/produto/"].group'),
      extract: c => { const m = /Avalia[cç][aã]o\s*([\d.,]+)\s*de\s*5/i.exec(c.innerText || ''); return { rating: m ? toRating(m[1]) : generic(c).rating, count: null, countKind: null }; },
      anchor: imgAnchor, wrapper: c => c, sponsored: c => sponsoredText(c) },
    // Shopee: a busca exige login (o navegador automatizado não abre); conferida com o dono logado no Edge
    // e com um esqueleto do DOM real. Os últimos li chegam vazios (carregam ao rolar): não são cartões ainda.
    { id: 'shopee', name: 'Shopee', host: /(^|\.)shopee\.com\.br$/, scale: 5, product: /-i\.(\d+\.\d+)/,
      cards: () => outermost(qsa('li.shopee-search-item-result__item, [data-sqe="item"]')).filter(c => c.querySelector('a[href]')),
      extract: c => { const L = linesOf(c); const r = bareRating(c, L); const g = generic(c); return { rating: r ? toRating(r[1]) : g.rating, count: g.count, countKind: g.countKind }; },
      // A foto é a maior imagem (absoluta, 100% do quadro). O pai dela é um <picture> com display:contents,
      // sem caixa (retângulo zerado): ancorar nele punha o círculo fora da foto quando a página estava rolada.
      anchor: c => bigImg(c) || imgAnchor(c), wrapper: c => c,
      sponsored: c => sponsoredText(c) || /(^|\n)\s*Ad\s*(\n|$)/.test(c.innerText || '') },
    // Os adaptadores abaixo não abriram no navegador automatizado (login/403): conservadores,
    // por seletor semântico + texto. Sem cartão encontrado, o script não faz nada no site.
    { id: 'mercadolivre', name: 'Mercado Livre', host: /(^|\.)mercadolivre\.com\.br$/, scale: 5, product: /(MLB-?\d{6,})/i, experimental: true,
      cards: () => { const li = qsa('li.ui-search-layout__item'); return li.length ? li : outermost(qsa('.poly-card, .ui-search-result__wrapper')); },
      extract: c => {
        const r = c.querySelector('.poly-reviews__rating, .ui-search-reviews__rating-number');
        const n = c.querySelector('.poly-reviews__total, .ui-search-reviews__amount');
        const g = generic(c);
        const nm = n && /([\d.,]+\s*(?:mil|k)?)/i.exec(n.textContent);
        return { rating: r ? toRating(r.textContent.trim()) : g.rating, count: nm ? toInt(nm[1]) : g.count, countKind: nm ? 'reviews' : g.countKind };
      },
      anchor: imgAnchor, wrapper: c => c, sponsored: c => sponsoredText(c) || !!c.querySelector('.poly-component__ads-promotions, [class*="ads-promotions"]') },
    { id: 'magalu', name: 'Magalu', host: /(^|\.)magazineluiza\.com\.br$/, scale: 5, product: /\/p\/([a-z0-9]{6,})\//i, experimental: true,
      cards: () => outermost(qsa('[data-testid="product-card-container"], li[data-testid="product-card"]')),
      extract: c => {
        const rv = c.querySelector('[data-testid="review"]');
        const m = rv && /([0-5][.,]\d)\s*\((\d[\d.]*)\)/.exec(rv.textContent);
        return m ? { rating: toRating(m[1]), count: toInt(m[2]), countKind: 'reviews' } : generic(c);
      },
      anchor: imgAnchor, wrapper: c => c, sponsored: c => sponsoredText(c) },
    { id: 'americanas', name: 'Americanas', host: /(^|\.)americanas\.com\.br$/, scale: 5, product: /\/produto\/(\d+)/, experimental: true,
      cards: () => outermost(qsa('[data-testid*="product-card" i], [class*="ProductCard_productCard" i], .vtex-product-summary-2-x-container')),
      extract: generic, anchor: imgAnchor, wrapper: c => c, sponsored: c => sponsoredText(c) },
    { id: 'casasbahia', name: 'Casas Bahia', host: /(^|\.)casasbahia\.com\.br$/, scale: 5, product: /\/(\d{6,})\/p\b|-(\d{6,})(?:[/?#]|$)/, experimental: true,
      cards: () => outermost(qsa('[data-testid="product-card"], [data-testid*="product-card" i], [class*="product-card" i]')),
      extract: generic, anchor: imgAnchor, wrapper: c => c, sponsored: c => sponsoredText(c) },
    { id: 'temu', name: 'Temu', host: /(^|\.)temu\.com$/, scale: 5, product: /-g-(\d+)/, experimental: true,
      cards: () => outermost(qsa('[data-tooltip*="goods" i], [class*="goodsCard" i], [class*="goods-card" i]').filter(e => e.querySelector('img') && e.querySelector('a[href*="-g-"], a[href*="goods"]') || (e.matches('a') && /-g-\d+/.test(e.getAttribute('href') || '')))),
      extract: generic, anchor: imgAnchor, wrapper: c => c, sponsored: c => sponsoredText(c) },
    { id: 'shein', name: 'Shein', host: /(^|\.)shein\.com$/, scale: 5, product: /-p-(\d+)/, experimental: true,
      cards: () => outermost(qsa('section.product-card, .product-card, [class*="product-list__item"]')),
      extract: generic, anchor: imgAnchor, wrapper: c => c, sponsored: c => sponsoredText(c) },
    // Fixture de testes com nota 0–10: o @match nunca injeta neste host (.invalid é reservado).
    { id: 'exemplo10', name: 'Loja exemplo (0–10)', host: /^loja-exemplo\.invalid$/, scale: 10,
      cards: () => qsa('.card'),
      extract: c => { const m = /Nota ([\d,.]+)\/10 · ([\d.]+)/.exec(c.innerText || ''); return { rating: m ? toRating(m[1]) : null, count: m ? toInt(m[2]) : null, countKind: m ? 'reviews' : null }; },
      anchor: c => c.querySelector('.img') || c, wrapper: c => c, sponsored: c => sponsoredText(c) },
  ];
  const A = ADAPTERS.find(a => a.host.test(location.hostname));
  if (!A) return;

  // ---------- ajustes por site, na escala nativa ----------
  const KEY = 'site:' + A.id;
  const DEF = { enabled: true, minRating: round1(A.scale * 0.9), minCount: 100, mode: 'dim', sponsoredOnlyIfPass: true, showInfo: true, rewriteCombos: true };
  const cfg = Object.assign({}, DEF, (() => { const v = get(KEY, null); try { return typeof v === 'string' ? JSON.parse(v) : (v || {}); } catch (_) { return {}; } })());
  const save = () => set(KEY, Object.assign({}, cfg));

  // Veredito: eixo null não conta (null ≠ 0); sem nota e sem contagem = cinza.
  function verdict(d) {
    const r = d.rating, n = A.noCount ? null : d.count;
    if (r == null && n == null) return 'unknown';
    if (r != null && r < cfg.minRating - 1e-9) return 'fail';
    if (n != null && n < cfg.minCount) return 'fail';
    return 'pass';
  }
  const fmtR = x => x.toFixed(1).replace('.', ',');
  const label = d => (d.rating == null ? 'sem nota' : fmtR(d.rating) + (A.scale === 5 ? '★' : '/' + A.scale)) +
    (d.count == null || A.noCount ? '' : ' · ' + d.count.toLocaleString('pt-BR'));

  // ---------- combos do AliExpress ----------
  const combos = (() => {
    const ITEM_PATH_RE = /\/item\/(\d{6,})\.html/i;
    const BUNDLE_PATH_RE = /(^|\/)(p\/combo|ssr|gcp)(\/|$)|bundle/i;
    const ALI_HOST_RE = /(^|\.)aliexpress\.(com|us|ru)$/i;
    // Pedidos, carrinho, pagamento, favoritos, loja e cupons: nunca.
    const NEVER_TOUCH_RE = /(^|\/)(shopping)?cart|\/(order|orders|trade|checkout|pay|payment|myaliexpress|wish|wishlist|store|coupon|coupons)(\/|$|\.)/i;
    const ORDER_PARAM_RE = /^(order|trade)/i;
    const ID_PARAMS = ['productId', 'productid', 'itemId', 'itemid', 'objectId', 'objectid'];
    const JUNK_PARAMS = ['sourceType', '_immersiveMode', 'aem_p4p_detail', 'pdp_npi', 'gatewayAdapt', 'scenario'];
    const JUNK_PREFIX_RE = /^p4p/i, ID_RE = /\d{6,}/;
    const COMBO_MARKER_RE = /max combo|combo deal|bundle deal|buy more save more|more to love|compre junto|leve mais|combo m[aá]ximo/i;
    const DATA_ID_KEY_RE = /(product|item|object|sku).*id$|^data-(product|item|object)/i;
    const ORIG = 'data-us-sf-href-original';
    const parseUrl = h => { try { const u = new URL(h, location.href); return /^https?:$/.test(u.protocol) ? u : null; } catch (_) { return null; } };
    function idFromParams(u) {
      const ids = u.searchParams.get('productIds') || u.searchParams.get('productids');
      if (ids) { const f = ID_RE.exec(String(ids).split(/[,;|]/)[0] || ''); if (f) return f[0]; }
      for (const p of ID_PARAMS) { const raw = u.searchParams.get(p); const m = raw && ID_RE.exec(raw); if (m) return m[0]; }
      return null;
    }
    function stripJunk(u) {
      const drop = []; u.searchParams.forEach((_v, k) => { if (JUNK_PARAMS.includes(k) || JUNK_PREFIX_RE.test(k)) drop.push(k); });
      if (!drop.length) return null; const c = new URL(u.href); drop.forEach(k => c.searchParams.delete(k)); return c.href;
    }
    const hasComboMarker = el => { try { return COMBO_MARKER_RE.test((el.textContent || '').slice(0, 600)); } catch (_) { return false; } };
    function idFromDataAttributes(el) {
      for (let n = el, lv = 0; n && lv < 3; n = n.parentElement, lv++) {
        for (const a of [...(n.attributes || [])]) { if (!/^data-/i.test(a.name) || !DATA_ID_KEY_RE.test(a.name) || a.name.startsWith('data-us-')) continue; const m = ID_RE.exec(a.value || ''); if (m) return m[0]; }
      }
      return null;
    }
    // {url} quando o link deve mudar; null quando já é o item canônico. Em cartão marcado
    // como combo, o id do próprio cartão vence o da URL (que aponta para o pacote).
    function canonicalize(href, o) {
      const u = parseUrl(href); if (!u || !ALI_HOST_RE.test(u.hostname) || NEVER_TOUCH_RE.test(u.pathname)) return null;
      let orderish = false; u.searchParams.forEach((_v, k) => { if (ORDER_PARAM_RE.test(k)) orderish = true; }); if (orderish) return null;
      o = o || {};
      const bundlePath = BUNDLE_PATH_RE.test(u.pathname), pathId = (ITEM_PATH_RE.exec(u.pathname) || [])[1] || null;
      // Só link de item ou de combo/pacote: avaliações, chat, denúncia etc. ficam intactos mesmo com productId.
      if (!pathId && !bundlePath) return null;
      let id = pathId || idFromParams(u);
      // O id do cartão só substitui o da URL em link de combo/pacote (ou link de item num cartão de combo);
      if (o.hintId && o.preferHint) id = o.hintId;
      if (!id && bundlePath) id = o.hintId || null;
      if (pathId && !bundlePath && (!o.preferHint || !o.hintId || o.hintId === pathId)) {
        if (!o.preferHint) return null; // link de item comum fora de cartão de combo: intacto
        const c = stripJunk(u); return c && c !== u.href ? { url: c } : null;
      }
      if (!id) return null;
      const target = 'https://' + location.host + '/item/' + id + '.html';
      return target === u.href ? null : { url: target };
    }
    function fix(a, ctx) {
      const raw = a.getAttribute('href');
      if (!raw || raw[0] === '#' || /^javascript:/i.test(raw)) return false;
      let r = null; try { r = canonicalize(a.href, ctx); } catch (_) { return false; }
      if (!r || r.url === a.href) return false;
      if (!a.hasAttribute(ORIG)) a.setAttribute(ORIG, raw);
      a.setAttribute('href', r.url); return true;
    }
    // Fora dos cartões, só links com marcador de combo/pacote no endereço.
    const SWEEP = 'a[href*="combo" i],a[href*="bundle" i],a[href*="/ssr/" i],a[href*="/gcp/" i]';
    function apply(cards) {
      let n = 0;
      for (const c of cards) {
        const w = A.wrapper(c);
        const hint = (ITEM_PATH_RE.exec(c.getAttribute('href') || '') || [])[1] || idFromDataAttributes(c) || null;
        const combo = hasComboMarker(w);
        if (hint) c.setAttribute('data-us-sf-item', hint); else c.removeAttribute('data-us-sf-item');
        if (combo) c.setAttribute('data-us-sf-combo', '1'); else c.removeAttribute('data-us-sf-combo');
        for (const a of [...(w.matches('a[href]') ? [w] : []), ...qsa('a[href]', w)]) { try { if (fix(a, { hintId: hint, preferHint: combo })) n++; } catch (_) { /* um link ruim não para o cartão */ } }
      }
      for (const a of qsa(SWEEP)) { try { if (fix(a, null)) n++; } catch (_) { /* idem */ } }
      return n;
    }
    function revert() {
      for (const a of qsa('[' + ORIG + ']')) { a.setAttribute('href', a.getAttribute(ORIG)); a.removeAttribute(ORIG); }
      for (const c of qsa('[data-us-sf-item],[data-us-sf-combo]')) { c.removeAttribute('data-us-sf-item'); c.removeAttribute('data-us-sf-combo'); }
    }
    // Cartões que navegam por JS ignoram o href: um ouvinte em captura pega antes da página.
    let installed = false;
    function backstop() {
      if (installed) return; installed = true;
      const h = ev => {
        if (!cfg.enabled || !cfg.rewriteCombos || ev.defaultPrevented) return;
        if (ev.type === 'auxclick' && ev.button !== 1) return;
        if (ev.type === 'click' && ev.button > 1) return;
        const t = ev.target && ev.target.closest ? ev.target : null; if (!t) return;
        const a = t.closest('a');
        if (!a) return; // só links: botões (carrinho, favoritos) seguem com a página
        if (t.closest('button,[role="button"]') && a.contains(t.closest('button,[role="button"]'))) return;
        if (a.closest('header,nav,footer,[role="navigation"],[role="banner"]')) return; // cabeçalho/menus nunca
        const raw = a.getAttribute('href');
        if (!raw || raw[0] === '#' || /^javascript:/i.test(raw)) return;
        const card = a.closest('[data-us-sf-item]');
        const hint = card ? card.getAttribute('data-us-sf-item') : null;
        const prefer = !!card && card.getAttribute('data-us-sf-combo') === '1';
        const r = canonicalize(a.href, { hintId: hint, preferHint: prefer });
        if (!r) return;
        ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
        const newTab = ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button === 1 || (a.target || '').toLowerCase() === '_blank';
        if (newTab) window.open(r.url, '_blank', 'noopener'); else location.assign(r.url);
      };
      document.addEventListener('click', h, true); document.addEventListener('auxclick', h, true);
    }
    return { apply, revert, backstop, canonicalize };
  })();

  // ---------- marcações nos cartões ----------
  const CSS = `.us-sf-rel{position:relative!important}
.us-sf-dim::after{content:""!important;position:absolute!important;inset:0!important;background:var(--us-veil)!important;pointer-events:none!important;z-index:1!important;border-radius:inherit;transition:opacity var(--us-motion);display:block!important}
@media (hover:hover){.us-sf-dim:hover::after{opacity:0}}
.us-sf-hide{display:none!important}
.us-sf-dot{position:absolute!important;z-index:2!important;display:flex!important;flex-wrap:wrap!important;max-width:calc(100% - 24px)!important;gap:4px 6px;align-items:flex-start;pointer-events:none!important;font:600 11px/12px var(--us-font)!important;margin:0!important;padding:0!important;width:auto!important;height:auto!important}
.us-sf-dot>i{display:block!important;width:var(--us-dot)!important;height:var(--us-dot)!important;box-sizing:border-box!important;border-radius:50%!important;border:2px solid #fff!important;box-shadow:0 1px 4px rgba(0,0,0,.45);flex:none;margin:0!important}
.us-sf-dot>i[data-v="pass"]{background:var(--us-pass)!important}.us-sf-dot>i[data-v="fail"]{background:var(--us-fail)!important}.us-sf-dot>i[data-v="unknown"]{background:var(--us-unknown)!important}
.us-sf-dot>span{background:rgba(17,24,39,.85)!important;color:#fff!important;padding:2px 7px!important;border-radius:10px!important;white-space:nowrap!important;font:inherit!important;line-height:12px!important;height:16px!important;box-sizing:border-box!important;letter-spacing:0!important;text-transform:none!important}
.us-sf-dot>span.us-sf-sp{background:var(--us-accent)!important}`;
  function injectCss() {
    injectTokens();
    if (document.getElementById('us-sf-style')) return;
    const s = document.createElement('style'); s.id = 'us-sf-style'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  // Sites reaproveitam nós: toda varredura começa limpando o que este script deixou.
  function clearMarks() {
    for (const e of qsa('.us-sf-dot')) e.remove();
    for (const e of qsa('.us-sf-card,.us-sf-rel,.us-sf-dim,.us-sf-hide')) e.classList.remove('us-sf-card', 'us-sf-rel', 'us-sf-dim', 'us-sf-hide');
  }

  const stats = { total: 0, pass: 0, fail: 0, unknown: 0, hidden: 0, dimmed: 0, spHidden: 0, ms: 0, scans: 0 };
  let obs = null, timer = 0, ui = null, dirty = false, known = new Set(), seenCards = [], seenHref = '';

  // Um "cartão" que reúne vários produtos (link de produto ou foto grande repetidos) não é cartão.
  const PRODUCT_IMG = 100; // px: foto de produto, não miniatura de cor ou ícone
  function productKeys(c) {
    const keys = new Set();
    if (!A.product) return keys;
    for (const a of [...(c.matches('a[href]') ? [c] : []), ...qsa('a[href]', c)]) {
      let h = a.getAttribute('href') || ''; try { h = decodeURIComponent(h); } catch (_) { /* href cru */ }
      const m = A.product.exec(h); if (!m) continue;
      // Só conta link "de produto": o próprio cartão ou um link com foto grande ou título.
      const big = [...a.querySelectorAll('img')].some(i => { const r = i.getBoundingClientRect(); return r.width >= PRODUCT_IMG && r.height >= PRODUCT_IMG; });
      if (a === c || big || a.querySelector('h2,h3,h4')) keys.add(m.slice(1).find(Boolean) || m[0]);
    }
    return keys;
  }
  // Fotos grandes em posições diferentes dentro do cartão. Carrossel (slides fora da caixa do cartão
  // ou empilhados no mesmo lugar) conta uma vez só.
  function productImages(c) {
    const cr = c.getBoundingClientRect(), spots = [];
    for (const i of qsa('img', c)) {
      const r = i.getBoundingClientRect();
      if (r.width < PRODUCT_IMG || r.height < PRODUCT_IMG) continue;
      const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
      if (cx < cr.left || cx > cr.right || cy < cr.top || cy > cr.bottom) continue;
      const overlaps = spots.some(o => {
        const w = Math.min(o.right, r.right) - Math.max(o.left, r.left), h = Math.min(o.bottom, r.bottom) - Math.max(o.top, r.top);
        return w > 0 && h > 0 && w * h > 0.5 * Math.min(o.width * o.height, r.width * r.height);
      });
      if (!overlaps) spots.push(r);
    }
    return spots.length;
  }
  const validCard = c => productKeys(c).size <= 1 && productImages(c) <= 1;

  // O que ocultar: o item da grade (filho direto do contêiner de resultados), não um elemento interno do
  // cartão, senão fica um buraco. Sobe enquanto o pai não contém outro cartão e não é bem maior que o
  // cartão (uma seção com um cartão só não some inteira). Não depende das classes com hash do site.
  function gridItems(ws) {
    const n = new Map();
    for (const w of ws) for (let p = w.parentElement; p && p !== document.body; p = p.parentElement) n.set(p, (n.get(p) || 0) + 1);
    return ws.map(w => {
      const r = w.getBoundingClientRect(); let e = w;
      for (let p = w.parentElement; p && p !== document.body && n.get(p) === 1; p = p.parentElement) {
        const pr = p.getBoundingClientRect();
        if (pr.width > r.width * 1.25 + 24 || pr.height > r.height * 1.25 + 24) break;
        e = p;
      }
      return e;
    });
  }

  function scan() {
    timer = 0; dirty = false;
    const t0 = performance.now();
    if (obs) obs.disconnect();
    clearMarks();
    const raw = A.cards();
    seenCards = raw; seenHref = location.href;
    let cards = raw.filter(validCard);
    if (cards.length < 2) cards = []; // um anúncio só (página de produto, seletor errado): não mexe
    stats.scans++;
    Object.assign(stats, { total: cards.length, pass: 0, fail: 0, unknown: 0, hidden: 0, dimmed: 0, spHidden: 0 });
    known = new Set();
    if (cards.length) injectCss();
    if (cards.length && cfg.enabled) {
      // Site experimental (seletores não verificados): só esmaece, nunca oculta.
      const canHide = !A.experimental;
      // 1) lê tudo (um layout), 2) escreve tudo.
      const reads = cards.map(c => {
        const w = A.wrapper(c) || c;
        let d; try { d = A.extract(c) || {}; } catch (_) { d = {}; }
        d = { rating: d.rating == null || !isFinite(d.rating) ? null : d.rating, count: d.count == null || !isFinite(d.count) ? null : d.count };
        let sp = false; try { sp = !!A.sponsored(c, w); } catch (_) { /* sem selo */ }
        const a = A.anchor(c) || c, cr = c.getBoundingClientRect(), ar = a.getBoundingClientRect();
        const isStatic = getComputedStyle(c).position === 'static';
        // Absoluto é relativo à borda interna do cartão: desconta a borda (clientTop/Left).
        return { c, w, item: w, d, sp, isStatic, top: ar.top - cr.top - c.clientTop, left: ar.left - cr.left - c.clientLeft, v: verdict(d) };
      });
      gridItems(reads.map(r => r.w)).forEach((e, i) => { reads[i].item = e; });
      for (const r of reads) {
        stats[r.v]++; known.add(r.c); known.add(r.w); known.add(r.item);
        const spDrop = r.sp && cfg.sponsoredOnlyIfPass && r.v !== 'pass';
        if (spDrop && canHide) { r.item.classList.add('us-sf-hide'); stats.spHidden++; continue; }
        if (r.v === 'fail' || spDrop) {
          if (cfg.mode === 'hide' && canHide) { r.item.classList.add('us-sf-hide'); stats.hidden++; continue; }
          r.c.classList.add('us-sf-dim'); stats.dimmed++;
        }
        r.c.classList.add('us-sf-card');
        if (r.isStatic) r.c.classList.add('us-sf-rel'); // só posiciona o cartão quando ele é static
        const dot = document.createElement('div');
        dot.className = 'us-sf-dot'; dot.setAttribute('aria-hidden', 'true'); dot.dataset.v = r.v;
        const i = document.createElement('i'); i.dataset.v = r.v; dot.append(i);
        if (cfg.showInfo) { const s = document.createElement('span'); s.textContent = label(r.d); dot.append(s); }
        if (r.sp) { const s = document.createElement('span'); s.className = 'us-sf-sp'; s.textContent = 'patrocinado ✓'; dot.append(s); }
        dot.style.setProperty('top', Math.max(0, r.top) + 12 + 'px', 'important');
        dot.style.setProperty('left', Math.max(0, r.left) + 12 + 'px', 'important');
        r.c.append(dot);
      }
    }
    if (A.id === 'aliexpress') {
      if (cfg.enabled && cfg.rewriteCombos && cards.length) { combos.apply(cards); combos.backstop(); } else combos.revert();
    }
    stats.ms = Math.round((performance.now() - t0) * 10) / 10;
    if (cards.length || ui) renderUi();
    observe();
  }
  // Mudou algo relevante? Mesmos cartões (mesmos nós, mesma quantidade) na mesma URL = não.
  function changed() {
    if (location.href !== seenHref) return true;
    const now = A.cards();
    if (now.length !== seenCards.length) return true;
    for (let i = 0; i < now.length; i++) if (now[i] !== seenCards[i]) return true;
    return false;
  }
  function tick() { timer = 0; if (dirty || changed()) scan(); }
  // Rolagem infinita e SPA: varredura agendada (no máximo ~3 por segundo), só quando algo relevante mudou.
  function schedule(delay, force) { if (force) dirty = true; if (!timer) timer = setTimeout(tick, delay == null ? 350 : delay); }
  const inKnown = n => { for (let e = n; e && e !== document.body; e = e.parentNode) if (known.has(e)) return true; return false; };
  // Dentro de um cartão marcado, só conta entrar ou sair elemento com cartão, foto ou link, ou
  // texto com cara de nota ("4,8", "★"); o resto (contador "Termina em", preço) não provoca varredura.
  const RATING_TXT = /★|(^|[^\d.,])[0-9]{1,2}[.,][0-9](?![\d])/;
  const relevantNode = n => {
    if (n.nodeType === 3) return RATING_TXT.test(n.nodeValue || '');
    if (n.nodeType !== 1 || (n.classList && n.classList.contains('us-sf-dot'))) return false;
    return n.matches('img,picture,a[href]') || !!n.querySelector('img,picture,a[href]') || known.has(n) || RATING_TXT.test(n.textContent || '');
  };
  const relevantMut = m => m.type === 'characterData' ? RATING_TXT.test(m.target.nodeValue || '')
    : [...m.addedNodes].some(relevantNode) || [...m.removedNodes].some(relevantNode);
  function observe() {
    if (!document.body) return;
    if (!obs) obs = new MutationObserver(muts => {
      if (!dirty) for (const m of muts) if (relevantMut(m) && inKnown(m.target)) { dirty = true; break; } // o site mexeu num cartão já marcado
      schedule();
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // ---------- pílula + painel (PC) / gaveta (celular), em shadow DOM ----------
  const UI_CSS = `:host{all:initial}
*{box-sizing:border-box;font-family:var(--us-font)}
.pill{position:fixed;right:16px;bottom:16px;z-index:var(--us-z);height:var(--us-target);min-width:var(--us-target);border:0;border-radius:var(--us-radius-pill);background:var(--us-float-bg);color:var(--us-float-text);font:600 14px/1 var(--us-font);padding:0 16px;display:flex;gap:8px;align-items:center;box-shadow:var(--us-shadow);cursor:pointer}
.pill:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid var(--us-accent);outline-offset:2px}
.pill i{width:10px;height:10px;border-radius:50%;background:var(--us-pass);flex:none}.pill.off i{background:var(--us-unknown)}
.panel{position:fixed;z-index:var(--us-z);background:var(--us-surface);color:var(--us-text);box-shadow:var(--us-shadow);font:14px/1.4 var(--us-font);padding:14px 18px 16px;transition:transform var(--us-motion),opacity var(--us-motion)}
.panel[hidden]{display:none}
.panel.desk{right:16px;bottom:72px;width:340px;max-height:calc(100vh - 96px);overflow:auto;border-radius:var(--us-radius-m)}
.panel.sheet{left:0;right:0;bottom:0;border-radius:18px 18px 0 0;font-size:15px;padding:10px 20px calc(20px + env(safe-area-inset-bottom));max-height:85vh;overflow:auto}
.handle{width:40px;height:5px;border-radius:3px;background:var(--us-border);margin:0 auto 12px}
.panel:not(.sheet) .handle{display:none}
h2{margin:0;font:700 16px/1.3 var(--us-font);color:var(--us-text)}
.sub{color:var(--us-text-2);font-size:12.5px;margin:2px 0 6px}
.lbl{display:flex;justify-content:space-between;align-items:baseline;margin:12px 0 0;gap:8px}
.lbl output{font-weight:700;font-variant-numeric:tabular-nums}
input[type=range]{width:100%;height:var(--us-target);margin:0;accent-color:var(--us-accent);background:transparent;cursor:pointer}
.note{color:var(--us-text-2);font-size:12.5px;margin:10px 0 0}
.row{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:var(--us-target);border-top:1px solid var(--us-border)}
.row:first-of-type{margin-top:8px}
.row small{display:block;color:var(--us-text-2);font-size:12px}
.sw{flex:none;width:var(--us-target);height:var(--us-target);border:0;padding:0;background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer}
.sw span{width:42px;height:24px;border-radius:12px;background:var(--us-border);position:relative;transition:background var(--us-motion)}
.sw span::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:left var(--us-motion)}
.sw[aria-checked="true"] span{background:var(--us-pass)}.sw[aria-checked="true"] span::after{left:21px}
.lg{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--us-text-2);margin-top:10px;padding-top:10px;border-top:1px solid var(--us-border)}
.lg b{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:-1px}
.close{position:absolute;top:6px;right:6px;width:var(--us-target);height:var(--us-target);border:0;background:transparent;color:var(--us-text-2);font-size:22px;cursor:pointer;border-radius:50%}`;

  function renderUi() {
    if (!ui) buildUi();
    const t = cfg.enabled
      ? `${stats.fail} reprovado${stats.fail === 1 ? '' : 's'}${stats.spHidden ? ` · ${stats.spHidden} patrocinado${stats.spHidden === 1 ? '' : 's'} oculto${stats.spHidden === 1 ? '' : 's'}` : ''}`
      : 'Filtro desligado';
    ui.pill.classList.toggle('off', !cfg.enabled);
    ui.txt.textContent = t;
    ui.pill.setAttribute('aria-label', `Filtro de lojas: ${t}. Abrir ajustes`);
    ui.sub.textContent = `${stats.total} anúncio${stats.total === 1 ? '' : 's'} · ${stats.fail} reprovado${stats.fail === 1 ? '' : 's'} · ${stats.unknown} sem dados · ajustes valem só para este site`;
    Object.assign(ui.host.dataset, { site: A.id, scans: stats.scans, total: stats.total, pass: stats.pass, fail: stats.fail, unknown: stats.unknown, hidden: stats.hidden, dimmed: stats.dimmed, spHidden: stats.spHidden, ms: stats.ms });
  }
  function buildUi() {
    const host = document.createElement('div'); host.id = 'us-shop-filter';
    const root = host.attachShadow({ mode: 'open' });
    const sw = (k, title, hint) => `<div class="row"><span id="l-${k}">${title}${hint ? `<small>${hint}</small>` : ''}</span><button class="sw" role="switch" data-k="${k}" aria-labelledby="l-${k}"><span></span></button></div>`;
    root.innerHTML = `<style>${UI_CSS}</style>
<button class="pill" aria-expanded="false" aria-controls="p"><i></i><span class="txt"></span></button>
<div class="panel" id="p" role="dialog" aria-modal="false" aria-labelledby="t" hidden>
  <div class="handle"></div><button class="close" aria-label="Fechar">×</button>
  <h2 id="t">Filtro de lojas · ${A.name}</h2><div class="sub"></div>
  ${A.experimental ? '<p class="note exp">Site experimental: só esmaece (nunca oculta), mesmo com "Ocultar reprovados" ligado.</p>' : ''}
  <div class="lbl"><label for="r">Nota mínima</label><output id="ro"></output></div>
  <input type="range" id="r" min="0" max="${A.scale}" step="0.1">
  ${A.noCount ? '<p class="note">Este site não mostra a quantidade de avaliações: o filtro usa só a nota.</p>'
    : '<div class="lbl"><label for="n">Avaliações ou vendidos (mín.)</label><output id="no"></output></div><input type="range" id="n" min="0" max="1000" step="10">'}
  ${sw('enabled', 'Filtro ligado')}
  ${sw('hide', 'Ocultar reprovados', 'desligado = esmaecer')}
  ${sw('sponsoredOnlyIfPass', 'Patrocinado só se aprovado', 'patrocinado reprovado ou sem nota some')}
  ${sw('showInfo', 'Mostrar nota e quantidade')}
  ${A.id === 'aliexpress' ? sw('rewriteCombos', 'Abrir a página do item', 'corrige links de combos e pacotes') : ''}
  <div class="lg"><span><b style="background:var(--us-pass)"></b>passa</span><span><b style="background:var(--us-fail)"></b>reprovado</span><span><b style="background:var(--us-unknown)"></b>sem dados</span></div>
</div>`;
    document.documentElement.appendChild(host);
    const $ = s => root.querySelector(s);
    ui = { host, root, pill: $('.pill'), txt: $('.txt'), panel: $('.panel'), sub: $('.sub'), r: $('#r'), ro: $('#ro'), n: $('#n'), no: $('#no') };
    const val = k => k === 'hide' ? cfg.mode === 'hide' : !!cfg[k];
    const sync = () => {
      ui.r.value = cfg.minRating; ui.ro.textContent = `${cfg.minRating.toFixed(1).replace('.', ',')} / ${A.scale}`;
      ui.r.setAttribute('aria-valuetext', ui.ro.textContent);
      if (ui.n) { ui.n.value = cfg.minCount; ui.no.textContent = cfg.minCount.toLocaleString('pt-BR'); }
      for (const b of root.querySelectorAll('.sw')) b.setAttribute('aria-checked', String(val(b.dataset.k)));
    };
    ui.sync = sync; sync();
    const apply = () => { save(); sync(); if (timer) { clearTimeout(timer); timer = 0; } scan(); };
    ui.r.addEventListener('input', () => { cfg.minRating = round1(+ui.r.value); apply(); });
    if (ui.n) ui.n.addEventListener('input', () => { cfg.minCount = Math.round(+ui.n.value); apply(); });
    for (const b of root.querySelectorAll('.sw')) b.addEventListener('click', () => {
      const k = b.dataset.k;
      if (k === 'hide') cfg.mode = cfg.mode === 'hide' ? 'dim' : 'hide'; else cfg[k] = !cfg[k];
      apply();
    });
    ui.pill.addEventListener('click', () => toggle());
    $('.close').addEventListener('click', () => toggle(false));
    root.addEventListener('keydown', e => { if (e.key === 'Escape') { toggle(false); ui.pill.focus(); } });
    document.addEventListener('pointerdown', e => { if (!ui.panel.hidden && !e.composedPath().includes(host)) toggle(false); }, true);
  }
  function toggle(force) {
    if (!ui) { injectCss(); renderUi(); }
    const open = force == null ? ui.panel.hidden : force;
    ui.panel.classList.toggle('sheet', innerWidth < 600);
    ui.panel.classList.toggle('desk', innerWidth >= 600);
    ui.panel.hidden = !open; ui.pill.setAttribute('aria-expanded', String(open));
    if (open) { ui.sync(); (ui.panel.querySelector('input,button.sw') || ui.pill).focus({ preventScroll: true }); }
  }

  menu('Abrir ajustes do filtro', () => toggle(true));
  menu('Desligar/ligar neste site', () => { cfg.enabled = !cfg.enabled; save(); if (ui) ui.sync(); scan(); });

  addEventListener('popstate', () => schedule(0));
  addEventListener('resize', () => schedule(null, true));
  scan();
})();
