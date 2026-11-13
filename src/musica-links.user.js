// ==UserScript==
// @name         Música — pedir no Lidarr
// @namespace    raschagas/userscripts
// @version      1.0.0
// @description  Chip discreto em páginas de álbum e artista (RYM, Last.fm, ListenBrainz, MusicBrainz, Spotify, Deezer, Discogs, Bandcamp, AOTY, Apple Music): leva à tela de adicionar do Lidarr já no álbum ou artista certo, com link para o MusicBrainz.
// @match        https://rateyourmusic.com/release/*
// @match        https://rateyourmusic.com/artist/*
// @match        https://www.last.fm/music/*
// @match        https://www.last.fm/*/music/*
// @match        https://listenbrainz.org/album/*
// @match        https://listenbrainz.org/artist/*
// @match        https://listenbrainz.org/release-group/*
// @match        https://musicbrainz.org/release-group/*
// @match        https://musicbrainz.org/release/*
// @match        https://musicbrainz.org/artist/*
// @match        https://open.spotify.com/*
// @match        https://www.deezer.com/*
// @match        https://www.discogs.com/*
// @match        https://*.bandcamp.com/album/*
// @match        https://www.albumoftheyear.org/album/*
// @match        https://www.albumoftheyear.org/artist/*
// @match        https://music.apple.com/*
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
// @connect      musicbrainz.org
// @downloadURL  https://raw.githubusercontent.com/raschagas/userscripts/main/src/musica-links.user.js
// @updateURL    https://raw.githubusercontent.com/raschagas/userscripts/main/src/musica-links.user.js
// ==/UserScript==

