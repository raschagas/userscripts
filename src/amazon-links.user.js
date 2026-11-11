// ==UserScript==
// @name         Amazon — link limpo e Keepa
// @namespace    raschagas/userscripts
// @version      1.0.0
// @description  Oferece link do produto sem parâmetros e consulta ao Keepa somente por clique.
// @match        https://www.amazon.com.br/*
// @match        https://amazon.com.br/*
// @noframes
// @run-at       document-end
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/raschagas/userscripts/main/src/amazon-links.user.js
// @updateURL    https://raw.githubusercontent.com/raschagas/userscripts/main/src/amazon-links.user.js
// ==/UserScript==

// Implementação original; não incorpora código de terceiros.
(() => {
  'use strict';

  if (!['www.amazon.com.br','amazon.com.br'].includes(location.hostname)) return;
  function update() {
    const match = location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i);
    let box = document.getElementById('us-amazon-links');
    if (!match) { if (box) box.remove(); return; }
    if (!document.body) return;
    if (!box) {
      box = document.createElement('aside'); box.id = 'us-amazon-links';
      box.setAttribute('aria-label','Links do produto');
      box.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:2147483646;display:flex;gap:8px;padding:8px;background:#fff;color:#111;border:1px solid #777;border-radius:12px;font:14px system-ui';
      for (const text of ['Link limpo','Keepa']) {
        const a = document.createElement('a'); a.textContent = text; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.referrerPolicy = 'no-referrer';
        a.style.cssText = 'display:inline-flex;align-items:center;min-height:44px;padding:0 8px;color:#0645ad'; box.append(a);
      }
      document.body.append(box);
    }
    const asin = match[1].toUpperCase();
    const urls = ['https://www.amazon.com.br/dp/' + asin, 'https://keepa.com/#!product/12-' + asin];
    [...box.children].forEach((a,i) => { if (a.href !== urls[i]) a.href = urls[i]; });
  }
  let pending = false;
  const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; update(); }); } };
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  addEventListener('popstate',schedule);
  // pushState does not emit popstate; compare only the URL between DOM updates.
  let lastURL = location.href;
  setInterval(() => { if (location.href !== lastURL) { lastURL = location.href; schedule(); } }, 500);
  schedule();
})();
