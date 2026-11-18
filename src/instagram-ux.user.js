// ==UserScript==
// @name         Instagram — vídeo e feed sem atrito
// @namespace    raschagas/userscripts
// @version      1.0.1
// @description  Barra de progresso em Reels, Stories e vídeos do feed, atalhos de teclado, volume lembrado e feed sem sugestões, patrocinados e banner do app. Nenhum elemento é acrescentado à página (só um estilo); os ajustes ficam no menu do gerenciador.
// @match        https://www.instagram.com/*
// @exclude      *://camara.leg.br/*
// @exclude      *://*.camara.leg.br/*
// @exclude      *://camara.gov.br/*
// @exclude      *://*.camara.gov.br/*
// @noframes
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @downloadURL  https://raw.githubusercontent.com/raschagas/userscripts/main/src/instagram-ux.user.js
// @updateURL    https://raw.githubusercontent.com/raschagas/userscripts/main/src/instagram-ux.user.js
// ==/UserScript==

(() => {
  'use strict';
  if (location.hostname !== 'www.instagram.com') return; // nem por regra extra do gerenciador
  const get = (k, d) => { try { const v = GM_getValue(k, d); return v == null ? d : v; } catch (_) { return d; } };
  const set = (k, v) => { try { GM_setValue(k, v); } catch (_) {} };

  // ---------- Ajustes (menu do gerenciador; valor `ajustes`) ----------
  const DEF = { barra: true, atalhos: true, volume: true,
    sugestoes: true, patrocinados: true, app: true, seguindo: false };
  const prefs = () => {
    const p = get('ajustes', {});
    const o = Object.assign({}, DEF, p && typeof p === 'object' ? p : {});
    return o;
  };
  let P = prefs();
  const save = patch => { P = Object.assign({}, P, patch); set('ajustes', P); };

  const BAND = 48;           // faixa inferior liberada para a barra nativa
  const STEP = 5;            // ←/→ em segundos
  const ROOT = document.documentElement;

  // ---------- CSS: um único <style>; tudo o mais são atributos data-us-ig-* ----------
  const CSS = `
html[data-us-ig-barra] video[data-us-ig-v]{pointer-events:auto!important}
html[data-us-ig-barra] [data-us-ig-cobre]{clip-path:var(--us-ig-furo)!important}
html[data-us-ig-barra] video[data-us-ig-v]::-webkit-media-controls-fullscreen-button,
html[data-us-ig-barra] video[data-us-ig-v]::-webkit-media-controls-overflow-button,
html[data-us-ig-barra] video[data-us-ig-v]::-webkit-media-controls-toggle-closed-captions-button,
html[data-us-ig-barra] video[data-us-ig-v]::-webkit-media-controls-overlay-play-button,
html[data-us-ig-barra] video[data-us-ig-v]::-webkit-media-controls-overlay-enclosure{display:none!important}
html[data-us-ig-sugestoes] [data-us-ig-oculto="sugestao"],
html[data-us-ig-patrocinados] [data-us-ig-oculto="patrocinado"],
html[data-us-ig-app] [data-us-ig-oculto="app"]{display:none!important}`;
  let style = null;
  function attachStyle() {
    if (!style) { style = document.createElement('style'); style.id = 'us-instagram-ux'; style.textContent = CSS; }
    const parent = document.head || document.documentElement;
    if (parent && !style.isConnected) parent.appendChild(style);
  }
  function applyRootFlags() {
    const r = document.documentElement;
    if (!r) return;
    const flag = (n, on, v = '') => { if (on) { if (r.getAttribute(n) !== v) r.setAttribute(n, v); } else if (r.hasAttribute(n)) r.removeAttribute(n); };
    flag('data-us-ig-barra', P.barra);
    flag('data-us-ig-sugestoes', P.sugestoes);
    flag('data-us-ig-patrocinados', P.patrocinados);
    flag('data-us-ig-app', P.app);
  }

  // ---------- Utilidades ----------
  const vh = () => window.innerHeight || ROOT.clientHeight;
  const vw = () => window.innerWidth || ROOT.clientWidth;
  function visibleArea(el) {
    const r = el.getBoundingClientRect();
    const w = Math.min(r.right, vw()) - Math.max(r.left, 0), h = Math.min(r.bottom, vh()) - Math.max(r.top, 0);
    return w > 0 && h > 0 ? w * h : 0;
  }
  const dialogs = () => [...document.querySelectorAll('[role="dialog"]')].filter(d => d.getClientRects().length);
  // Vídeo ativo: com um [role=dialog] visível (Story, post aberto), só o vídeo dele (post de foto = nenhum;
  // o vídeo do feed escondido atrás não é tocado); sem diálogo, o mais visível na tela.
  function activeVideo() {
    const ds = dialogs();
    return activeVideoIn(ds.length ? ds[ds.length - 1] : document);
  }
  function activeVideoIn(scope) {
    let best = null, area = 0;
    for (const v of scope.querySelectorAll('video')) { const a = visibleArea(v); if (a > area) { area = a; best = v; } }
    return best;
  }
  const isEditable = t => !!t && t.nodeType === 1 && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)
    || !!t.closest('[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]'));
  const finite = n => Number.isFinite(n) && n > 0;

  // ---------- Vídeos: volume lembrado, controles nativos (A) ----------
  const known = new Set();           // vídeos no DOM (podados quando saem; reinseridos voltam)
  const wired = new WeakSet();       // vídeos já preparados (listeners uma vez só, mesmo se reinseridos)
  const expected = new WeakMap();    // mudança feita pelo script, para não gravá-la como do usuário
  // Gesto do usuário no próprio vídeo (controles nativos) ou a tecla M do script: só a mudança de
  // volume/mudo até GESTURE_MS depois dele é gravada; o que o Instagram muda sozinho após um clique
  // em outro lugar não conta.
  const GESTURE_MS = 1000;
  let gesture = { v: null, t: -Infinity };
  const markGesture = v => { gesture = { v, t: performance.now() }; };
  const byUser = v => gesture.v === v && performance.now() - gesture.t <= GESTURE_MS;
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, e => {
      if (e.isTrusted && e.target instanceof HTMLVideoElement) markGesture(e.target);
    }, { capture: true, passive: true });
  }
  function setupVideo(v) {
    if (!known.has(v)) { known.add(v); if (P.barra) for (const o of observers) o.observe(v); }
    if (wired.has(v)) return;
    wired.add(v);
    v.setAttribute('data-us-ig-v', '');
    if (P.volume) {
      const s = get('som', null);
      if (s && typeof s === 'object') {
        const vol = typeof s.volume === 'number' && Number.isFinite(s.volume) ? Math.min(1, Math.max(0, s.volume)) : v.volume;
        const want = { volume: vol, muted: typeof s.mudo === 'boolean' ? s.mudo : v.muted };
        // Tirar o mudo sem gesto do usuário faz o navegador pausar o autoplay: só depois do 1º gesto.
        const u = navigator.userActivation;
        if (!want.muted && u && !u.hasBeenActive) want.muted = v.muted;
        if (v.volume !== want.volume || v.muted !== want.muted) {
          expected.set(v, want);
          v.volume = want.volume; v.muted = want.muted;
        }
      }
    }
    v.addEventListener('volumechange', () => {
      const e = expected.get(v);
      if (e && e.volume === v.volume && e.muted === v.muted) { expected.delete(v); return; }
      expected.delete(v);
      if (!P.volume || !byUser(v)) return;
      const cur = get('som', null);
      if (cur && typeof cur === 'object' && cur.volume === v.volume && cur.mudo === v.muted) return;
      set('som', { volume: v.volume, mudo: v.muted });
    });
    v.addEventListener('loadedmetadata', () => { touch(v, DOM); schedule(); });
  }

  const nativeOn = new WeakSet();    // vídeos cujo `controls` o script ligou (sobrevive à poda)
  const orig = new WeakMap();        // vídeo -> { pip, added: [tokens de controlsList acrescentados] }
  const marked = new Map();          // sobreposição recortada -> vídeo
  const TOKENS = ['nodownload', 'noremoteplayback', 'noplaybackrate'];
  const INTERACTIVE = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),a[href],button,[role="button"]';
  const limitOf = v => v.closest('article,[role="dialog"],main') || v.parentElement;
  const meets = (r, h) => r.width > 0 && r.height > 0 && r.right > h.left && r.left < h.right && r.bottom > h.top && r.top < h.bottom;
  function uncut(el) { el.removeAttribute('data-us-ig-cobre'); el.style.removeProperty('--us-ig-furo'); }
  function release(v) { for (const [el, owner] of marked) if (owner === v) { uncut(el); marked.delete(el); } }
  // Barra de progresso: controles nativos + furo na faixa inferior de cada camada que o Instagram põe por
  // cima do vídeo. As camadas são achadas pelo que está empilhado acima do vídeo na própria faixa
  // (elementsFromPoint), sem depender de classes.
  // Só escrita, sem ler geometria: controles nativos só nos vídeos na tela (fora dela não se vê, e
  // controles num vídeo tocando recalculam estilo a cada quadro).
  function nativeOnVideo(v) {
    if (!v.controls) { v.controls = true; nativeOn.add(v); }
    if (!orig.has(v)) {
      const added = [];
      try { for (const t of TOKENS) if (!v.controlsList.contains(t)) { v.controlsList.add(t); added.push(t); } } catch (_) {}
      orig.set(v, { pip: v.disablePictureInPicture, added });
      v.disablePictureInPicture = true;
    }
  }
  // Só leitura: decide o furo de um vídeo visível. Devolve null (sem furo) ou [[camada, polígono], …].
  // Leituras de todos os vídeos vêm antes de qualquer escrita (um layout por varredura, sem thrash).
  // Plano reaproveitado (sem elementsFromPoint) quando o vídeo só se moveu: mesmo tamanho, nenhuma
  // mutação no post desde o cálculo e as camadas ainda no lugar.
  // O plano vale só enquanto o vídeo continua na tela: ao sair, é descartado (mutação fora da tela não
  // é vista) e, sem caber, uma varredura DOM também o descarta.
  const plans = new WeakMap();       // vídeo -> { key, plan }
  // A faixa cabe: o fundo do vídeo na tela e ao menos BAND px dele visíveis acima do fundo.
  // Vídeo cortado pela borda inferior da tela: a faixa cairia no meio dele; sem furo até caber.
  const fits = (r, bottom) => r.width >= 40 && r.height >= 2 * BAND && r.bottom <= bottom && r.bottom - BAND >= Math.max(r.top, 0);
  function planBar(v, why) {
    const vr = v.getBoundingClientRect();
    if (!fits(vr, vh())) { if (why === DOM) plans.delete(v); return null; }
    const key = `${vr.width}x${vr.height}x${Math.max(vr.left, 0)}x${Math.min(vr.right, vw())}`;
    const c = plans.get(v);
    if (why === GEO && c && c.key === key && c.plan.every(p => p[0].isConnected && limitOf(v).contains(p[0]))) return c.plan;
    const plan = freshPlan(v, vr);
    plans.set(v, { key, plan: plan || [] });
    return plan;
  }
  function freshPlan(v, vr) {
    const bottom = vr.bottom;
    const full = { left: Math.max(vr.left, 0), right: Math.min(vr.right, vw()), top: bottom - BAND, bottom };
    const layers = new Set();
    for (const [el, owner] of marked) if (owner === v) layers.add(el);
    const limit = limitOf(v);
    for (const fy of [BAND / 2, 8]) for (const fx of [0.04, 0.25, 0.5, 0.75, 0.96]) {
      const x = full.left + (full.right - full.left) * fx, y = bottom - fy;
      const stack = document.elementsFromPoint(x, y);
      const i = stack.indexOf(v);
      if (i <= 0) continue;
      // Fora: modais por cima do vídeo (login, menus) e o que os contém — não são camadas do vídeo.
      // Camada do vídeo tem o tamanho dele: um véu de tela inteira (fundo de modal) fica de fora.
      const foreign = el => {
        const d = el.closest('[role="dialog"]');
        if ((d && !d.contains(v)) || el.querySelector('[role="dialog"]')) return true;
        const r = el.getBoundingClientRect();
        return r.width * r.height > 1.5 * vr.width * vr.height;
      };
      const above = stack.slice(0, i).filter(el => !el.contains(v) && el !== limit && limit.contains(el) && !foreign(el));
      for (const el of above) {
        // Só a camada mais externa que de fato recebe o toque (o recorte vale para os filhos).
        if (above.some(o => o !== el && o.contains(el))) continue;
        if (el.closest('nav,header,[role="navigation"]')) continue;
        layers.add(el);
      }
    }
    // Controles do Instagram dentro da faixa (campo de resposta do Story, música/legenda do Reel, botão de
    // som) continuam visíveis e tocáveis: o furo encolhe para o lado livre; sem lado largo o bastante,
    // nenhum furo neste vídeo. Alvos do tamanho do vídeo (camada de toque com role=button) não contam.
    const hole = Object.assign({}, full);
    const vArea = vr.width * vr.height;
    const blockers = [];
    for (const el of layers) {
      for (const c of [el, ...el.querySelectorAll(INTERACTIVE)]) {
        if (!c.matches(INTERACTIVE)) continue;
        const r = c.getBoundingClientRect();
        if (r.width * r.height > 0.5 * vArea || !meets(r, full)) continue;
        blockers.push(r);
      }
    }
    const GAP = 4, MIN = Math.max(80, 0.4 * (full.right - full.left));
    for (const r of blockers) {
      if (!meets(r, hole)) continue;
      const leftW = r.left - GAP - hole.left, rightW = hole.right - (r.right + GAP);
      if (leftW >= rightW) hole.right = r.left - GAP; else hole.left = r.right + GAP;
    }
    if (hole.right - hole.left < MIN || blockers.some(r => meets(r, hole))) return null;
    const plan = [];
    for (const el of layers) { const poly = polyFor(el, hole); if (poly) plan.push([el, poly]); }
    return plan;
  }
  // Só escrita: aplica o plano (camadas que saíram do plano perdem o recorte).
  function applyBar(v, plan) {
    if (!plan) { release(v); return; }
    const keep = new Set(plan.map(p => p[0]));
    for (const [el, owner] of marked) if (owner === v && !keep.has(el)) { uncut(el); marked.delete(el); }
    for (const [el, poly] of plan) {
      if (el.style.getPropertyValue('--us-ig-furo') !== poly) el.style.setProperty('--us-ig-furo', poly);
      if (!el.hasAttribute('data-us-ig-cobre')) el.setAttribute('data-us-ig-cobre', '');
      marked.set(el, v);
    }
  }
  function polyFor(el, hole) {
    const r = el.getBoundingClientRect();
    const W = r.width, H = r.height;
    if (!W || !H) return null;
    const L = hole.left - r.left, R = hole.right - r.left, T = hole.top - r.top, B = hole.bottom - r.top;
    const px = n => `${Math.round(n * 10) / 10}px`;
    // Polígono com furo (ponte de área zero): só a faixa inferior do vídeo sai da camada,
    // para a barra nativa ficar visível e receber clique/arrasto; o resto continua do Instagram.
    // Coordenadas relativas à camada: rolar (vídeo e camada juntos) não muda o polígono.
    return `polygon(evenodd, 0 0, ${px(W)} 0, ${px(W)} ${px(H)}, 0 ${px(H)}, 0 0, ${px(L)} ${px(T)}, ${px(L)} ${px(B)}, ${px(R)} ${px(B)}, ${px(R)} ${px(T)}, ${px(L)} ${px(T)})`;
  }
  // Devolve controls, PiP e controlsList ao original (vídeo que saiu da tela ou barra desligada).
  function nativeOff(v) {
    if (nativeOn.has(v)) { nativeOn.delete(v); v.controls = false; }
    const o = orig.get(v);
    if (!o) return;
    orig.delete(v);
    v.disablePictureInPicture = o.pip;
    try { for (const t of o.added) v.controlsList.remove(t); } catch (_) {}
  }
  function undoBar() {
    // Vídeos conhecidos e os do DOM agora (um reinserido pode ainda não ter passado pela varredura).
    for (const v of new Set([...known, ...document.querySelectorAll('video')])) nativeOff(v);
    for (const el of marked.keys()) uncut(el);
    marked.clear();
  }

  // Quais vídeos estão na tela, sem ler geometria na rolagem: IntersectionObserver. `seen` avisa quando
  // o vídeo entra/sai da tela; dois observadores de borda avisam, no exato momento, quando a faixa passa
  // a caber ou deixa de caber, também em vídeo mais alto que a tela ou que entra por cima (que nunca
  // chegam a 100% visíveis): `bottomIn` (raiz estendida para cima e para os lados, razão 1 ⇔ o fundo do
  // vídeo está na tela) e `bandIn` (raiz sem os BAND px do topo; deixa de cruzar ⇔ a faixa saiu pelo
  // topo). A decisão usa a geometria que a própria entrada traz (sem layout forçado). Faixa que deixa
  // de caber perde o furo na hora; a que passa a caber é recalculada (GEO, plano em cache se houver).
  // O recorte é relativo à camada, então rolar sem mudar nada não exige recalcular: só o vídeo cuja
  // faixa mudou, o que teve mutação dentro do seu post e, uma vez, os visíveis quando a rolagem para
  // (camada trocada só por atributo).
  const visible = new Set();         // vídeos que cruzam a tela agora
  const dirty = new Map();           // vídeo visível -> GEO (só moveu) | DOM (recalcular tudo)
  const fitNow = new WeakMap();      // vídeo visível -> a faixa cabia na última entrada de um observador
  const GEO = 1, DOM = 2;
  const touch = (v, why) => { if ((dirty.get(v) || 0) < why) dirty.set(v, why); };
  function edge(v, r) {
    const f = fits(r, vh());
    if (f && !fitNow.get(v)) touch(v, GEO);
    if (!f) release(v);
    fitNow.set(v, f);
  }
  const seen = new IntersectionObserver(es => {
    for (const e of es) {
      const v = e.target;
      if (e.isIntersecting && v.isConnected) {
        if (!visible.has(v)) { visible.add(v); fitNow.delete(v); touch(v, GEO); if (P.barra) nativeOnVideo(v); }
        edge(v, e.boundingClientRect);
      } else { visible.delete(v); dirty.delete(v); fitNow.delete(v); plans.delete(v); release(v); nativeOff(v); }
    }
    if (P.barra && dirty.size) schedule();
  }, { threshold: 0 });
  const onEdge = es => {
    for (const e of es) if (visible.has(e.target) && e.target.isConnected) edge(e.target, e.boundingClientRect);
    if (P.barra && dirty.size) schedule();
  };
  const FAR = 100000;
  const bottomIn = new IntersectionObserver(onEdge, { rootMargin: `${FAR}px ${FAR}px 0px ${FAR}px`, threshold: 1 });
  const bandIn = new IntersectionObserver(onEdge, { rootMargin: `-${BAND}px ${FAR}px ${FAR}px ${FAR}px`, threshold: 0 });
  const observers = [seen, bottomIn, bandIn];
  // Só a barra usa os observadores (volume e atalhos não): desligada, ninguém observa e o estado de tela é zerado.
  function watchVideos(on) {
    for (const v of known) for (const o of observers) on ? o.observe(v) : o.unobserve(v);
    if (!on) { visible.clear(); dirty.clear(); }
  }
  const touchAll = () => { for (const v of visible) touch(v, DOM); };
  const SCROLL_REST = 200;
  let restTimer = 0;
  function swallow(e) { e.preventDefault(); e.stopImmediatePropagation(); }
  // Repouso da rolagem: sempre rearmado (um salto por scrollTo pode chegar antes do observador marcar
  // os vídeos que entraram); quem estiver na tela quando o tempo vence é recalculado por inteiro.
  window.addEventListener('scroll', () => {
    if (!P.barra) return;
    clearTimeout(restTimer);
    restTimer = setTimeout(() => { restTimer = 0; if (visible.size) { touchAll(); schedule(); } }, SCROLL_REST);
  }, { capture: true, passive: true });
  window.addEventListener('resize', () => { touchAll(); schedule(); }, { passive: true });

  // ---------- Atalhos (sem UI) ----------
  window.addEventListener('keydown', e => {
    if (!P.atalhos || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if (isEditable(e.target) || isEditable(document.activeElement)) return;
    const k = e.key;
    if (!['ArrowLeft', 'ArrowRight', ',', '.', 'm', 'M'].includes(k)) return;
    const v = activeVideo();
    if (!v) return;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const d = k === 'ArrowRight' ? STEP : -STEP;
      const max = finite(v.duration) ? v.duration : Infinity;
      v.currentTime = Math.max(0, Math.min(max, v.currentTime + d));
    } else if (k === ',' || k === '.') {
      const r = Math.round((v.playbackRate + (k === '.' ? 0.25 : -0.25)) * 4) / 4;
      v.playbackRate = Math.max(0.25, Math.min(3, r));
    } else {
      markGesture(v);
      v.muted = !v.muted;
    }
    swallow(e);
  }, true);

  // ---------- Limpeza (só marca e oculta por CSS; nunca clica) ----------
  const RX = {
    patrocinado: /^(patrocinado|sponsored)$/i,
    sugestao: /^(sugest(ões|oes) para voc(ê|e)|sugerid[oa]s? para voc(ê|e)|suggested for you|publica(ções|coes) sugeridas|suggested posts)$/i,
    app: /^(abrir (o )?(app|aplicativo)|abrir no (app|aplicativo)|usar o (app|aplicativo)|obter (o )?(app|aplicativo)|open app|open in app|open the app|use the app|get the app)$/i,
  };
  // Primeira letra possível de qualquer rótulo de RX (filtro barato antes do regex e do DOM): p(atrocinado,
  // ublicações), s(ponsored, ugest-, uggested), a(brir), o(bter, pen), u(sar), g(et).
  // Rótulo novo em RX com outra inicial: acrescente a letra aqui.
  const FIRST = /^[psaoug]/i;
  const blocked = el => el.matches('main,body,html,nav,header,[role="dialog"]');
  // Item do feed: o <article> que contém o texto; senão o maior ancestral que ainda começa pelo
  // título ("Sugestões para você…") e não contém post, vídeo, diálogo nem main.
  function itemOf(el, t) {
    const art = el.closest('article');
    if (art) return art;
    let best = null, cur = el.parentElement;
    for (let i = 0; cur && i < 10; i++, cur = cur.parentElement) {
      if (blocked(cur) || cur.querySelector('article,video,main,[role="dialog"]')) break;
      if (!(cur.textContent || '').trim().startsWith(t)) break;
      best = cur;
    }
    return best;
  }
  function fixedAncestor(el) {
    for (let cur = el, i = 0; cur && i < 8; cur = cur.parentElement, i++) {
      if (cur.matches('main,body,html,nav,[role="dialog"]')) return null; // cabeçalho fixo vale (só o botão sai)
      const p = getComputedStyle(cur).position;
      if (p === 'fixed' || p === 'sticky') return cur;
    }
    return null;
  }
  // Banner do app: a faixa fixa inteira; se a faixa for o cabeçalho (tem outros links, ex.: "Entrar"),
  // só o botão do app.
  function appTarget(el) {
    const bar = fixedAncestor(el);
    if (!bar) return null;
    const btn = el.closest('a,button,[role="button"]') || el;
    const others = [...bar.querySelectorAll('a,button,[role="button"]')].filter(b => b !== btn && !btn.contains(b) && !b.contains(btn));
    return others.length ? btn : bar;
  }
  // Rótulo de patrocinado vale só no cabeçalho do post (perto do autor): num <header> do article ou antes
  // da mídia (1º vídeo ou 2ª imagem; a 1ª costuma ser o avatar). Na legenda, depois da mídia, não vale.
  function sponsoredArticle(el) {
    const art = el.closest('article');
    if (!art) return null;
    const h = el.closest('header');
    if (h && art.contains(h)) return art;
    const before = m => !!m && !!(el.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING);
    const imgs = art.querySelectorAll('img');
    return before(art.querySelector('video')) || before(imgs[1]) ? art : null;
  }
  function markText(textNode) {
    const raw = textNode.nodeValue;
    if (!raw || raw.length > 200) return;
    const t = raw.trim();
    if (t.length < 3 || t.length > 40 || !FIRST.test(t)) return;
    const el = textNode.parentElement;
    if (!el || el.closest('[data-us-ig-oculto]')) return;
    let kind = null;
    for (const k of Object.keys(RX)) if (RX[k].test(t)) { kind = k; break; }
    if (!kind) return;
    if (isEditable(el)) return;
    // Patrocinado só no <article> do post; fora dele (ex.: Reels em rolagem) nada é ocultado.
    const target = kind === 'app' ? appTarget(el) : kind === 'patrocinado' ? sponsoredArticle(el) : itemOf(el, t);
    // Nada dentro de um diálogo (post aberto, Story) é ocultado.
    if (target && !blocked(target) && !target.closest('[role="dialog"]')) target.setAttribute('data-us-ig-oculto', kind);
  }
  function scanText(root) {
    if (root.nodeType === 3) { markText(root); return; }
    if (root.nodeType !== 1 || /^(SCRIPT|STYLE|VIDEO)$/.test(root.tagName)) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) markText(n);
  }
  // Reavalia uma marca (conteúdo reciclado): tira e procura de novo dentro dela.
  function revalidate(el) { el.removeAttribute('data-us-ig-oculto'); scanText(el); }
  const markedAncestor = n => { const e = n.nodeType === 1 ? n : n.parentElement; return e && e.closest('[data-us-ig-oculto]'); };

  // ---------- "Abrir direto em Seguindo" (desligado por padrão) ----------
  // Guarda contra laço (o Instagram tirando o `variant` de volta): um redirecionamento por aba a cada
  // FOLLOW_MS (sessionStorage) e nenhum quando a página anterior foi a que o próprio script abriu.
  const FOLLOW_KEY = 'us-ig-seguindo', FOLLOW_MS = 10000;
  function maybeFollowing(prev) {
    if (!P.seguindo || location.pathname !== '/') return;
    const q = new URLSearchParams(location.search);
    if (q.has('variant')) return;
    let last = null;
    try { last = JSON.parse(sessionStorage.getItem(FOLLOW_KEY) || 'null'); } catch (_) {}
    if (last && typeof last === 'object') {
      if (Math.abs(Date.now() - Number(last.t)) < FOLLOW_MS) return;
      if (prev && prev === last.url) return;
    }
    q.set('variant', 'following');
    const url = location.origin + '/?' + q.toString() + location.hash;
    try { sessionStorage.setItem(FOLLOW_KEY, JSON.stringify({ t: Date.now(), url })); } catch (_) {}
    location.replace(url);
  }

  // ---------- Varredura com debounce (MutationObserver; sem polling) ----------
  // Debounce: 100 ms depois da última mudança, mas no máximo MAX_WAIT depois da primeira (rolagem ou
  // mutações contínuas não adiam a varredura para sempre).
  const pending = new Set(), touched = new Set();
  const QUIET = 100, MAX_WAIT = 500;
  let timer = 0, sched = 0, first = 0, fullScan = true, lastUrl = location.href;
  // Varredura num momento ocioso (fora do quadro em que a página rola), com teto de espera de 50 ms:
  // na rolagem contínua quase nunca sobra ócio, e um teto maior atrasaria a limpeza e o furo visíveis.
  const idle = typeof requestIdleCallback === 'function'
    ? f => requestIdleCallback(f, { timeout: 50 }) : f => requestAnimationFrame(f);
  function schedule() {
    if (sched) return;               // a varredura já está agendada e verá esta mudança
    const now = performance.now();
    if (!first) first = now;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = 0; first = 0; sched = idle(() => { sched = 0; scan(); }); },
      Math.max(0, Math.min(QUIET, first + MAX_WAIT - now)));
  }
  function onUrl() {
    if (location.href === lastUrl) return;
    const prev = lastUrl;
    lastUrl = location.href;
    maybeFollowing(prev);
    fullScan = true;
    touchAll();
    schedule();
  }
  // Nós pendentes sem os que já estão dentro de outro pendente (o percurso do ancestral os cobre).
  function outermost(nodes) {
    const out = [];
    for (const n of nodes) {
      if (!n.isConnected) continue;
      let p = n.parentNode, inside = false;
      for (; p; p = p.parentNode) if (nodes.has(p)) { inside = true; break; }
      if (!inside) out.push(n);
    }
    return out;
  }
  function scan() {
    if (location.href !== lastUrl) onUrl();
    applyRootFlags();
    attachStyle();
    for (const v of known) if (!v.isConnected) { known.delete(v); for (const o of observers) o.unobserve(v); visible.delete(v); dirty.delete(v); }
    // Camada sem o seu vídeo (removido ou reciclado para outro post): desfaz o recorte.
    for (const [el, v] of marked) {
      if (!el.isConnected) marked.delete(el);
      else if (!v.isConnected || !limitOf(v).contains(el)) { uncut(el); marked.delete(el); }
    }
    const vids = document.querySelectorAll('video');
    for (const v of vids) setupVideo(v);
    if (P.barra) {
      const todo = [...dirty].filter(([v]) => visible.has(v) && v.isConnected);
      dirty.clear();
      const out = todo.map(([v, why]) => [v, planBar(v, why)]); // todas as leituras…
      for (const [v, plan] of out) applyBar(v, plan);           // …depois todas as escritas
      for (const v of visible) if (v.isConnected) nativeOnVideo(v);
    } else dirty.clear();
    if (fullScan) {
      fullScan = false; pending.clear(); touched.clear();
      for (const el of document.querySelectorAll('[data-us-ig-oculto]')) el.removeAttribute('data-us-ig-oculto');
      if (document.body) scanText(document.body);
    } else {
      // Toda marca que contém um nó mudado é reavaliada (também a que está dentro de outro pendente,
      // que o percurso do ancestral pularia); o texto novo é percorrido só a partir dos mais externos.
      const marks = new Set();
      for (const set of [touched, pending]) for (const n of set) if (n.isConnected) { const m = markedAncestor(n); if (m) marks.add(m); }
      const outs = outermost(pending);
      pending.clear(); touched.clear();
      for (const m of marks) revalidate(m);
      for (const n of outs) scanText(n);
    }
  }
  // Mutação dentro do post de um vídeo visível (camada nova, botão na faixa): recalcula aquele vídeo.
  const limits = new Map();
  // (Lote novo acrescentado ao feed, fora do post, não conta.)
  function touchVideos(r) {
    for (const v of visible) {
      if (dirty.get(v) === DOM) continue;
      let l = limits.get(v);
      if (!l || !l.isConnected || !l.contains(v)) { l = limitOf(v); limits.set(v, l); }
      if (l && l.contains(r.target)) touch(v, DOM);
    }
  }
  const mo = new MutationObserver(recs => {
    const geo = P.barra && visible.size;
    for (const r of recs) {
      if (r.type === 'characterData') pending.add(r.target);
      else {
        for (const n of r.addedNodes) if (n !== style) pending.add(n);
        if (r.removedNodes.length) touched.add(r.target);
      }
      if (geo) touchVideos(r);
    }
    if (limits.size > 32) limits.clear();
    schedule();
  });
  function start() {
    if (!document.documentElement) {
      new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); start(); } }).observe(document, { childList: true });
      return;
    }
    applyRootFlags();
    attachStyle();
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    schedule();
  }

  // SPA: navegação sem recarregar. Navigation API (vale também no mundo isolado do gerenciador),
  // popstate e, quando o script roda no contexto da página, o próprio history.pushState.
  window.addEventListener('popstate', onUrl);
  try { if (window.navigation) window.navigation.addEventListener('currententrychange', onUrl); } catch (_) {}
  for (const m of ['pushState', 'replaceState']) {
    try {
      const origFn = history[m];
      history[m] = function (...a) { const r = origFn.apply(this, a); onUrl(); return r; };
    } catch (_) {}
  }
  document.addEventListener('DOMContentLoaded', () => { attachStyle(); fullScan = true; schedule(); });

  maybeFollowing();
  start();

  // ---------- Menu do gerenciador ----------
  const ITEMS = [
    { k: 'barra', label: 'Barra de progresso nos vídeos' },
    { k: 'atalhos', label: 'Atalhos: ←/→ 5 s · , . velocidade · M mudo' },
    { k: 'volume', label: 'Lembrar volume e mudo' },
    { k: 'sugestoes', label: 'Ocultar "Sugestões para você"' },
    { k: 'patrocinados', label: 'Ocultar patrocinados' },
    { k: 'app', label: 'Ocultar banner "abrir no app"' },
    { k: 'seguindo', label: 'Abrir direto em Seguindo' },
  ];
  function applyAll() {
    applyRootFlags();
    watchVideos(!!P.barra);
    if (!P.barra) undoBar();
    touchAll();
    fullScan = true;
    schedule();
  }
  // Re-registra para trocar ✓/✗: antes, tira os itens anteriores pelo id que o gerenciador devolveu
  // (Violentmonkey identifica pelo texto, que muda; Tampermonkey também aceita o `id` das opções).
  let menuIds = [];
  function menu() {
    try {
      if (typeof GM_unregisterMenuCommand === 'function') for (const id of menuIds) { try { GM_unregisterMenuCommand(id); } catch (_) {} }
      menuIds = [];
      for (const it of ITEMS) {
        const on = !!P[it.k];
        menuIds.push(GM_registerMenuCommand(`${on ? '✓' : '✗'} ${it.label}`, () => {
          save({ [it.k]: !P[it.k] });
          applyAll();
          if (it.k === 'seguindo') maybeFollowing();
          menu();
        }, { id: 'us-ig-' + it.k, autoClose: false }));
      }
    } catch (_) {}
  }
  menu();
})();
