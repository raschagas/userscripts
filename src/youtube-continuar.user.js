// ==UserScript==
// @name         YouTube — continuar assistindo
// @namespace    raschagas/userscripts
// @version      1.0.0
// @description  Confirma somente o aviso de inatividade do YouTube.
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @noframes
// @run-at       document-end
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/raschagas/userscripts/main/src/youtube-continuar.user.js
// @updateURL    https://raw.githubusercontent.com/raschagas/userscripts/main/src/youtube-continuar.user.js
// ==/UserScript==

// Implementação original; não incorpora código de terceiros.
(() => {
  'use strict';

  if (!['www.youtube.com', 'm.youtube.com'].includes(location.hostname)) return;
  const seen = new WeakSet();
  function check() {
    for (const dialog of document.querySelectorAll('yt-confirm-dialog-renderer, ytm-confirm-dialog-renderer')) {
      if (!dialog.getClientRects().length || dialog.closest('[hidden], [aria-hidden="true"]')) continue;
      if (!/continue watching\?|continuar assistindo\?|ainda est[aá] assistindo\?/i.test(dialog.textContent)) continue;
      const button = dialog.querySelector('#confirm-button button, button#confirm-button, #confirm-button yt-button-shape button');
      if (button && !button.disabled && button.getClientRects().length && !seen.has(dialog)) {
        seen.add(dialog); button.click();
        setTimeout(() => seen.delete(dialog), 5000);
      }
    }
  }
  let pending = false;
  const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; check(); }); } };
  new MutationObserver(schedule).observe(document.documentElement, {childList:true, subtree:true, attributes:true, attributeFilter:['hidden','aria-hidden','style']});
  schedule();
})();
