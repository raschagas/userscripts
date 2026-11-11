// ==UserScript==
// @name         Cookies — aceitar e fechar o aviso
// @namespace    raschagas/userscripts
// @version      1.0.0
// @description  Aceita banners de cookies (OneTrust, Cookiebot, Didomi, Quantcast, Usercentrics, TrustArc, CookieYes, Complianz, Adopt e avisos genéricos que falem de cookies) e some com eles. Para de procurar após 15 s. Em iframes, só as plataformas conhecidas.
// @match        *://*/*
// @exclude      *://sso.acesso.gov.br/*
// @exclude      *://*.camara.leg.br/*
// @exclude      *://camara.leg.br/*
// @exclude      *://*.camara.gov.br/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/raschagas/userscripts/main/src/cookies-aceitar.user.js
// @updateURL    https://raw.githubusercontent.com/raschagas/userscripts/main/src/cookies-aceitar.user.js
// ==/UserScript==

(() => {
  'use strict';
  const get = (k, d) => { try { return GM_getValue(k, d); } catch (_) { return d; } };
  const set = (k, v) => { try { GM_setValue(k, v); } catch (_) {} };
  const host = location.hostname, top = window.top === window;
  // Em iframe, vale a decisão tomada para o site de cima (quando o navegador informa qual é).
  const topHost = (() => { if (top) return host; try { const a = location.ancestorOrigins; return a && a.length ? new URL(a[a.length - 1]).hostname : ''; } catch (_) { return ''; } })();
  const off = (get('desligado', '') || '').split(',').filter(Boolean);
  if (off.includes(host) || (topHost && off.includes(topHost))) return;
  const DEBUG = !!get('debug', false);

  // 1) Plataformas de consentimento conhecidas: botão "aceitar tudo" por seletor estável (também em iframes).
  const CMP = [
    '#onetrust-accept-btn-handler',                                   // OneTrust
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#CybotCookiebotDialogBodyButtonAccept', // Cookiebot
    '#didomi-notice-agree-button',                                    // Didomi
    '.qc-cmp2-summary-buttons button[mode="primary"]',                // Quantcast
    '#truste-consent-button', '.trustarc-agree-btn',                  // TrustArc
    '.cky-btn-accept', '#cookie_action_close_header',                 // CookieYes
    '.cmplz-btn.cmplz-accept',                                        // Complianz
    '#adopt-accept-all-button', 'button[data-adopt="accept"]',        // Adopt (comum no Brasil)
    '.br-cookiebar .btn-accept', '.br-cookiebar .br-button.primary',  // gov.br Design System
    '.cc-window .cc-btn.cc-allow', '.cc-window .cc-btn.cc-dismiss',   // Osano / cookieconsent
    'button[data-testid="uc-accept-all-button"]',                     // Usercentrics (fora do shadow)
    '[data-cookiefirst-action="accept"]', '.iubenda-cs-accept-btn', '#termly-code-snippet-support .t-acceptAllButton',
  ];
  // 2) Ids genéricos de "aceitar cookies": só no frame do topo e dentro de contêiner que fale de cookie.
  const GENERIC_IDS = ['#cookie-consent-accept', '#accept-cookies', '#acceptCookies', '.js-accept-cookies'];
  // 3) Texto. Frases que dizem "cookie(s)" bastam dentro de um aviso que fale de cookie.
  //    "Aceitar tudo"/"Permitir todos" e afins podem ser termos de uso ou permissões: exigem
  //    contêiner nomeado por cookie/consent ou de plataforma conhecida. Respostas vagas ("OK",
  //    "Entendi", "Prosseguir") exigem contêiner com "cookie" no id/classe. "Fechar" nunca: um X
  //    de fechar pode recusar.
  const STRICT = /^(aceitar todos os cookies|aceitar cookies|aceito os cookies|permitir todos os cookies|accept all cookies|accept cookies|allow all cookies)$/i;
  const ALL = /^(aceitar tudo|aceitar todos|permitir todos|accept all|allow all)$/i;
  const LOOSE = /^(aceitar|aceito|concordo|entendi|ok|ok, entendi|prosseguir|accept|agree|i agree|got it)$/i;
  const CMPNAME = /onetrust|cybotcookiebot|didomi|qc-cmp|truste|trustarc|cky-|cmplz|adopt|usercentrics|iubenda|termly|cookiefirst|cc-window|br-cookiebar/i;
  const COOKIE = /cookie/i;
  const BOXNAME = /cookie|consent/i;

  let done = false;
  // offsetParent é null dentro de caixas position:fixed; use as caixas de layout.
  const clickable = e => e && !e.disabled && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const idClass = e => (e.id || '') + ' ' + (typeof e.className === 'string' ? e.className : (e.getAttribute && e.getAttribute('class')) || '');
  const shortText = e => { const t = e.innerText || ''; return t.length <= 600 ? t : ''; };
  const mentionsCookie = e => COOKIE.test(idClass(e)) || COOKIE.test(shortText(e));
  // Campos que denunciam login, pagamento ou cadastro: o contêiner não é um aviso de cookies.
  const SENSITIVE = 'input[type="password"], input[autocomplete^="cc-"], input[name*="cpf" i], input[id*="cpf" i], input[name*="card" i], input[name*="cartao" i], input[name*="cartão" i], ' +
    'input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="search"]';

  function shadowFind(sel) { // Usercentrics e afins renderizam em shadow DOM aberto
    for (const h of document.querySelectorAll('#usercentrics-root, aside[id*="usercentrics"], [id*="cmp"][id*="root"]')) {
      const b = h.shadowRoot && h.shadowRoot.querySelector(sel); if (b) return b;
    }
  }
  // Nunca: botão de envio, nada em formulário ou diálogo modal que não seja de cookies.
  function forbidden(b) {
    if (b.matches('input[type="submit"]')) return true;
    if (b.matches('button[type="submit"]') && !cookieNamed(b)) return true;
    const f = b.closest('form'); if (f && !COOKIE.test(idClass(f))) return true;
    const d = b.closest('[role="dialog"][aria-modal="true"], dialog[open]');
    if (d && !(COOKIE.test(idClass(d)) || COOKIE.test((d.innerText || '').slice(0, 2000)))) return true;
    return false;
  }
  // Aviso: ancestral fixo/flutuante ou com nome de cookie/consent, que mencione cookie
  // (id/classe ou texto curto). Começa no pai: o próprio botão pode ter "cookie" na classe.
  function banner(b) {
    for (let e = b.parentElement, i = 0; e && e !== document.body && e !== document.documentElement && i < 10; e = e.parentElement, i++) {
      const p = getComputedStyle(e).position;
      if ((p === 'fixed' || p === 'sticky' || BOXNAME.test(idClass(e))) && mentionsCookie(e)) return e;
    }
    return null;
  }
  // Algum ancestral próximo (até 10 níveis, sem contar o botão) tem "cookie" no id/classe.
  function cookieNamed(b) {
    for (let e = b.parentElement, i = 0; e && e !== document.body && i < 10; e = e.parentElement, i++) if (COOKIE.test(idClass(e))) return true;
    return false;
  }
  // Idem, aceitando também "consent" ou o nome de uma plataforma de consentimento conhecida.
  function consentNamed(b) {
    for (let e = b.parentElement, i = 0; e && e !== document.body && i < 10; e = e.parentElement, i++) { const n = idClass(e); if (BOXNAME.test(n) || CMPNAME.test(n)) return true; }
    return false;
  }
  const safeIn = box => !box.querySelector(SENSITIVE);
  function firstVisible(sel, needBanner) {
    let list; try { list = document.querySelectorAll(sel); } catch (_) { return null; }
    for (const b of list) {
      if (!clickable(b) || forbidden(b)) continue;
      if (needBanner) { const box = banner(b); if (!box || !safeIn(box)) continue; }
      return b;
    }
    return null;
  }
  function attempt() {
    if (done) return true;
    for (const s of CMP) { const b = firstVisible(s, false); if (b) return finish(b, 'cmp:' + s); }
    const ub = shadowFind('button[data-testid="uc-accept-all-button"]'); if (ub) return finish(ub, 'usercentrics');
    if (!top) return false; // em iframe, só plataformas conhecidas
    for (const s of GENERIC_IDS) { const b = firstVisible(s, true); if (b) return finish(b, 'id:' + s); }
    for (const b of document.querySelectorAll('button, a[role="button"], [role="button"], input[type="button"], a')) {
      const t = (b.innerText || b.value || '').trim().replace(/\s+/g, ' ');
      if (!t || t.length > 40) continue;
      const kind = STRICT.test(t) ? 'cookie' : ALL.test(t) ? 'all' : LOOSE.test(t) ? 'loose' : '';
      if (!kind) continue;
      if (!clickable(b) || forbidden(b)) continue;
      const box = banner(b);
      if (!box || !safeIn(box)) continue;
      if (kind === 'all' && !consentNamed(b)) continue;
      if (kind === 'loose' && !cookieNamed(b)) continue;
      return finish(b, 'texto:' + t);
    }
    return false;
  }
  // Diagnóstico (só com a chave `debug` ligada): marca no <html> qual regra clicou.
  function finish(b, how) { b.click(); done = true; if (DEBUG) document.documentElement.dataset.usCookies = how; return true; }

  if (!attempt()) {
    // Mutações agendam uma tentativa (no máximo uma a cada 250 ms); após 15 s, para de vez.
    let pending = 0, stopped = false;
    const stop = () => { stopped = true; obs.disconnect(); clearTimeout(pending); };
    const obs = new MutationObserver(() => {
      if (pending || stopped) return;
      pending = setTimeout(() => { pending = 0; if (!stopped && attempt()) stop(); }, 250);
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { if (!stopped && attempt()) stop(); }, 1200);
    setTimeout(stop, 15000);
  }
  if (top) try {
    GM_registerMenuCommand('Não mexer nos cookies deste site', () => {
      const l = (get('desligado', '') || '').split(',').filter(Boolean); l.push(host); set('desligado', [...new Set(l)].join(','));
    });
  } catch (_) {}
})();
