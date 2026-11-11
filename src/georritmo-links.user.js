// ==UserScript==
// @name         Links do homelab — Jellyfin, Seerr, Mealie e comparar voos
// @namespace    raschagas/userscripts
// @version      1.0.0
// @description  Chip discreto no canto: filme no Letterboxd ou IMDb abre no Jellyfin e no Seerr; receita vai para o Mealie; Google Voos e Skyscanner trocam a mesma busca entre si. Só cria links, sem acesso à rede.
// @match        https://letterboxd.com/film/*
// @match        https://www.imdb.com/title/*
// @match        https://www.imdb.com/*/title/*
// @match        https://m.imdb.com/title/*
// @match        https://www.google.com/travel/flights*
// @match        https://www.google.com.br/travel/flights*
// @match        https://www.skyscanner.com.br/transporte/passagens-aereas/*
// @match        https://www.tudogostoso.com.br/*
// @match        https://receitas.globo.com/*
// @match        https://www.panelinha.com.br/*
// @match        https://www.receiteria.com.br/*
// @match        https://cybercook.com.br/*
// @match        https://www.cybercook.com.br/*
// @match        https://www.receitasnestle.com.br/*
// @match        https://www.guiadacozinha.com.br/*
// @match        https://www.anamariabrogui.com.br/*
// @match        https://www.receitasdecomida.com.br/*
// @match        https://br.cookpad.com/*
// @match        https://cookpad.com/br/*
// @match        https://www.allrecipes.com/*
// @match        https://www.bbcgoodfood.com/*
// @match        https://www.seriouseats.com/*
// @match        https://www.simplyrecipes.com/*
// @match        https://www.bonappetit.com/*
// @match        https://www.food.com/*
// @match        https://tasty.co/*
// @exclude      *://camara.leg.br/*
// @exclude      *://*.camara.leg.br/*
// @exclude      *://camara.gov.br/*
// @exclude      *://*.camara.gov.br/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/raschagas/userscripts/main/src/georritmo-links.user.js
// @updateURL    https://raw.githubusercontent.com/raschagas/userscripts/main/src/georritmo-links.user.js
// ==/UserScript==

