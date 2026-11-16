// ==UserScript==
// @name         Navidrome — letras
// @namespace    raschagas/userscripts
// @version      1.0.1
// @description  Faz o botão de letra nativo do player web do Navidrome mostrar também as letras em arquivo ao lado da música (.lrc/.yml), buscadas no próprio servidor.
// @match        https://music.georritmo.com/app/*
// @exclude      *://camara.leg.br/*
// @exclude      *://*.camara.leg.br/*
// @exclude      *://camara.gov.br/*
// @exclude      *://*.camara.gov.br/*
// @noframes
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/raschagas/userscripts/main/src/navidrome-letras.user.js
// @updateURL    https://raw.githubusercontent.com/raschagas/userscripts/main/src/navidrome-letras.user.js
// ==/UserScript==

/*
 * Como funciona (Navidrome 0.64): a UI monta cada item da fila a partir do registro da faixa vindo de
 * /api/song (ou /api/playlist/<id>/tracks). O campo `lyrics` é uma string JSON com a lista
 * [{lang, synced, line:[{start, value}]}]; só as entradas `synced` viram LRC para a barra de letra do
 * player (botão de livro). Letras em .lrc/.yml ao lado da música não vêm nesse campo (fica "[]"), mas o
 * servidor as entrega em /rest/getLyricsBySongId. Este script envolve o `fetch` da página e, nas
 * respostas de faixas sem letra sincronizada, preenche `lyrics` no mesmo formato. Nada muda no acervo.
 */
