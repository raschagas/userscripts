// ==UserScript==
// @name         Notas integradas — notas do News Reader nas páginas de filmes e jogos
// @namespace    raschagas/userscripts
// @version      1.0.0
// @description  Em IMDb, TMDB, Letterboxd, Rotten Tomatoes, Metacritic, OpenCritic, IGDB e RAWG, uma pílula no canto abre as notas que o News Reader já guarda (sem repetir a do próprio site) e, onde o site não mostra, onde assistir no Brasil.
// @match        https://www.imdb.com/title/*
// @match        https://www.imdb.com/*/title/*
// @match        https://m.imdb.com/title/*
// @match        https://www.themoviedb.org/movie/*
// @match        https://www.themoviedb.org/tv/*
// @match        https://letterboxd.com/film/*
// @match        https://www.rottentomatoes.com/m/*
// @match        https://www.rottentomatoes.com/tv/*
// @match        https://www.metacritic.com/game/*
// @match        https://www.metacritic.com/movie/*
// @match        https://www.metacritic.com/tv/*
// @match        https://opencritic.com/game/*
// @match        https://www.igdb.com/games/*
// @match        https://rawg.io/games/*
// @exclude      *://camara.leg.br/*
// @exclude      *://*.camara.leg.br/*
// @exclude      *://camara.gov.br/*
// @exclude      *://*.camara.gov.br/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      reader.georritmo.com
// @downloadURL  https://raw.githubusercontent.com/raschagas/userscripts/main/src/notas-integradas.user.js
// @updateURL    https://raw.githubusercontent.com/raschagas/userscripts/main/src/notas-integradas.user.js
// ==/UserScript==