(() => {
  'use strict';
  const get = (k, d) => { try { const v = GM_getValue(k, d); return v === undefined ? d : v; } catch (_) { return d; } };
  const set = (k, v) => { try { GM_setValue(k, v); } catch (_) { /* sem gerenciador */ } };
  const menu = (t, f) => { try { GM_registerMenuCommand(t, f); } catch (_) { /* sem menu */ } };

  const host = location.hostname;
  const hiddenHosts = () => String(get('esconder', '') || '').split(',').filter(Boolean);
  if (hiddenHosts().includes(host)) return;

  // Endereços dos serviços: configuráveis por dispositivo (valores do gerenciador).
  const trim = u => String(u).replace(/\/+$/, '');
  const JF = trim(get('jellyfin', 'https://jellyfin.georritmo.com'));
  const SEERR = trim(get('seerr', 'https://seerr.georritmo.com'));
  const MEALIE = trim(get('mealie', 'https://receitas.georritmo.com'));
  const MEALIE_GROUP = String(get('mealieGrupo', 'home'));
  const q = encodeURIComponent;

  const TOKENS = `:root{--us-font:system-ui,"Segoe UI",Roboto,"Noto Sans",sans-serif;--us-accent:#2563eb;--us-chip-bg:rgba(17,24,39,.85);--us-radius-pill:999px;--us-shadow:0 8px 28px rgba(0,0,0,.28);--us-motion:.15s;--us-target:44px;--us-z:2147483646;--us-svc-jellyfin:#0077a8;--us-svc-seerr:#4f46e5;--us-svc-mealie:#b45309;--us-svc-skyscanner:#0062e3;--us-svc-gflights:#1a73e8}
@media (prefers-reduced-motion:reduce){:root{--us-motion:0s}}`;

  // ---------- filmes ----------
  function film() {
    if (!/(^|\.)letterboxd\.com$|(^|\.)imdb\.com$/.test(host)) return [];
    const og = document.querySelector('meta[property="og:title"]');
    const h1 = document.querySelector('h1[data-testid="hero__pageTitle"], h1.headline-1, h1');
    let title = (og && og.content) || (h1 && h1.textContent) || document.title;
    title = title.replace(/\s*\(\d{4}\).*$/, '').replace(/\s*[|–-]\s*(IMDb|Letterboxd).*$/i, '').replace(/\s*⭐.*$/, '').trim();
    if (!title) return [];
    let kind = 'movie', id = null;
    const b = document.body;
    if (b && b.dataset.tmdbId && /^\d+$/.test(b.dataset.tmdbId)) { id = b.dataset.tmdbId; kind = b.dataset.tmdbType === 'tv' ? 'tv' : 'movie'; }
    if (!id) {
      const a = document.querySelector('a[href*="themoviedb.org/movie/"], a[href*="themoviedb.org/tv/"]');
      const m = a && /themoviedb\.org\/(movie|tv)\/(\d+)/.exec(a.href);
      if (m) { kind = m[1]; id = m[2]; }
    }
    return [
      { t: '▶ Jellyfin', c: 'jellyfin', u: `${JF}/web/#/search?query=${q(title)}`, h: `Buscar “${title}” no Jellyfin` },
      { t: '+ Seerr', c: 'seerr', u: id ? `${SEERR}/${kind}/${id}` : `${SEERR}/search?query=${q(title)}`, h: id ? `Abrir no Seerr (TMDB ${id})` : `Buscar “${title}” no Seerr` },
    ];
  }

  // ---------- receitas (JSON-LD schema.org Recipe, inclusive em @graph e listas) ----------
  function isType(n, t) { const ty = n && n['@type']; return ty === t || (Array.isArray(ty) && ty.includes(t)); }
  function findRecipe(n, depth) {
    if (!n || depth > 8) return false;
    if (Array.isArray(n)) return n.some(x => findRecipe(x, depth + 1));
    if (typeof n !== 'object') return false;
    if (isType(n, 'Recipe')) return true;
    return ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item'].some(k => k in n && findRecipe(n[k], depth + 1));
  }
  function recipe() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      const txt = s.textContent || '';
      let ok = false;
      try { ok = findRecipe(JSON.parse(txt), 0); } catch (_) { ok = /"@type"\s*:\s*(\[[^\]]*)?"Recipe"/.test(txt); } // JSON malformado: reserva por texto
      if (ok) return [{ t: '+ Mealie', c: 'mealie', u: `${MEALIE}/g/${q(MEALIE_GROUP)}/r/create/url?recipe_import_url=${q(location.href)}`, h: 'Importar esta receita no Mealie' }];
    }
    return [];
  }

  // ---------- voos: Google Voos ⇄ Skyscanner ----------
  const yymmdd = d => d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10);
  const iso = s => `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  // Rota a partir da URL do Google Voos: ?q= em texto ou ?tfs= (protobuf em base64url). Só a URL:
  // o texto da página tem siglas de 3 letras demais (moedas, companhias) para servir de reserva.
  function gflightsRoute() {
    const sp = new URLSearchParams(location.search);
    const qs = sp.get('q') || '';
    let codes = [], dates = [];
    const mq = /\b([A-Z]{3})\b.*?\b(?:to|para)\s+([A-Z]{3})\b/.exec(qs);
    if (mq) { codes = [mq[1], mq[2]]; dates = (qs.match(/\d{4}-\d{2}-\d{2}/g) || []); }
    const tfs = sp.get('tfs');
    if (!codes.length && tfs) {
      try {
        const bin = atob(tfs.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(tfs.length / 4) * 4, '='));
        dates = bin.match(/\d{4}-\d{2}-\d{2}/g) || [];
        codes = [...bin.matchAll(/\x12\x03([A-Z]{3})/g)].map(m => m[1]);
      } catch (_) { /* tfs ilegível */ }
    }
    if (codes.length < 2) return null;
    return { o: codes[0], d: codes[1], dates: dates.slice(0, 2) };
  }
  function skyscannerRoute() {
    const m = /\/transporte\/passagens-aereas\/([a-z]{3,4})\/([a-z]{3,4})\/(\d{6})(?:\/(\d{6}))?/i.exec(location.pathname);
    return m ? { o: m[1].toUpperCase(), d: m[2].toUpperCase(), dates: [m[3], m[4]].filter(Boolean).map(iso) } : null;
  }
  function flights() {
    if (/(^|\.)google\.com(\.br)?$/.test(host) && location.pathname.startsWith('/travel/flights')) {
      const r = gflightsRoute(); if (!r) return [];
      const path = [r.o.toLowerCase(), r.d.toLowerCase(), ...r.dates.map(yymmdd)].join('/');
      return [{ t: 'Skyscanner', c: 'skyscanner', u: `https://www.skyscanner.com.br/transporte/passagens-aereas/${path}/`, h: `Mesma busca no Skyscanner (${r.o}→${r.d})` }];
    }
    if (/(^|\.)skyscanner\.com\.br$/.test(host)) {
      const r = skyscannerRoute(); if (!r) return [];
      const txt = `Flights from ${r.o} to ${r.d}` + (r.dates[0] ? ` on ${r.dates[0]}` : '') + (r.dates[1] ? ` through ${r.dates[1]}` : '');
      return [{ t: 'Google Voos', c: 'gflights', u: `https://www.google.com/travel/flights?q=${q(txt)}&hl=pt-BR&curr=BRL`, h: `Mesma busca no Google Voos (${r.o}→${r.d})` }];
    }
    return [];
  }

  // ---------- chip de serviços (shadow DOM) ----------
  const CSS = `:host{all:initial}
.chip{position:fixed;right:16px;bottom:16px;z-index:var(--us-z);display:flex;gap:6px;align-items:center;background:var(--us-chip-bg);color:#fff;border-radius:var(--us-radius-pill);padding:0 0 0 12px;font:600 12px/1 var(--us-font);box-shadow:0 4px 14px rgba(0,0,0,.25);opacity:.92;transition:opacity var(--us-motion)}
.chip:hover,.chip:focus-within{opacity:1}
.lbl{opacity:.7;margin-right:2px}
/* Alvo de toque/clique de 44 px em todo aparelho; o botão colorido continua com 32 px de altura visual. */
a{display:inline-flex;align-items:center;min-height:var(--us-target);color:#fff;text-decoration:none;border-radius:16px}
a>span{display:inline-flex;align-items:center;min-height:32px;padding:0 12px;border-radius:16px;background:var(--c)}
a:focus-visible>span,button:focus-visible{outline:3px solid #fff;outline-offset:1px}
a:focus-visible{outline:none}
button{width:var(--us-target);height:var(--us-target);border:0;background:transparent;color:#fff;opacity:.6;font-size:16px;cursor:pointer;border-radius:50%}`;
  let hostEl = null, lastKey = '';
  function render() {
    let acts = [], label = 'homelab';
    acts = acts.concat(film(), recipe());
    const fl = flights(); if (fl.length) { label = 'comparar'; acts = acts.concat(fl); }
    const key = JSON.stringify(acts);
    if (key === lastKey) return; lastKey = key;
    if (hostEl) { hostEl.remove(); hostEl = null; }
    if (!acts.length) return;
    if (!document.getElementById('us-tokens-links')) {
      const st = document.createElement('style'); st.id = 'us-tokens-links'; st.textContent = TOKENS;
      (document.head || document.documentElement).appendChild(st);
    }
    hostEl = document.createElement('div'); hostEl.id = 'us-georritmo-links';
    const root = hostEl.attachShadow({ mode: 'open' });
    const chip = document.createElement('div'); chip.className = 'chip'; chip.setAttribute('role', 'navigation'); chip.setAttribute('aria-label', 'Atalhos do homelab');
    const st = document.createElement('style'); st.textContent = CSS;
    const lb = document.createElement('span'); lb.className = 'lbl'; lb.textContent = label; chip.append(lb);
    for (const a of acts) {
      const el = document.createElement('a');
      el.href = a.u; el.target = '_blank'; el.rel = 'noopener noreferrer'; el.title = a.h;
      const tx = document.createElement('span'); tx.textContent = a.t; el.append(tx);
      el.style.setProperty('--c', `var(--us-svc-${a.c})`); el.dataset.svc = a.c;
      chip.append(el);
    }
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.title = 'Esconder nesta página'; x.setAttribute('aria-label', 'Esconder nesta página');
    x.addEventListener('click', () => { obs && obs.disconnect(); hostEl.remove(); });
    chip.append(x);
    root.append(st, chip);
    document.documentElement.appendChild(hostEl);
  }

  menu('Esconder o chip neste site', () => { const l = hiddenHosts(); l.push(host); set('esconder', [...new Set(l)].join(',')); hostEl && hostEl.remove(); obs && obs.disconnect(); });

  render();
  // Google Voos é SPA: a rota muda sem recarregar. Revê só quando a URL mudar (sem chip, também só aí).
  let obs = null;
  if (/google\.|skyscanner\./.test(host) && document.body) {
    let href = location.href, t = 0;
    obs = new MutationObserver(() => {
      if (t) return;
      t = setTimeout(() => { t = 0; if (location.href !== href) { href = location.href; render(); } }, 800);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }
})();
