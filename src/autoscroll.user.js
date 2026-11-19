// ==UserScript==
// @name         Autoscroll — rolagem automática pelo teclado
// @namespace    raschagas/userscripts
// @version      1.0.0
// @description  Rolagem automática como no Adobe Reader e no SumatraPDF: Ctrl+Shift+H liga, Esc para, setas mudam a velocidade (passando de zero inverte o sentido), Espaço pausa. Rola o bloco sob o mouse ou a página. Velocidade lembrada por site.
// @match        *://*/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/raschagas/userscripts/main/src/autoscroll.user.js
// @updateURL    https://raw.githubusercontent.com/raschagas/userscripts/main/src/autoscroll.user.js
// ==/UserScript==

(() => {
  'use strict';
  const get = (k, d) => { try { return GM_getValue(k, d); } catch (_) { return d; } };
  const set = (k, v) => { try { GM_setValue(k, v); } catch (_) {} };
  const host = location.hostname;
  const off = () => (get('desligado', '') || '').split(',').filter(Boolean);
  // Desligado neste site: os ouvintes continuam registrados, mas não fazem nada.
  let disabled = off().includes(host);

  // Velocidade em px/s; negativo = para cima. Passos crescem com a velocidade (como no SumatraPDF).
  const MAX = 3000, PADRAO = 60;
  let speed = Math.abs(Number((get('velocidades', {}) || {})[host])) || PADRAO;
  let running = false, paused = false, target = null, last = 0, acc = 0, stuckSince = 0, raf = 0;
  let prevPos = null;
  let mouseX = innerWidth / 2, mouseY = innerHeight / 2;

  const step = (v) => Math.max(5, Math.round(Math.abs(v) * 0.2 / 5) * 5);
  // Relê o mapa antes de gravar para não apagar o que outras abas gravaram; ao religar começa para baixo.
  const remember = () => {
    const m = get('velocidades', {}) || {};
    m[host] = Math.abs(speed);
    set('velocidades', m);
  };

  // ---- alvo: o bloco rolável sob o mouse, senão a página ----
  const page = () => document.scrollingElement || document.documentElement;
  const scrollable = (el) => {
    if (!(el instanceof Element)) return false;
    if (el === page()) return true;
    const oy = getComputedStyle(el).overflowY;
    if (!(oy === 'auto' || oy === 'scroll' || oy === 'overlay')) return false;
    // overflow do <body> só vale para ele quando o <html> não é visible (senão vai para a janela).
    if (el === document.body && getComputedStyle(document.documentElement).overflowY === 'visible') return false;
    return el.scrollHeight > el.clientHeight + 1;
  };
  const pickTarget = () => {
    let el = document.elementFromPoint(mouseX, mouseY);
    while (el && el !== document.documentElement) {
      if (el !== page() && scrollable(el)) return el;
      el = el.parentElement;
    }
    const p = page();
    if (p.scrollHeight > p.clientHeight + 1) return p;
    return scrollable(document.body) ? document.body : p;
  };
  const pos = () => (target === page() ? page().scrollTop : target.scrollTop);

  // ---- indicador: pílula discreta no canto, só enquanto ativo ----
  let hud = null, hudTimer = 0, hovering = false;
  const show = () => { if (hud) { hud.style.opacity = '1'; hud.style.pointerEvents = 'auto'; } };
  const ensureHud = () => {
    if (hud && hud.isConnected) return hud;
    hud = document.createElement('div');
    hud.setAttribute('data-us-autoscroll', '');
    hud.setAttribute('role', 'status');
    hud.setAttribute('aria-live', 'polite');
    hud.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;padding:6px 12px;border-radius:999px;'
      + 'font:600 13px/1.4 system-ui,"Segoe UI",sans-serif;background:rgba(20,20,24,.82);color:#fff;'
      + 'box-shadow:0 2px 8px rgba(0,0,0,.25);pointer-events:auto;user-select:none;transition:opacity .25s;opacity:1';
    hud.title = '↑/↓ velocidade · Shift+↑/↓ passo grande · ←/→ ÷2 ×2 · Espaço pausa · R/- inverte · Esc para';
    (document.body || document.documentElement).appendChild(hud);
    return hud;
  };
  // Esmaecida, a pílula deixa passar os cliques; volta quando o mouse chega perto (ver mousemove).
  const fade = () => {
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => {
      if (hud && !hovering) { hud.style.opacity = '0'; hud.style.pointerEvents = 'none'; }
    }, 1500);
  };
  const render = () => {
    if (!running) { clearTimeout(hudTimer); if (hud) hud.remove(); hud = null; hovering = false; return; }
    const h = ensureHud();
    const arrow = speed === 0 ? '■' : speed > 0 ? '▼' : '▲';
    h.textContent = (paused ? '❚❚ pausado · ' : '') + arrow + ' ' + Math.abs(Math.round(speed)) + ' px/s';
    show();
    fade();
  };

  // ---- laço ----
  const tick = (t) => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
    last = t;
    if (paused || speed === 0 || !target) { prevPos = null; return; }
    // Progresso medido entre quadros: a posição agora contra a do quadro anterior.
    if (prevPos !== null) {
      // Fim do conteúdo: espera 8 s (rolagem infinita carrega mais) e então para sozinho.
      if (pos() !== prevPos) stuckSince = 0;
      else if (!stuckSince) stuckSince = t;
      else if (t - stuckSince > 8000) { stop(); return; }
      prevPos = null;
    }
    acc += speed * dt;
    const whole = acc > 0 ? Math.floor(acc) : Math.ceil(acc);
    if (!whole) return;
    acc -= whole;
    prevPos = pos();
    // 'instant' ignora o scroll-behavior: smooth do site, para a posição andar a cada quadro.
    const opts = { top: whole, left: 0, behavior: 'instant' };
    if (target === page()) window.scrollBy(opts); else target.scrollBy(opts);
  };

  const start = () => {
    if (disabled) return;
    target = pickTarget();
    running = true; paused = false; last = 0; acc = 0; stuckSince = 0; prevPos = null;
    if (!speed) speed = PADRAO;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    render();
  };
  const stop = () => {
    if (!running) return;
    running = false; paused = false; prevPos = null;
    cancelAnimationFrame(raf);
    remember();
    render();
  };
  const toggle = () => (running ? stop() : start());
  const setSpeed = (v) => {
    speed = Math.max(-MAX, Math.min(MAX, Math.round(v)));
    stuckSince = 0;
    render();
  };

  // Foco real, inclusive dentro de shadow DOM (o activeElement do documento é só o host).
  const deepActive = () => {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  };
  const editable = (el) => !!el && el instanceof Element
    && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const typing = (e) => {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    return editable(path[0]) || editable(deepActive());
  };

  window.addEventListener('keydown', (e) => {
    if (disabled || e.isComposing) return;
    const k = e.key;
    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && (k === 'H' || k === 'h' || e.code === 'KeyH')) {
      if (off().includes(host)) { disabled = true; stop(); return; }
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) toggle();
      return;
    }
    if (!running || e.ctrlKey || e.altKey || e.metaKey) return;
    // Esc para mesmo com foco num campo; fora de rolagem ele segue para a página.
    if (k === 'Escape') { stop(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (typing(e)) return;
    let handled = true;
    const big = e.shiftKey ? 5 : 1;
    switch (k) {
      case 'ArrowDown': setSpeed(speed + step(speed) * big); break;
      case 'ArrowUp': setSpeed(speed - step(speed) * big); break;
      case 'ArrowRight': setSpeed(speed ? speed * 2 : PADRAO); break;
      case 'ArrowLeft': setSpeed(Math.trunc(speed / 2)); break;
      case ' ': if (!e.repeat) { paused = !paused; last = 0; render(); } break;
      case 'r': case 'R': case '-': if (!e.repeat) setSpeed(-speed); break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // Clique fora do indicador para a rolagem (como no Adobe); o mouse define o bloco na próxima ativação.
  window.addEventListener('mousedown', (e) => {
    if (!disabled && running && !(hud && hud.contains(e.target))) stop();
  }, true);
  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX; mouseY = e.clientY;
    if (disabled || !running || !hud) return;
    const r = hud.getBoundingClientRect(), m = 12;
    const near = mouseX >= r.left - m && mouseX <= r.right + m && mouseY >= r.top - m && mouseY <= r.bottom + m;
    if (near && !hovering) { hovering = true; clearTimeout(hudTimer); show(); }
    else if (!near && hovering) { hovering = false; fade(); }
  }, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    if (!disabled && document.hidden && running) { paused = true; render(); }
  });

  GM_registerMenuCommand('Ligar/parar rolagem automática (Ctrl+Shift+H)', () => toggle());
  if (disabled) {
    GM_registerMenuCommand('Ligar neste site', () => {
      set('desligado', off().filter((h) => h !== host).join(','));
      disabled = false;
    });
  } else {
    GM_registerMenuCommand('Desligar neste site', () => {
      stop();
      const l = off(); if (!l.includes(host)) l.push(host);
      set('desligado', l.join(','));
      disabled = true;
    });
  }
})();