// Lê as notas do próprio News Reader (GET /api/reviews/notes, só leitura, sem chave): o
// endpoint não chama API externa e marca com "self" as notas do site que está aberto, que
// o painel omite. Uma consulta por página (e por mudança de URL em sites SPA), só GET, sem
// cookies. Nada é gravado além dos ajustes do aparelho. Implementação original.
(() => {
  'use strict';
  const get = (k, d) => { try { const v = GM_getValue(k, d); return v === undefined ? d : v; } catch (_) { return d; } };
  const set = (k, v) => { try { GM_setValue(k, v); } catch (_) { /* sem gerenciador */ } };
  const menu = (t, f) => { try { GM_registerMenuCommand(t, f); } catch (_) { /* sem menu */ } };

  const host = location.hostname;
  const hiddenHosts = () => String(get('esconder', '') || '').split(',').filter(Boolean);
  if (hiddenHosts().includes(host)) {
    menu('Mostrar as notas neste site', () => { set('esconder', hiddenHosts().filter((h) => h !== host).join(',')); location.reload(); });
    return;
  }

  // Endereço do News Reader: por aparelho. Padrão = endereço público; um da rede local também serve.
  const DEFAULT_BASE = 'https://reader.georritmo.com';
  const base = () => {
    const b = String(get('newsReader', DEFAULT_BASE) || '').trim().replace(/\/+$/, '');
    return /^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(b) ? b : '';
  };

  const SITES = [
    ['imdb.com', 'imdb'], ['themoviedb.org', 'tmdb'], ['letterboxd.com', 'letterboxd'],
    ['rottentomatoes.com', 'rottentomatoes'], ['metacritic.com', 'metacritic'],
    ['opencritic.com', 'opencritic'], ['igdb.com', 'igdb'], ['rawg.io', 'rawg'],
  ];
  const site = (SITES.find(([h]) => host === h || host.endsWith('.' + h)) || [])[1];
  if (!site) return;
  // "Onde assistir" só onde o site não mostra o bloco do Brasil (conferido em página real, 2026-11):
  // TMDB ("Assista agora", região BR) e Letterboxd (JustWatch pelo país) já mostram; Rotten Tomatoes
  // e Metacritic mostram serviços dos EUA; o IMDb não mostra os do Brasil. Jogos não têm.
  const WATCH = { imdb: true, rottentomatoes: true, metacritic: true };

  const SHORT = {
    imdb_user: 'IMDb', tmdb_user: 'TMDB', letterboxd_user: 'Letterboxd', rt: 'Tomatometer',
    rt_audience: 'Popcorn', metacritic: 'Metacritic', opencritic: 'OpenCritic', igdb: 'IGDB',
    igdb_user: 'IGDB usuários', rawg: 'RAWG',
  };
  const SVC = Object.keys(SHORT);

  // ---------- consulta ----------
  function params() {
    const p = new URLSearchParams({ url: location.origin + location.pathname });
    if (site === 'letterboxd') {   // a página do Letterboxd traz os ids: casamento exato, não por slug
      const b = document.body;
      if (b && /^\d{1,12}$/.test(b.dataset.tmdbId || '')) {
        p.set('tmdb', b.dataset.tmdbId);
        p.set('media', b.dataset.tmdbType === 'tv' ? 'tv' : 'movie');
      }
      const a = document.querySelector('a[href*="imdb.com/title/tt"]');
      const m = a && /\/title\/(tt\d{5,12})/.exec(a.getAttribute('href') || '');
      if (m) p.set('imdb', m[1]);
    }
    return p;
  }
  const cache = new Map();
  function lookup(b, qs) {
    const url = `${b}/api/reviews/notes?${qs}`;
    if (cache.has(url)) return cache.get(url);
    const pr = new Promise((resolve) => {
      try {
        GM_xmlhttpRequest({
          method: 'GET', url, anonymous: true, timeout: 8000, headers: { Accept: 'application/json' },
          onload: (r) => {
            if (r.status !== 200) { resolve(null); return; }
            try { resolve(JSON.parse(r.responseText)); } catch (_) { resolve(null); }
          },
          onerror: () => resolve(null), ontimeout: () => resolve(null),
        });
      } catch (_) { resolve(null); }
    });
    cache.set(url, pr);
    pr.then((d) => { if (!d) cache.delete(url); });   // falha não fica no cache
    return pr;
  }

  // ---------- dados → itens do chip ----------
  const safeUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u) ? u : null);
  const ptNum = (s) => String(s).replace(/(\d)\.(\d)/g, '$1,$2');
  function model(d) {
    if (!d || d.found !== true || !Array.isArray(d.ratings)) return null;
    const ratings = d.ratings
      .filter((r) => r && r.self !== true && SVC.includes(r.source) && r.raw_score != null && String(r.raw_score).trim())
      .map((r) => ({
        source: r.source, short: SHORT[r.source], label: String(r.label || SHORT[r.source]).slice(0, 60),
        score: ptNum(String(r.raw_score).slice(0, 12)), kind: r.kind === 'user' ? 'usuários' : 'crítica',
        n: r.normalized != null && Number.isFinite(+r.normalized) ? Math.max(0, Math.min(100, Math.round(+r.normalized))) : null,
        url: safeUrl(r.url),
      }));
    const providers = WATCH[site] && Array.isArray(d.providers)
      ? [...new Set(d.providers.map((p) => p && String(p.name || '').trim()).filter(Boolean))].slice(0, 6) : [];
    const watch = providers.length ? { names: providers, url: safeUrl(d.watch_link) } : null;
    if (!ratings.length) return null;   // sem nota no News Reader, nada aparece (nem só "onde assistir")
    const title = d.title && d.title.title ? String(d.title.title).slice(0, 120) : '';
    const compound = d.compound != null && Number.isFinite(+d.compound) ? Math.round(+d.compound) : null;
    return { ratings, watch, title, compound };
  }

  // ---------- interface (shadow DOM) ----------
  const TOKENS = `:root{--us-font:system-ui,"Segoe UI",Roboto,"Noto Sans",sans-serif;--us-accent:#2563eb;--us-chip-bg:rgba(17,24,39,.85);--us-radius-pill:999px;--us-shadow:0 8px 28px rgba(0,0,0,.28);--us-motion:.15s;--us-target:44px;--us-z:2147483646;--us-surface:#fff;--us-text:#111827;--us-muted:#4b5563;--us-border:#e5e7eb;--us-svc-imdb_user:#7a5c00;--us-svc-tmdb_user:#0d4f80;--us-svc-letterboxd_user:#1f6f3f;--us-svc-rt:#b3261e;--us-svc-rt_audience:#9a3412;--us-svc-metacritic:#3f3f46;--us-svc-opencritic:#b8360a;--us-svc-igdb:#6d28d9;--us-svc-igdb_user:#5b21b6;--us-svc-rawg:#52525b;--us-svc-watch:#0f766e;--us-svc-nr:#2563eb}
@media (prefers-color-scheme:dark){:root{--us-accent:#93c5fd;--us-surface:#1f2937;--us-text:#f9fafb;--us-muted:#d1d5db;--us-border:#374151}}
@media (prefers-reduced-motion:reduce){:root{--us-motion:0s}}`;
  const CSS = `:host{all:initial}
.wrap{position:fixed;right:16px;bottom:var(--b,16px);z-index:var(--us-z);font:600 12px/1.2 var(--us-font);max-width:calc(100vw - 32px);transition:bottom var(--us-motion)}
button:focus-visible,a:focus-visible{outline:3px solid var(--us-accent);outline-offset:1px}
.x{width:var(--us-target);height:var(--us-target);border:0;background:transparent;color:var(--us-muted);font-size:16px;cursor:pointer;border-radius:50%}
.pill{display:inline-flex;align-items:center;gap:8px;min-height:var(--us-target);padding:0 16px;border:0;border-radius:var(--us-radius-pill);background:var(--us-chip-bg);color:#fff;font:inherit;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}
.pill i{width:10px;height:10px;border-radius:50%;background:var(--us-svc-nr)}
.panel{position:absolute;right:0;bottom:calc(var(--us-target) + 8px);width:320px;max-height:min(70vh,520px);overflow:auto;background:var(--us-surface);color:var(--us-text);border:1px solid var(--us-border);border-radius:14px;box-shadow:var(--us-shadow);padding:12px 14px;font-weight:500}
.panel h2{font:700 14px/1.3 var(--us-font);margin:0 40px 8px 0}
.panel .close{position:absolute;top:2px;right:2px}
.row{text-decoration:none;display:grid;grid-template-columns:1fr auto;gap:2px 10px;align-items:center;min-height:var(--us-target);padding:4px 0;border-top:1px solid var(--us-border);color:var(--us-text)}
.row .src{display:flex;align-items:center;gap:8px}
.row .src i{width:10px;height:10px;border-radius:3px;background:var(--c);flex:none}
.row small{color:var(--us-muted);font-weight:500}
.row .sc{font-weight:800;font-size:14px}
.bar{grid-column:1/-1;height:4px;border-radius:2px;background:var(--us-border)}
.bar>span{display:block;height:100%;border-radius:2px;background:var(--c)}
.watch{border-top:1px solid var(--us-border);padding-top:8px;margin-top:4px;color:var(--us-text)}
.watch a{display:inline-flex;align-items:center;color:var(--us-accent);min-height:var(--us-target);text-decoration:underline}
@media (max-width:599px){.panel{position:fixed;left:0;right:0;bottom:0;width:auto;max-height:70vh;border-radius:16px 16px 0 0;padding:12px 16px calc(16px + env(safe-area-inset-bottom))}}`;

  let hostEl = null, lastKey = '';
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function closeBtn(cls, label, fn) {
    const x = el('button', cls, '×'); x.type = 'button'; x.title = label; x.setAttribute('aria-label', label);
    x.addEventListener('click', fn); return x;
  }
  function buildPanel(m, wrap) {
    const pill = el('button', 'pill'); pill.type = 'button'; pill.setAttribute('aria-expanded', 'false');
    const txt = (m.compound != null ? `NR ${m.compound} · ` : '') + `${m.ratings.length} ${m.ratings.length === 1 ? 'nota' : 'notas'}`;
    pill.append(el('i'), el('span', null, txt + (m.watch ? ' · onde assistir' : '')));
    pill.title = 'Notas do News Reader';
    const panel = el('div', 'panel'); panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Notas do News Reader');
    panel.append(el('h2', null, m.title || 'Notas do News Reader'));
    const close = closeBtn('x close', 'Fechar', () => toggle(false));
    panel.append(close);
    m.ratings.forEach((r) => {
      const row = r.url ? el('a', 'row') : el('div', 'row');
      if (r.url) { row.href = r.url; row.target = '_blank'; row.rel = 'noopener noreferrer'; }
      row.style.setProperty('--c', `var(--us-svc-${r.source})`); row.dataset.src = r.source;
      const src = el('span', 'src'); src.append(el('i'), el('span', null, r.short), el('small', null, r.kind));
      row.append(src, el('span', 'sc', r.score));
      if (r.n != null) { const bar = el('span', 'bar'), f = el('span'); f.style.width = `${r.n}%`; bar.append(f); row.append(bar); }
      panel.append(row);
    });
    if (m.watch) {
      const w = el('div', 'watch'); w.append(el('span', null, `Onde assistir no Brasil: ${m.watch.names.join(', ')}`));
      if (m.watch.url) { w.append(document.createTextNode(' · ')); const a = el('a', null, 'ver opções'); a.href = m.watch.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; w.append(a); }
      panel.append(w);
    }
    // Abrir leva o foco ao botão fechar; fechar devolve à pílula. Esc vale em qualquer ponto do chip.
    function toggle(open) {
      panel.hidden = !open; pill.setAttribute('aria-expanded', String(open));
      (open ? close : pill).focus();
    }
    pill.addEventListener('click', () => toggle(panel.hidden));
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { e.stopPropagation(); toggle(false); } });
    wrap.append(panel, pill);
  }
  function remove() { if (hostEl) { hostEl.remove(); hostEl = null; } lastKey = ''; }
  // O chip do georritmo-links usa o mesmo canto no Letterboxd/IMDb: a pílula sobe acima dele.
  const offset = () => (document.getElementById('us-georritmo-links') ? '72px' : '16px');
  function render(m) {
    const key = JSON.stringify(m);
    if (key === lastKey && hostEl) return;
    remove(); lastKey = key;
    if (!m) return;
    if (!document.getElementById('us-tokens-notas')) {
      const st = el('style'); st.id = 'us-tokens-notas'; st.textContent = TOKENS;
      (document.head || document.documentElement).appendChild(st);
    }
    hostEl = el('div'); hostEl.id = 'us-notas-integradas';
    const root = hostEl.attachShadow({ mode: 'open' });
    const wrap = el('div', 'wrap'); wrap.style.setProperty('--b', offset());
    buildPanel(m, wrap);
    root.append(el('style', null, CSS), wrap);
    document.documentElement.appendChild(hostEl);
  }

  let seq = 0, hidden = false;
  async function run() {
    if (hidden) return;               // escondido neste site: nem o menu de endereço reativa
    const b = base();
    if (!b) { remove(); return; }
    const my = ++seq;
    const d = await lookup(b, params().toString());
    if (my !== seq || hidden) return; // a URL mudou (ou o site foi escondido) durante a consulta
    render(model(d));
  }

  menu('Endereço do News Reader…', () => {
    const v = window.prompt('Endereço do News Reader neste aparelho (vazio = desligado):', String(get('newsReader', DEFAULT_BASE)));
    if (v === null) return;
    set('newsReader', v.trim()); cache.clear(); remove(); run();
  });
  menu('Esconder as notas neste site', () => { const l = hiddenHosts(); l.push(host); set('esconder', [...new Set(l)].join(',')); hidden = true; remove(); stop(); });

  run();
  // Sites SPA (Metacritic, IGDB, RAWG, OpenCritic) trocam de página sem recarregar: revê só quando a
  // URL mudar; o observador fica no <head> (o título muda na troca), não na página inteira.
  // Na troca, as notas do item anterior saem antes da nova consulta.
  let href = location.href, t = 0;
  const changed = () => { if (location.href !== href) { href = location.href; remove(); run(); } };
  const obs = new MutationObserver(() => {
    if (t) return;
    t = setTimeout(() => { t = 0; changed(); }, 600);
  });
  window.addEventListener('popstate', changed);
  if (document.head) obs.observe(document.head, { childList: true, subtree: true, characterData: true });
  // O chip do georritmo-links pode chegar depois: só filhos diretos do <html>, sem subárvore.
  const side = new MutationObserver(() => { if (hostEl) { const w = hostEl.shadowRoot.querySelector('.wrap'); if (w) w.style.setProperty('--b', offset()); } });
  side.observe(document.documentElement, { childList: true });
  function stop() { obs.disconnect(); side.disconnect(); window.removeEventListener('popstate', changed); clearTimeout(t); t = 0; }
})();
