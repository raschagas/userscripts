// ==UserScript==
// @name         Google — links diretos e Web opcional
// @namespace    raschagas/userscripts
// @version      1.0.0
// @description  Preserva respostas por IA; oferece Web no menu e limpa links de resultados.
// @match        https://www.google.com/*
// @match        https://www.google.com.br/*
// @match        https://google.com/*
// @match        https://google.com.br/*
// @noframes
// @run-at       document-end
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/raschagas/userscripts/main/src/google-clean.user.js
// @updateURL    https://raw.githubusercontent.com/raschagas/userscripts/main/src/google-clean.user.js
// ==/UserScript==

// Implementação original; não incorpora código de terceiros.
(() => {
  'use strict';

  const hosts = new Set(['www.google.com','www.google.com.br','google.com','google.com.br']);
  if (!hosts.has(location.hostname)) return;
  GM_registerMenuCommand('Abrir esta pesquisa na aba Web', () => {
    if (location.pathname !== '/search') return;
    const url = new URL(location.href); url.searchParams.set('udm','14'); location.assign(url.href);
  });
  function clean() {
    if (location.pathname !== '/search') return;
    for (const a of document.querySelectorAll('a[href]')) {
      try {
        const url = new URL(a.href);
        if (!hosts.has(url.hostname) || url.pathname !== '/url') continue;
        const target = new URL(url.searchParams.get('q') || url.searchParams.get('url') || '');
        if (!['http:','https:'].includes(target.protocol)) continue;
        a.href = target.href; a.removeAttribute('ping');
      } catch (_) {}
    }
  }
  let pending = false;
  const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; clean(); }); } };
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['href']});
  addEventListener('popstate',schedule); schedule();
})();