(() => {
  'use strict';
  const get = (k, d) => { try { const v = GM_getValue(k, d); return v === undefined ? d : v; } catch (_) { return d; } };
  const set = (k, v) => { try { GM_setValue(k, v); } catch (_) { /* sem gerenciador */ } };
  const menu = (t, f) => { try { GM_registerMenuCommand(t, f); } catch (_) { /* sem menu */ } };

  const host = location.hostname;
  const hiddenHosts = () => String(get('esconder', '') || '').split(',').filter(Boolean);
  if (hiddenHosts().includes(host)) return;

  // Endereço do Lidarr por dispositivo (valor do gerenciador). Vazio = botão some.
  const trim = u => String(u || '').trim().replace(/\/+$/, '');
  const LIDARR = () => trim(get('lidarr', 'https://lidarr.georritmo.com'));
  const q = encodeURIComponent;
  const MBID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  // ---------- texto ----------
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const meta = p => { const m = document.querySelector(`meta[property="${p}"], meta[name="${p}"]`); return m ? clean(m.content) : ''; };
  const txt = sel => { const e = document.querySelector(sel); return e ? clean(e.textContent) : ''; };
  const seg = s => { try { return clean(decodeURIComponent(s.replace(/\+/g, ' '))); } catch (_) { return clean(s); } };

  // ---------- JSON-LD (schema.org MusicAlbum / MusicGroup), usado por vários sites ----------
  function ld() {
    const out = [];
    const walk = (n, d) => {
      if (!n || d > 6) return;
      if (Array.isArray(n)) { n.forEach(x => walk(x, d + 1)); return; }
      if (typeof n !== 'object') return;
      out.push(n);
      ['@graph', 'mainEntity', 'itemListElement', 'item'].forEach(k => k in n && walk(n[k], d + 1));
    };
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { walk(JSON.parse(s.textContent || ''), 0); } catch (_) { /* JSON quebrado */ }
    }
    return out;
  }
  const isT = (n, t) => { const ty = n && n['@type']; return ty === t || (Array.isArray(ty) && ty.includes(t)); };
  // Nome de um nó schema.org: texto puro ou objeto com `name`; objeto sem nome = '' (nunca "[object Object]").
  const nameOf = v => {
    const x = Array.isArray(v) ? v[0] : v;
    if (typeof x === 'string') return clean(x);
    return x && typeof x === 'object' && typeof x.name === 'string' ? clean(x.name) : '';
  };
  function fromLd(kindHint) {
    const nodes = ld();
    const al = nodes.find(n => isT(n, 'MusicAlbum') || isT(n, 'MusicRelease'));
    if (al && kindHint !== 'artist') {
      const artist = nameOf(al.byArtist) || nameOf(al.creator) || nameOf(al.author);
      if (al.name && artist) return { kind: 'album', album: clean(al.name), artist };
    }
    const gr = nodes.find(n => isT(n, 'MusicGroup') || (isT(n, 'Person') && kindHint === 'artist'));
    if (gr && gr.name && kindHint !== 'album') return { kind: 'artist', artist: clean(gr.name) };
    return null;
  }

  // ---------- adaptadores: cada um só lê a página ----------
  // Devolvem { kind:'album'|'artist', artist, album?, mb:{rg?,release?,artist?}, lookup? } ou null.
  // `lookup` = URL canônica para o MusicBrainz resolver o MBID (relação de URL).
  let path = location.pathname; // relido a cada render (SPAs)
  const ADAPTERS = [
    { id: 'musicbrainz', host: /^musicbrainz\.org$/, read() {
      const m = /^\/(release-group|release|artist)\/([0-9a-f-]{36})/.exec(path); if (!m) return null;
      const h1 = txt('.releaseheader h1 bdi, .rgheader h1 bdi, .artistheader h1 bdi, h1 bdi') || txt('h1');
      const ar = document.querySelector('.subheader a[href^="/artist/"], .subheader a[href*="musicbrainz.org/artist/"]');
      const arId = ar && MBID.exec(ar.getAttribute('href'));
      if (m[1] === 'artist') return { kind: 'artist', artist: h1, mb: { artist: m[2] } };
      const rgA = m[1] === 'release' && document.querySelector('.subheader a[href*="/release-group/"], a[href^="/release-group/"]');
      const rg = m[1] === 'release-group' ? m[2] : (rgA && (MBID.exec(rgA.getAttribute('href')) || [])[0]);
      return { kind: 'album', album: h1, artist: ar ? clean(ar.textContent) : '', mb: { rg, release: m[1] === 'release' ? m[2] : undefined, artist: arId && arId[0] } };
    } },
    { id: 'listenbrainz', host: /^listenbrainz\.org$/, spa: true, bottom: [76, 76], read() {
      const m = /^\/(album|release-group|artist)\/([0-9a-f-]{36})/.exec(path); if (!m) return null;
      // Título da aba: "Álbum - Artista - ListenBrainz" ou "Artista - ListenBrainz".
      const parts = document.title.split(' - ').map(clean).filter(p => p && !/^listenbrainz$/i.test(p));
      const h = txt('.entity-page-header h1, .artist-page h1, .album-page h1, h1') || parts[0] || '';
      if (m[1] === 'artist') return { kind: 'artist', artist: h || parts[0], mb: { artist: m[2] } };
      const ar = document.querySelector('.entity-page-header a[href*="/artist/"], .details a[href*="/artist/"], a[href^="/artist/"]');
      const arId = ar && MBID.exec(ar.getAttribute('href'));
      return { kind: 'album', album: h, artist: ar ? clean(ar.textContent) : (parts[1] || ''), mb: { rg: m[2], artist: arId && arId[0] } };
    } },
    { id: 'lastfm', host: /(^|\.)last\.fm$/, spa: true, read() {
      const m = /^(?:\/[a-z]{2})?\/music\/([^/?#]+)(?:\/([^/?#]+))?/.exec(path); if (!m) return null;
      if (m[1].startsWith('+')) return null;   // /music/+recommended, +releases…: não é artista
      const artist = seg(m[1]);
      // O MusicBrainz liga sobretudo a URL do artista no Last.fm; no álbum, ela dá o MBID do artista.
      const artistUrl = `https://www.last.fm/music/${m[1]}`;
      if (!m[2] || m[2].startsWith('+') || m[2] === '_') return { kind: 'artist', artist, lookup: artistUrl };
      return { kind: 'album', artist, album: seg(m[2]), lookup: `${artistUrl}/${m[2]}`, lookupArtist: artistUrl };
    } },
    { id: 'rym', host: /(^|\.)rateyourmusic\.com$/, read() {
      const lookup = `https://rateyourmusic.com${path.replace(/\/?$/, '/')}`;
      if (/^\/artist\//.test(path)) return { kind: 'artist', artist: txt('h1.artist_name_hdr') || meta('og:title').replace(/\s*[-|].*$/, ''), lookup };
      if (!/^\/release\//.test(path)) return null;
      const artist = txt('.album_info a.artist, .album_artist_small a.artist, a.artist');
      // O título traz "By <artista>" no fim; só esse sufixo sai ("Stand by Me" fica inteiro).
      const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const album = artist ? clean(txt('.album_title').replace(new RegExp(`\\s+By\\s+${esc(artist)}.*$`), '')) : '';
      if (album && artist) return { kind: 'album', album, artist, lookup };
      const m = /^(.*) by (.*?)(?: - RYM| \|.*)?$/.exec(meta('og:title') || document.title);
      return m ? { kind: 'album', album: clean(m[1]), artist: clean(m[2]), lookup } : null;
    } },
    { id: 'spotify', host: /^open\.spotify\.com$/, spa: true, bottom: [104, 136], read() {
      const m = /^(?:\/intl-[a-z-]+)?\/(album|artist)\/([A-Za-z0-9]{22})/.exec(path); if (!m) return null;
      const lookup = `https://open.spotify.com/${m[1]}/${m[2]}`;
      const dt = clean(document.title.replace(/\u200e/g, ''));
      const h = txt('main h1, [data-testid="entityTitle"] h1'); // o 1º h1 da página é a barra lateral
      if (m[1] === 'artist') { const a = h || dt.replace(/\s*\|\s*Spotify$/, ''); return a ? { kind: 'artist', artist: a, lookup } : null; }
      // "Ouça OK Computer – Álbum de Radiohead | Spotify" / "OK Computer - Album by Radiohead | Spotify"
      const mm = /^(?:Ouça |Listen to )?(.+?) [–-] (?:Álbum|Album|Single|EP|Compilação|Compilation)(?: de| by) (.+?) \| Spotify$/.exec(dt);
      const ar = document.querySelector('[data-testid="creator-link"]');
      const album = h || (mm && mm[1]) || '', artist = (ar && clean(ar.textContent)) || (mm && mm[2]) || '';
      return album && artist ? { kind: 'album', album, artist, lookup } : null;
    } },
    { id: 'deezer', host: /^www\.deezer\.com$/, spa: true, bottom: [96, 132], read() {
      const m = /^(?:\/[a-z]{2})?\/(album|artist)\/(\d+)/.exec(path); if (!m) return null;
      const lookup = `https://www.deezer.com/${m[1]}/${m[2]}`;
      const t = meta('og:title') || txt('h1');
      if (m[1] === 'artist') return t ? { kind: 'artist', artist: t, lookup } : null;
      // og:description "Radiohead - álbum - 1997 - 12 músicas"; o título da aba muda ao tocar.
      const artist = txt('[data-testid="creator-name"]') || clean(meta('og:description').split(' - ')[0]);
      return t && artist ? { kind: 'album', album: t, artist, lookup } : null;
    } },
    { id: 'discogs', host: /^www\.discogs\.com$/, spa: true, read() {
      const m = /^(?:\/[a-z]{2}(?:_[A-Z]{2})?)?\/(master|release|artist)\/(\d+)/.exec(path); if (!m) return null;
      const lookup = `https://www.discogs.com/${m[1]}/${m[2]}`;
      if (m[1] === 'artist') return { kind: 'artist', artist: txt('h1').replace(/\s*\(\d+\)$/, '') || meta('og:title'), lookup };
      const l = fromLd('album'); if (l) return { ...l, artist: l.artist.replace(/\s*\(\d+\)$/, ''), lookup };
      // h1 "Artista – Álbum" (travessão).
      const mm = /^(.*?)\s+[–-]\s+(.*)$/.exec(txt('h1') || meta('og:title'));
      return mm ? { kind: 'album', artist: clean(mm[1]).replace(/\*$/, '').replace(/\s*\(\d+\)$/, ''), album: clean(mm[2]), lookup } : null;
    } },
    { id: 'bandcamp', host: /\.bandcamp\.com$/, read() {
      if (!/^\/album\//.test(path)) return null;
      const lookup = location.origin + path.replace(/\/+$/, '');
      const l = fromLd('album'); if (l) return { ...l, lookup };
      const album = txt('#name-section .trackTitle'), artist = txt('#name-section h3 a, #name-section h3 span a');
      return album && artist ? { kind: 'album', album, artist, lookup } : null;
    } },
    { id: 'aoty', host: /(^|\.)albumoftheyear\.org$/, read() {
      if (/^\/artist\//.test(path)) { const a = txt('h1.artistHeadline, .artistHeadline, h1'); return a ? { kind: 'artist', artist: a } : null; }
      const album = txt('.albumTitle span, .albumTitle'), artist = txt('.artist a span, .artist a, .albumHeadline .artist');
      if (album && artist) return { kind: 'album', album, artist };
      const l = fromLd('album'); return l;
    } },
    { id: 'apple', host: /^music\.apple\.com$/, spa: true, bottom: [16, 136], read() {
      const mm0 = /^\/([a-z]{2})\/(album|artist)\/(?:[^/]+\/)?(\d+)/.exec(path); if (!mm0) return null;
      const [, cc, kind, id] = mm0;
      // O MusicBrainz guarda o link com o país (gb, us…), sem o trecho do nome.
      const lookup = [...new Set([cc, 'us', 'gb'])].map(c => `https://music.apple.com/${c}/${kind}/${id}`);
      const l = fromLd(kind); if (l) return { ...l, lookup };
      const h = txt('h1[data-testid="non-editable-product-title"]');
      const dt = clean(document.title.replace(/\u200e/g, ''));
      if (kind === 'artist') { const a = h || dt.replace(/\s+(?:-|on|no)\s+Apple Music$/i, ''); return a ? { kind: 'artist', artist: a, lookup } : null; }
      // "OK Computer - Album by Radiohead - Apple Music" / "OK Computer – Álbum de Radiohead – Apple Music"
      const mm = /^(.+?) [–-] (?:Album|Álbum|EP|Single)(?: by| de| por) (.+?) [–-] Apple Music$/i.exec(dt);
      const ar = document.querySelector('a[data-testid="click-action"][href*="/artist/"]');
      const album = h || (mm && mm[1]) || '', artist = (ar && clean(ar.textContent)) || (mm && mm[2]) || '';
      return album && artist ? { kind: 'album', album, artist, lookup } : null;
    } },
  ];
  const adapter = ADAPTERS.find(a => a.host.test(host));
  if (!adapter) return;

  // ---------- rede: só o MusicBrainz (MBID pela URL da página); GET com timeout ----------
  // Corrida com 10 s: se o gerenciador nunca chamar nenhum callback, a fila não trava.
  function gm(url, headers) {
    const req = new Promise(res => {
      try {
        GM_xmlhttpRequest({ method: 'GET', url, headers: headers || {}, anonymous: true, timeout: 8000, responseType: 'json',
          onload: r => { if (r.status === 404) return res({}); if (r.status !== 200) return res(null); try { res(typeof r.response === 'object' && r.response ? r.response : JSON.parse(r.responseText)); } catch (_) { res(null); } },
          onerror: () => res(null), ontimeout: () => res(null), onabort: () => res(null) });
      } catch (_) { res(null); }
    });
    return Promise.race([req, new Promise(res => setTimeout(() => res(null), 10000))]);
  }

  // MusicBrainz: URL → release-group/artist MBID. Cache por dispositivo (30 dias, até 300 entradas).
  const MB_TTL = 30 * 864e5;
  const MB_H = { Accept: 'application/json', 'User-Agent': 'raschagas-userscripts/1.0 ( https://github.com/raschagas/userscripts )' };
  const pause = ms => new Promise(ok => setTimeout(ok, ms));
  // Uma fila só para todas as consultas (renders concorrentes inclusive): ≥ 1,1 s entre requisições.
  let mbQueue = Promise.resolve(), mbLast = 0;
  function mbOne(url) {
    const p = mbQueue.then(async () => {
      for (let w; (w = 1100 - (Date.now() - mbLast)) > 0;) await pause(w);   // timers podem disparar 1 ms antes
      if (closed) return null;                // fechado: o que estava na fila não sai
      mbLast = Date.now();
      return gm(url, MB_H);
    }).catch(() => null);
    mbQueue = p.catch(() => null);
    return p;
  }
  async function mbGet(url) {               // "busy" (503) tenta de novo uma vez; sem espera após a última falha
    const r = await mbOne(url);
    if (r !== null || closed) return r;
    await pause(2000);
    return mbOne(url);
  }
  // `urls`: uma URL canônica ou uma lista de formas equivalentes (Apple Music varia o país).
  const mbInflight = {};
  function mbByUrl(urls) {
    urls = [].concat(urls);
    const key = urls[0];
    const hit = (get('mbCache', {}) || {})[key];
    if (hit && Date.now() - hit.t < MB_TTL) return Promise.resolve(hit.v);
    if (!mbInflight[key]) mbInflight[key] = mbResolve(urls, key).finally(() => { delete mbInflight[key]; });
    return mbInflight[key];
  }
  async function mbResolve(urls, key) {
    const v = {}; let complete = true;   // complete = nenhuma consulta caiu em erro de rede
    for (const url of urls) {
      const r = await mbGet(`https://musicbrainz.org/ws/2/url?resource=${q(url)}&inc=release-group-rels+release-rels+artist-rels&fmt=json`);
      if (r === null) { complete = false; continue; }   // erro de rede: não grava cache
      for (const rel of r.relations || []) {
        const rgRel = rel.release_group || rel['release-group'];
        if (rgRel) v.rg = v.rg || rgRel.id;
        if (rel.release) v.release = v.release || rel.release.id;
        if (rel.artist) v.artist = v.artist || rel.artist.id;
      }
      if (v.rg || v.release || v.artist) break;
    }
    // Streaming costuma estar ligado ao release; o Lidarr quer o release-group.
    if (v.release && !v.rg) {
      const rel = await mbGet(`https://musicbrainz.org/ws/2/release/${v.release}?inc=release-groups+artist-credits&fmt=json`);
      if (rel === null) complete = false;      // 404 ({}) = "sem release-group" e vai ao cache
      if (rel && rel['release-group']) v.rg = rel['release-group'].id;
      const ac = rel && rel['artist-credit'] && rel['artist-credit'][0];
      if (ac && ac.artist && !v.artist) v.artist = ac.artist.id;
    }
    // Só resultado completo vai ao cache: toda consulta respondeu (404 = "sem cadastro" conta).
    if (complete) {
      const cache = get('mbCache', {}) || {};
      cache[key] = { t: Date.now(), v };
      const keys = Object.keys(cache);
      if (keys.length > 300) keys.sort((a, b) => cache[a].t - cache[b].t).slice(0, keys.length - 300).forEach(k => delete cache[k]);
      set('mbCache', cache);
    }
    return v;
  }

  // ---------- links ----------
  function actions(it) {
    const out = [], li = LIDARR();
    const what = it.kind === 'album' ? `“${it.album}” — ${it.artist}` : `“${it.artist}”`;
    if (li) {
      const lid = (id, text) => `${li}/add/search?term=${q(id ? `lidarr:${id}` : text)}`;
      if (it.kind === 'album') {
        out.push({ t: '+ Lidarr', c: 'lidarr', u: lid(it.mb.rg, `${it.artist} ${it.album}`), h: `Adicionar o álbum ${what} no Lidarr (você escolhe edição e monitoramento lá)` });
        out.push({ t: '+ artista', c: 'lidarr', u: lid(it.mb.artist, it.artist), h: `Abrir o artista “${it.artist}” no Lidarr para escolher álbuns da discografia` });
      } else {
        out.push({ t: '+ Lidarr', c: 'lidarr', u: lid(it.mb.artist, it.artist), h: `Adicionar o artista ${what} no Lidarr (sem monitorar; você escolhe os álbuns)` });
      }
    }
    if (adapter.id !== 'musicbrainz') {
      const id = it.kind === 'album' ? it.mb.rg : it.mb.artist;
      const u = id ? `https://musicbrainz.org/${it.kind === 'album' ? 'release-group' : 'artist'}/${id}`
        : `https://musicbrainz.org/search?type=${it.kind === 'album' ? 'release_group' : 'artist'}&method=indexed&query=${q(it.kind === 'album' ? `releasegroup:"${it.album}" AND artist:"${it.artist}"` : `artist:"${it.artist}"`)}`;
      out.push({ t: 'MusicBrainz', c: 'musicbrainz', u, h: id ? 'Abrir no MusicBrainz' : `Buscar ${what} no MusicBrainz` });
    }
    return out;
  }

  // Recuo inferior [PC, celular]: sites com player fixo embaixo (Spotify, Deezer) empurram o chip para cima.
  const [B_PC, B_CEL] = adapter.bottom || [16, 12];
  // ---------- chip (shadow DOM) ----------
  const TOKENS = `:root{--us-font:system-ui,"Segoe UI",Roboto,"Noto Sans",sans-serif;--us-chip-bg:rgba(17,24,39,.85);--us-radius-pill:999px;--us-motion:.15s;--us-target:44px;--us-z:2147483646;--us-svc-lidarr:#00804a;--us-svc-musicbrainz:#9c2f78}
@media (prefers-reduced-motion:reduce){:root{--us-motion:0s}}`;
  const CSS = `:host{all:initial;--b-pc:${B_PC}px;--b-cel:${B_CEL}px}
.chip{position:fixed;right:16px;bottom:var(--b-pc);z-index:var(--us-z);display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end;max-width:calc(100vw - 32px);box-sizing:border-box;background:var(--us-chip-bg);color:#fff;border-radius:22px;padding:0 0 0 12px;font:600 12px/1 var(--us-font);box-shadow:0 4px 14px rgba(0,0,0,.25);opacity:.92;transition:opacity var(--us-motion)}
.chip:hover,.chip:focus-within{opacity:1}
.lbl{opacity:.7;margin-right:2px}
a{display:inline-flex;align-items:center;gap:6px;min-height:var(--us-target);color:#fff;text-decoration:none;border-radius:16px}
a>span{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 12px;border-radius:16px;background:var(--c)}
a:focus-visible>span,button:focus-visible{outline:3px solid #fff;outline-offset:1px}
a:focus-visible{outline:none}
button{width:var(--us-target);height:var(--us-target);border:0;background:transparent;color:#fff;opacity:.6;font-size:16px;cursor:pointer;border-radius:50%}
@media (max-width:599px){.chip{right:12px;bottom:var(--b-cel);padding-left:6px;gap:4px}.lbl{display:none}a>span{padding:0 10px}}`;

  let hostEl = null, lastKey = '', closed = false;
  function draw(it, acts) {
    if (closed) return;
    const key = JSON.stringify([it, acts]);
    if (key === lastKey && hostEl && hostEl.isConnected) return; lastKey = key;
    if (hostEl) { hostEl.remove(); hostEl = null; }
    if (!acts.length) return;
    if (!document.getElementById('us-tokens-musica')) {
      const st = document.createElement('style'); st.id = 'us-tokens-musica'; st.textContent = TOKENS;
      (document.head || document.documentElement).appendChild(st);
    }
    hostEl = document.createElement('div'); hostEl.id = 'us-musica-links';
    const root = hostEl.attachShadow({ mode: 'open' });
    const st = document.createElement('style'); st.textContent = CSS;
    const chip = document.createElement('div'); chip.className = 'chip'; chip.setAttribute('role', 'navigation'); chip.setAttribute('aria-label', 'Atalhos de música');
    const mk = a => {
      const el = document.createElement('a');
      el.href = a.u; el.target = '_blank'; el.rel = 'noopener noreferrer'; el.title = a.h; el.dataset.svc = a.c;
      el.style.setProperty('--c', `var(--us-svc-${a.c})`);
      const tx = document.createElement('span');
      tx.textContent = a.t; el.append(tx);
      return el;
    };
    const lb = document.createElement('span'); lb.className = 'lbl'; lb.textContent = 'música'; chip.append(lb);
    for (const a of acts) chip.append(mk(a));
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.title = 'Esconder nesta página'; x.setAttribute('aria-label', 'Esconder nesta página');
    x.addEventListener('click', close);
    chip.append(x);
    root.prepend(st); root.append(chip);
    document.documentElement.appendChild(hostEl);
    if (!adapter.spa) stop();                // página estática: desenhou, não há mais o que observar
  }

  let seq = 0;
  async function render() {
    if (closed) return;
    const my = ++seq;
    path = location.pathname;
    let it = null;
    try { it = adapter.read(); } catch (_) { it = null; }
    if (!it || !it.artist || (it.kind === 'album' && !it.album)) { if (hostEl) { hostEl.remove(); hostEl = null; lastKey = ''; } return; }
    it.mb = Object.fromEntries(Object.entries(it.mb || {}).filter(([, v]) => v));
    draw(it, actions(it));                             // links por texto já na hora
    // Resposta em formato inesperado não pode virar rejeição solta: fica a busca por nome já desenhada.
    try {
      if (it.lookup && !(it.kind === 'album' ? it.mb.rg : it.mb.artist)) {
        const v = await mbByUrl(it.lookup); if (my !== seq || closed) return;
        it.mb = { ...(v || {}), ...it.mb };
        draw(it, actions(it));                         // com MBID: item exato no Lidarr
      }
      if (it.kind === 'album' && it.lookupArtist && !it.mb.artist) {
        const v = await mbByUrl(it.lookupArtist); if (my !== seq || closed) return;
        if (v && v.artist) { it.mb = { ...it.mb, artist: v.artist }; draw(it, actions(it)); }
      }
    } catch (_) { /* mantém os links por texto */ }
  }

  menu('Endereço do Lidarr', () => {
    const l = prompt('Endereço do Lidarr (vazio = sem botão):', LIDARR()); if (l !== null) set('lidarr', trim(l));
    lastKey = ''; render();
  });
  menu('Esconder o chip neste site', () => { const l = hiddenHosts(); l.push(host); set('esconder', [...new Set(l)].join(',')); close(); });

  // SPA (Spotify, Deezer, Apple, ListenBrainz, Last.fm, Discogs): revê só quando a URL ou o título mudam.
  // Páginas estáticas (MusicBrainz, RYM, Bandcamp, AOTY) param de observar no primeiro desenho.
  let obs = null, t = 0, href = location.href, title = document.title;
  function stop() { if (obs) obs.disconnect(); obs = null; }
  // Fechar vale até recarregar: nenhuma resposta em voo nem mutação traz o chip de volta.
  function close() {
    closed = true; seq++;
    clearTimeout(t); t = 0;
    stop();
    if (hostEl) hostEl.remove();
    hostEl = null;
  }
  if (document.body) {
    obs = new MutationObserver(() => {
      if (t) return;
      t = setTimeout(() => {
        t = 0;
        // Sem chip ainda: a SPA pode estar terminando de desenhar o cabeçalho; tenta de novo.
        const changed = location.href !== href || document.title !== title;
        href = location.href; title = document.title;
        if (changed || !hostEl) render();
      }, 800);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }
  render();
})();
