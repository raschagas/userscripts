// ==UserScript==
// @name         Unbloat — limpar sites
// @namespace    raschagas/userscripts
// @version      1.0.0
// @description  Oculta o excesso no YouTube (Shorts, recomendações da lateral e do fim do vídeo, banners de anúncio) e nas lojas AliExpress, Amazon e Mercado Livre (banners de app, pop-ups de cupom, carrosséis fora do resultado). Só CSS: nunca clica nem altera formulário. Cada regra liga e desliga no menu.
// @match        *://www.youtube.com/*
// @match        *://m.youtube.com/*
// @match        *://youtube.com/*
// @match        *://*.aliexpress.com/*
// @match        *://www.amazon.com.br/*
// @match        *://amazon.com.br/*
// @match        *://*.mercadolivre.com.br/*
// @match        *://mercadolivre.com.br/*
// @exclude      *://camara.leg.br/*
// @exclude      *://*.camara.leg.br/*
// @exclude      *://camara.gov.br/*
// @exclude      *://*.camara.gov.br/*
// @noframes
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/raschagas/userscripts/main/src/unbloat.user.js
// @updateURL    https://raw.githubusercontent.com/raschagas/userscripts/main/src/unbloat.user.js
// ==/UserScript==

(() => {
  'use strict';
  const host = location.hostname;
  if (/(^|\.)camara\.(leg|gov)\.br$/i.test(host)) return; // nunca nos sistemas da Câmara, nem por regra extra do gerenciador
  const get = (k, d) => { try { const v = GM_getValue(k, d); return v == null ? d : v; } catch (_) { return d; } };
  const set = (k, v) => { try { GM_setValue(k, v); } catch (_) {} };

  // Regras por site. Cada regra só oculta (display:none); nada é clicado nem removido do DOM.
  // `def` = estado padrão. Seletores conferidos nas páginas reais em 2026-11-11 (ver README).
  const SITES = [
    {
      id: 'youtube', name: 'YouTube', host: /(^|\.)youtube\.com$/i,
      rules: [
        { id: 'shorts', label: 'Shorts', def: true, css: [
          // prateleiras (página inicial, busca no PC e no celular)
          'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])', 'ytd-rich-shelf-renderer[is-shorts]',
          'ytd-reel-shelf-renderer', 'grid-shelf-view-model:has(ytm-shorts-lockup-view-model)',
          // aba no menu lateral (aberto e recolhido) e na barra inferior do celular
          'ytd-guide-entry-renderer:has(a[title="Shorts"])', 'ytd-mini-guide-entry-renderer:has(a[title="Shorts"])',
          'ytm-pivot-bar-item-renderer:has(.pivot-shorts)',
          // itens soltos nos resultados e nas recomendações (fora da página de Shorts)
          'ytd-video-renderer:has(a[href^="/shorts/"])', 'ytd-rich-item-renderer:has(a[href^="/shorts/"])',
          'yt-lockup-view-model:has(a[href^="/shorts/"])', 'ytd-compact-video-renderer:has(a[href^="/shorts/"])',
          'ytm-video-with-context-renderer:has(a[href^="/shorts/"])',
        ], notOnShortsPage: true },
        { id: 'lateral', label: 'Recomendações da lateral (vídeo)', def: true, css: ['ytd-watch-flexy #related'] },
        { id: 'fim', label: 'Recomendações do fim do vídeo', def: true, css: [
          '.html5-video-player .ytp-endscreen-content', '.html5-video-player .videowall-endscreen',
          '.html5-video-player .ytp-ce-element', '.html5-video-player .ytp-fullscreen-grid'] },
        { id: 'banners', label: 'Banners de anúncio, Premium e loja', def: true, css: [
          '#masthead-ad', 'ytd-ad-slot-renderer', 'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)', '#player-ads',
          'ytd-merch-shelf-renderer', 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]'] },
        { id: 'inicio', label: 'Feed da página inicial', def: false, css: ['ytd-browse[page-subtype="home"] ytd-rich-grid-renderer'] },
      ],
    },
    {
      id: 'aliexpress', name: 'AliExpress', host: /(^|\.)aliexpress\.com$/i,
      rules: [
        { id: 'app', label: 'Banners "baixe o app"', def: true, css: [
          '[class*="down-load-app--menuItem"]', '#aec-plugin-fixed-top-bar'] },
        // Nunca .J_MIDDLEWARE_FRAME_WIDGET: é a verificação "não sou um robô".
        { id: 'popups', label: 'Pop-ups de promoção, cupom e moedas', def: true, css: [
          '.image-poplayer-modal', '.drogue-poplayer-modal'] },
      ],
    },
    {
      id: 'amazon', name: 'Amazon', host: /(^|\.)amazon\.com\.br$/i,
      rules: [
        { id: 'carrosseis', label: 'Carrosséis patrocinados fora do resultado', def: true, css: [
          '.s-main-slot > .s-widget[cel_widget_id^="MAIN-FEATURED_ASINS_LIST"]',
          '.s-main-slot > .AdHolder:not([data-component-type="s-search-result"])'] },
        { id: 'vistos', label: '"Vistos recentemente" e recomendações do rodapé', def: true, css: ['#rhf'] },
        { id: 'popups', label: 'Pop-up de login/ofertas (celular)', def: true, css: ['.sparkle-container'] },
      ],
    },
    {
      id: 'mercadolivre', name: 'Mercado Livre', host: /(^|\.)mercadolivre\.com\.br$/i,
      rules: [
        { id: 'app', label: 'Banners "abra o app"', def: true, css: [
          '.download-app-banner-container', '.nav-footer-downloadapp-banner'],
          // a folha do app trava a rolagem do <body>; ao ocultá-la, devolve a rolagem
          extra: 'body:has(.download-app-banner-container .download-app-bottom-banner-wrapper){overflow:auto!important}' },
        { id: 'anuncios', label: 'Faixas de anúncio', def: true, css: ['section.adn'] },
      ],
    },
  ];

  const site = SITES.find(s => s.host.test(host));
  if (!site) return;
  const ATTR = 'data-us-unbloat-shorts-page';
  const offHosts = () => (get('desligado', '') || '').split(',').filter(Boolean);
  const prefs = () => { const all = get('regras', {}); return (all && typeof all === 'object' && all[site.id]) || {}; };
  const isOn = r => { const p = prefs(); return typeof p[r.id] === 'boolean' ? p[r.id] : r.def; };

  function cssText() {
    if (offHosts().includes(host)) return '';
    let out = '';
    for (const r of site.rules) {
      if (!isOn(r)) continue;
      const sels = r.notOnShortsPage ? r.css.map(s => `html:not([${ATTR}]) ${s}`) : r.css;
      // Uma regra CSS por seletor: um seletor que o navegador não entenda não derruba os outros.
      out += sels.map(s => s + '{display:none!important}\n').join('') + (r.extra ? r.extra + '\n' : '');
    }
    return out;
  }
  let style = null;
  function apply() {
    const t = cssText();
    if (!t) { if (style) { style.remove(); style = null; } return; }
    if (!style) { style = document.createElement('style'); style.id = 'us-unbloat'; }
    style.textContent = t;
    if (!style.isConnected) attach();
  }
  // Em document-start o <html> pode ainda não existir: espera por ele.
  function attach() {
    const parent = document.head || document.documentElement;
    if (parent) { if (style) parent.appendChild(style); markPage(); return; }
    new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); attach(); } })
      .observe(document, { childList: true });
  }
  // Na página de Shorts (e na aba Shorts de um canal) os itens de Shorts são o conteúdo: não ocultar.
  function markPage() {
    if (site.id !== 'youtube') return;
    const shortsPage = /^\/(shorts(\/|$)|(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/shorts\/?$)/.test(location.pathname);
    const el = document.documentElement;
    if (!el) return;
    if (shortsPage !== el.hasAttribute(ATTR)) el.toggleAttribute(ATTR, shortsPage);
  }
  markPage();
  apply();
  if (site.id === 'youtube') {
    // O YouTube navega sem recarregar: reavalia a página a cada navegação.
    for (const ev of ['yt-navigate-finish', 'popstate']) window.addEventListener(ev, markPage);
    let last = location.href;
    setInterval(() => { if (location.href !== last) { last = location.href; markPage(); } }, 1000);
  }
  // Se o <head> trocar antes do fim do carregamento, recoloca o estilo.
  document.addEventListener('DOMContentLoaded', () => { if (style && !style.isConnected) apply(); });

  // Menu do gerenciador: uma entrada por regra e "Desligar neste site".
  const label = r => `${isOn(r) ? '✓' : '✗'} ${r.label} (${isOn(r) ? 'oculto' : 'visível'})`;
  const siteLabel = () => offHosts().includes(host) ? `Ligar neste site (${host})` : `Desligar neste site (${host})`;
  function menu() {
    try {
      for (const r of site.rules) {
        GM_registerMenuCommand(label(r), () => {
          const all = get('regras', {}) || {};
          const cur = Object.assign({}, all[site.id] || {}); cur[r.id] = !isOn(r);
          set('regras', Object.assign({}, all, { [site.id]: cur }));
          apply(); menu();
        }, { id: 'us-unbloat-' + r.id, autoClose: false });
      }
      GM_registerMenuCommand(siteLabel(), () => {
        const l = offHosts(); const i = l.indexOf(host);
        if (i >= 0) l.splice(i, 1); else l.push(host);
        set('desligado', l.join(','));
        apply(); menu();
      }, { id: 'us-unbloat-site', autoClose: false });
    } catch (_) {}
  }
  menu();
})();