(() => {
  'use strict';
  const get = (k, d) => { try { const v = GM_getValue(k, d); return v === undefined ? d : v; } catch (_) { return d; } };
  const set = (k, v) => { try { GM_setValue(k, v); } catch (_) { /* sem gerenciador */ } };
  const menu = (t, f) => { try { GM_registerMenuCommand(t, f); } catch (_) { /* sem menu */ } };

  const host = location.host;
  const offHosts = () => String(get('desligado', '') || '').split(',').filter(Boolean);
  if (offHosts().includes(host)) {
    menu('Ligar letras neste site', () => { set('desligado', offHosts().filter(h => h !== host).join(',')); location.reload(); });
    return;
  }
  // Letra só texto fica de fora: a barra nativa só exibe letra sincronizada (mostra "No lyrics").
  const cfg = { debug: !!get('debug', false) };

  // Código que roda no contexto da página (precisa ver o `fetch` da própria UI). Autocontido.
  function pageMain(cfg) {
    if (window.__usNavidromeLetrasOn) return;
    window.__usNavidromeLetrasOn = true;
    const ORIG = window.fetch;
    const SONGS = /^\/api\/(song(\/[^/]+)?|playlist\/[^/]+\/tracks(\/[^/]+)?)$/;
    const MAX_PER_RESPONSE = 100, CONCURRENCY = 4, BUDGET_MS = 3000, BIG_LIST = 30;
    const done = new Map();    // id da faixa → string pronta para `lyrics`, ou null (servidor respondeu: sem letra sincronizada)
    const pending = new Map(); // id da faixa → Promise em andamento (buscas simultâneas compartilham)
    let active = 0;
    const waiting = [];
    // No máximo CONCURRENCY consultas ao mesmo tempo, somando as esperadas e as de fundo.
    const limit = task => new Promise((resolve, reject) => {
      const go = () => { active++; Promise.resolve().then(task).then(resolve, reject).finally(() => { active--; if (waiting.length) waiting.shift()(); }); };
      if (active < CONCURRENCY) go(); else waiting.push(go);
    });

    const session = () => {
      try {
        const u = localStorage.getItem('username'), t = localStorage.getItem('subsonic-token'), s = localStorage.getItem('subsonic-salt');
        return u && t && s ? { u, t, s } : null;
      } catch (_) { return null; }
    };

    const hasSynced = raw => {
      try { return (JSON.parse(raw || '[]') || []).some(l => l && l.synced && (l.line || []).length); } catch (_) { return false; }
    };

    // Resposta Subsonic OK → string JSON no formato do campo `lyrics` do Navidrome, ou null (sem sincronizada).
    // offset (OpenSubsonic structuredLyrics): ms; positivo = letra aparece antes ⇒ início efetivo = start − offset.
    const toNative = json => {
      const r = json && json['subsonic-response'];
      if (!r || r.status !== 'ok') return null;
      const list = (r.lyricsList && r.lyricsList.structuredLyrics) || [];
      const syn = list.find(l => l.synced && (l.line || []).some(x => Number.isFinite(Number(x.start))));
      if (!syn) return null;
      const off = Number(syn.offset) || 0;
      const line = syn.line.filter(x => Number.isFinite(Number(x.start)))
        .map(x => ({ start: Math.max(0, Number(x.start) - off), value: String(x.value == null ? '' : x.value).replace(/\r\n|\r|\n/g, ' ') }))
        .sort((a, b) => a.start - b.start);
      return JSON.stringify([{ lang: syn.lang || 'xxx', synced: true, line }]);
    };

    // Só guarda resultado de resposta bem-sucedida (HTTP ok e status Subsonic ok, inclusive "sem letra").
    // Erro HTTP, status failed ou falha de rede: nada fica guardado e a próxima resposta tenta de novo.
    const lyricsFor = id => {
      if (done.has(id)) return Promise.resolve(done.get(id));
      if (pending.has(id)) return pending.get(id);
      const ss = session();
      if (!ss) return Promise.resolve(null); // sem sessão: não guarda, tenta de novo depois
      // c=NavidromeUI: o mesmo cliente da UI, para o servidor não registrar outro player.
      const q = new URLSearchParams({ u: ss.u, t: ss.t, s: ss.s, v: '1.16.1', c: 'NavidromeUI', f: 'json', id });
      const p = limit(() => ORIG.call(window, `/rest/getLyricsBySongId?${q}`, { credentials: 'same-origin', redirect: 'error' }))
        .then(async r => {
          const j = r.ok ? await r.json() : null;
          const ok = !!(j && j['subsonic-response'] && j['subsonic-response'].status === 'ok');
          const v = ok ? toNative(j) : null;
          if (ok) done.set(id, v);
          return v;
        })
        .catch(() => null)
        .finally(() => pending.delete(id));
      pending.set(id, p);
      return p;
    };

    // Preenche in-place; devolve quantas faixas mudaram. wait=false (lista grande ou aleatória): usa só o
    // que já está guardado e busca o resto em segundo plano, para a próxima resposta — sem atrasar a UI.
    const patchSongs = async (data, wait = true) => {
      const songs = (Array.isArray(data) ? data : [data]).filter(s => s && typeof s === 'object' && !s.isRadio);
      const todo = songs.filter(s => (s.mediaFileId || s.id) && !hasSynced(s.lyrics)).slice(0, MAX_PER_RESPONSE);
      if (!todo.length) return 0;
      let changed = 0;
      const apply = (s, v) => { if (v) { s.lyrics = v; changed++; } };
      if (!wait) {
        for (const s of todo) {
          const id = s.mediaFileId || s.id;
          if (done.has(id)) apply(s, done.get(id)); else lyricsFor(id);
        }
        return changed;
      }
      const all = Promise.all(todo.map(s => lyricsFor(s.mediaFileId || s.id).then(v => apply(s, v))));
      let timer;
      await Promise.race([all, new Promise(r => { timer = setTimeout(r, BUDGET_MS); })]); // lenta: segue com o que chegou
      clearTimeout(timer);
      return changed;
    };

    window.fetch = async function (input, init) {
      const res = await ORIG.apply(this, arguments);
      try {
        const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
        const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        if (method !== 'GET' || url.origin !== location.origin || !SONGS.test(url.pathname) || !res.ok) return res;
        if (!/json/i.test(res.headers.get('content-type') || '')) return res;
        const data = await res.clone().json();
        const big = url.searchParams.get('_sort') === 'random' || (Array.isArray(data) && data.length > BIG_LIST);
        if (!(await patchSongs(data, !big))) return res;
        const headers = new Headers(res.headers);
        headers.delete('content-length');
        headers.delete('content-encoding');
        return new Response(JSON.stringify(data), { status: res.status, statusText: res.statusText, headers });
      } catch (_) {
        return res; // qualquer surpresa: resposta original intacta
      }
    };
    if (cfg.debug) window.__usNavidromeLetras = { toNative, hasSynced, patchSongs, done, pending };
  }

  // Injeta no contexto da página (sem CSP no Navidrome 0.64). document-start: antes do primeiro /api/song.
  const inject = () => {
    const el = document.createElement('script');
    el.textContent = `(${pageMain})(${JSON.stringify(cfg)});`;
    (document.head || document.documentElement).appendChild(el);
    el.remove();
  };
  if (document.documentElement) inject();
  else new MutationObserver((_, mo) => { if (document.documentElement) { mo.disconnect(); inject(); } }).observe(document, { childList: true });

  menu('Desligar letras neste site', () => { set('desligado', [...offHosts(), host].join(',')); location.reload(); });
})();
