// ==UserScript==
// @name         Reddit — idioma original
// @namespace    raschagas/userscripts
// @version      1.0.0
// @description  Remove tradução automática; old.reddit opcional no menu.
// @match        https://www.reddit.com/*
// @match        https://reddit.com/*
// @match        https://old.reddit.com/*
// @match        https://new.reddit.com/*
// @noframes
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/raschagas/userscripts/main/src/reddit-clean.user.js
// @updateURL    https://raw.githubusercontent.com/raschagas/userscripts/main/src/reddit-clean.user.js
// ==/UserScript==

// Implementação original; não incorpora código de terceiros.
(() => {
  'use strict';

  const hosts = new Set(['www.reddit.com','reddit.com','old.reddit.com','new.reddit.com']);
  if (!hosts.has(location.hostname)) return;
  let old = GM_getValue('old_reddit', false);
  GM_registerMenuCommand('Usar old.reddit: ' + (old ? 'ligado' : 'desligado'), () => {
    old = !old; GM_setValue('old_reddit', old); cleanLocation(); cleanLinks();
  });
  function clean(url) {
    if (!hosts.has(url.hostname) || !['http:','https:'].includes(url.protocol)) return url;
    url.searchParams.delete('tl');
    if (old && !/^\/(login|logout|register|account|settings|prefs|api)(\/|$)/.test(url.pathname)) url.hostname = 'old.reddit.com';
    return url;
  }
  let navigating = false;
  function cleanLocation() {
    if (navigating) return;
    const url = clean(new URL(location.href));
    if (url.href !== location.href) { navigating = true; location.replace(url.href); }
  }
  function cleanLinks() {
    for (const a of document.querySelectorAll('a[href]')) {
      try { const url = clean(new URL(a.href)); if (a.href !== url.href) a.href = url.href; } catch (_) {}
    }
  }
  let pending = false;
  const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; cleanLocation(); cleanLinks(); }); } };
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['href']});
  addEventListener('popstate', schedule);
  cleanLocation(); schedule();
})();
