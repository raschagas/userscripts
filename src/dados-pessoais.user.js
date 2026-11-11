// ==UserScript==
// @name         Dados pessoais — borrar na tela
// @namespace    raschagas/userscripts
// @version      1.0.0
// @description  Borra nomes, CPF, RG, telefones, e-mails, endereços, valores, contas, cartões e anexos sensíveis na tela. Começa desligado; Alt+Shift+P liga e desliga. Não altera a página: desenha o borrão por cima.
// @match        https://mail.google.com/*
// @match        https://contacts.google.com/*
// @match        https://outlook.live.com/*
// @match        https://outlook.office.com/*
// @match        https://outlook.office365.com/*
// @match        https://web.whatsapp.com/*
// @match        https://web.telegram.org/*
// @match        https://teams.microsoft.com/*
// @match        https://teams.cloud.microsoft/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/raschagas/userscripts/main/src/dados-pessoais.user.js
// @updateURL    https://raw.githubusercontent.com/raschagas/userscripts/main/src/dados-pessoais.user.js
// ==/UserScript==

(() => {
  'use strict';
  const get = (k, d) => { try { return GM_getValue(k, d); } catch (_) { return d; } };
  const set = (k, v) => { try { GM_setValue(k, v); } catch (_) {} };

  // ---------- detecção ----------
  const FIRST = 'Ana|Adriana|Alessandra|Alexandre|Aline|Amanda|André|Andréa?|Antônio|Antonio|Arthur|Beatriz|Bruna|Bruno|Caio|Camila|Carla|Carlos|Carolina|Cecília|Cláudia|Claudio|Cláudio|Cristiane|Daniel|Daniela|Davi|Débora|Diego|Douglas|Eduardo|Elaine|Fábio|Fabiana|Felipe|Fernanda|Fernando|Flávia|Francisco|Gabriel|Gabriela|Gustavo|Helena|Henrique|Igor|Isabela|Isabel|Jéssica|João|Jorge|José|Joana|Juliana|Júlia|Larissa|Laura|Leandro|Leonardo|Letícia|Lúcia|Lucas|Luciana|Luís|Luiz|Luiza|Marcela|Marcelo|Márcia|Marcos|Maria|Mariana|Marina|Mateus|Matheus|Maurício|Mônica|Natália|Patrícia|Paula|Paulo|Pedro|Priscila|Rafael|Rafaela|Raquel|Regina|Renata|Renato|Ricardo|Roberta|Roberto|Rodrigo|Rosa|Sandra|Sérgio|Silvia|Sílvia|Simone|Sofia|Tatiana|Thiago|Tiago|Vanessa|Vinícius|Vitor|Victor|Vitória';
  const UP = 'A-ZÁÉÍÓÚÂÊÔÃÕÇ', LO = 'a-záéíóúâêôãõç';
  const custom = String(get('nomes', '')).split(',').map(s => s.trim()).filter(Boolean)
    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const nameRx = new RegExp(`(?:\\b(?:Dra?|Sra?)\\.\\s)?\\b(?:${FIRST}${custom.length ? '|' + custom.join('|') : ''})(?:\\s(?:(?:d[aeo]s?|e)\\s)?[${UP}][${LO}]+){1,4}`, 'g');
  const RULES = [
    /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,                                   // e-mail
    /(?:\b|\*)[\d*]{3}\.[\d*]{3}\.[\d*]{3}-[\d*]{2}\b/g,                // CPF (inclusive mascarado)
    /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,                           // CNPJ
    /\b(?:\d{4}[ -]){3}\d{4}\b/g,                                      // cartão
    /(?:\(\d{2}\)\s?|\b\d{2}\s)9?\d{4}-\d{4}\b/g,                      // telefone
    /\b\d{5}-\d{3}\b/g,                                                // CEP
    /\b(?:RG|identidade)[:\s]*\d{1,2}\.?\d{3}\.?\d{3}(?:-[\dxX])?(?:\s?SSP\/[A-Z]{2})?|\b\d{1,2}\.\d{3}\.\d{3}(?:-[\dxX])?\s?SSP\/[A-Z]{2}/gi, // RG (só com contexto)
    /R\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?/g,                           // valor
    /\b(?:agência|ag\.)\s?\d{3,5}\b|\bconta\s?\d{4,8}-?\d?\b/gi,       // conta
    /\b(?:SQN|SQS|SHIS|SHIN|SCLN|SCLS|QI|QL|QNL|QNM|Rua|Av\.|Avenida|Quadra)\s[^,.;\n]{2,40}(?:,\s?\d{1,5}[A-Za-z]?)?(?:,?\s(?:[Aa]pto|[Aa]pt\.|[Aa]p\.|[Bb]loco|[Cc]asa|[Ss]ala|[Ll]ote)\s?[\w-]{1,6})*/g, // endereço (com número e complemento)
    /\b[\w-]*(?:RG|CPF|CNH|comprovante|laudo|extrato|contracheque|holerite|exame)[\w.-]*\.(?:pdf|jpe?g|png|docx?)\b/gi,
    nameRx,
  ];
  // Elementos que representam uma pessoa (Gmail, Outlook, Teams, chips de contato).
  const PERSON = '[email],[data-hovercard-id*="@"],[title*="@"]:not(a[href^="http"])';
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT|OPTION|SVG|CANVAS|IFRAME)$/;

  // ---------- estado ----------
  let on = false, ranges = [], els = [], obs = null, layer = null, raf = 0, timer = 0, firstDirty = 0, hoverIdx = -1, painted = [];
  const excluded = () => !!location.hostname && (get('excluir', '') || '').split(',').filter(Boolean).includes(location.hostname);

  function editable(n) {
    const e = n.nodeType === 1 ? n : n.parentElement;
    return !e || e.closest('[contenteditable=""],[contenteditable="true"],[role="textbox"],#pv-layer,svg');
  }
  function collect() {
    const t0 = performance.now(), out = [], root = document.body || document.documentElement;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.nodeValue.length < 4 || SKIP.test(n.parentNode.nodeName) || editable(n))
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    while (w.nextNode()) {
      const t = w.currentNode, s = t.nodeValue, hits = [];
      for (const rx of RULES) { rx.lastIndex = 0; let m; while ((m = rx.exec(s))) { hits.push([m.index, m.index + m[0].length]); if (!m[0].length) rx.lastIndex++; } }
      if (!hits.length) continue;
      hits.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
      let end = -1;
      for (const [a, b] of hits) { if (a < end) continue; const r = document.createRange(); r.setStart(t, a); r.setEnd(t, b); out.push(r); end = b; }
    }
    ranges = out;
    els = [...document.querySelectorAll(PERSON)].filter(e => !editable(e) && e.offsetParent !== null);
    if (layer) layer.dataset.scanMs = (performance.now() - t0).toFixed(1);
  }

  // ---------- desenho (sem tocar no DOM da página) ----------
  // Área visível de um elemento: viewport recortada por todo ancestral com overflow (painéis com rolagem).
  function clipFor(el, cache, styles) {
    if (cache.has(el)) return cache.get(el);
    let c = { l: 0, t: 0, r: innerWidth, b: innerHeight };
    const p = el.parentElement;
    if (p && p !== document.documentElement) {
      c = Object.assign({}, clipFor(p, cache, styles));
      let cs = styles.get(p); if (!cs) { cs = getComputedStyle(p); styles.set(p, cs); }
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const pr = p.getBoundingClientRect();
        c = { l: Math.max(c.l, pr.left), t: Math.max(c.t, pr.top), r: Math.min(c.r, pr.right), b: Math.min(c.b, pr.bottom) };
      }
    }
    cache.set(el, c); return c;
  }
  function paint() {
    raf = 0; if (!on) return;
    const t0 = performance.now();
    const boxes = [], cache = new Map(), styles = new Map();
    const vw = innerWidth, vh = innerHeight;
    const add = (rect, key, node) => {
      // Fora da viewport: descarta antes de medir ancestrais e consultar elementFromPoint.
      if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= vw || rect.top >= vh) return;
      const host = node.nodeType === 1 ? node : node.parentElement;
      const c = clipFor(host, cache, styles);
      const l = Math.max(rect.left, c.l), t = Math.max(rect.top, c.t), r = Math.min(rect.right, c.r), b = Math.min(rect.bottom, c.b);
      if (r - l < 2 || b - t < 2) return;
      // Coberto por outro elemento (modal, menu)? Confere o ponto central da parte visível.
      const hit = document.elementFromPoint((l + r) / 2, (t + b) / 2);
      if (!hit || !(hit === host || host.contains(hit))) return;
      boxes.push([{ left: l, top: t, width: r - l, height: b - t }, String(key)]);
    };
    ranges.forEach((r, i) => { if (r.startContainer.isConnected) for (const rc of r.getClientRects()) add(rc, i, r.startContainer); });
    els.forEach((e, i) => { if (e.isConnected) add(e.getBoundingClientRect(), 'e' + i, e); });
    let html = '';
    for (const [r, k] of boxes) html += `<div data-k="${k}" class="${k === hoverIdx ? 'rv' : ''}" style="left:${r.left - 2}px;top:${r.top - 1}px;width:${r.width + 4}px;height:${r.height + 2}px"></div>`;
    layer.innerHTML = html; layer.dataset.n = boxes.length;
    painted = boxes.map(([r, k]) => [r.left - 2, r.top - 1, r.left + r.width + 2, r.top + r.height + 1, k]); // para o hover
    layer.dataset.paintMs = (performance.now() - t0).toFixed(1); // medição para os testes
  }
  const schedule = () => { if (on && !raf) raf = requestAnimationFrame(paint); };
  // Debounce de 250 ms, mas com espera máxima de 1 s: app que re-renderiza sem parar ainda é revarrido.
  const run = () => { clearTimeout(timer); timer = 0; firstDirty = 0; collect(); schedule(); };
  const rescan = () => {
    const now = performance.now();
    if (!firstDirty) firstDirty = now;
    clearTimeout(timer);
    timer = setTimeout(run, Math.max(0, Math.min(250, firstDirty + 1000 - now)));
  };
  function onMove(e) {
    let k = -1;
    for (const [l, t, r, b, key] of painted) if (e.clientX >= l && e.clientX <= r && e.clientY >= t && e.clientY <= b) { k = key; break; }
    k = String(k);
    if (k !== hoverIdx) { hoverIdx = k; schedule(); }
  }

  function enable() {
    if (on || excluded()) return; on = true;
    layer = document.createElement('div'); layer.id = 'pv-layer';
    const st = document.createElement('style'); st.id = 'pv-style';
    st.textContent = `#pv-layer{position:fixed;inset:0;pointer-events:none;z-index:var(--us-z,2147483646)}
      #pv-layer>div{position:fixed;border-radius:4px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);background:rgba(127,127,127,.08);transition:opacity .1s}
      #pv-layer>div.rv{opacity:0}`;
    document.documentElement.append(st, layer);
    collect(); schedule();
    obs = new MutationObserver(muts => { if (muts.some(m => !layer.contains(m.target))) rescan(); });
    // No <html>: sobrevive à troca do <body> por apps que remontam a página.
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    addEventListener('scroll', schedule, { capture: true, passive: true });
    addEventListener('resize', schedule, { passive: true });
    addEventListener('mousemove', onMove, { passive: true });
  }
  function disable() {
    if (!on) return; on = false;
    obs && obs.disconnect(); obs = null; clearTimeout(timer); timer = 0; firstDirty = 0; painted = [];
    removeEventListener('scroll', schedule, { capture: true }); removeEventListener('resize', schedule); removeEventListener('mousemove', onMove);
    layer && layer.remove(); document.getElementById('pv-style')?.remove(); ranges = []; els = [];
  }
  function toggle() { on ? disable() : enable(); set('ligado', on); }

  addEventListener('keydown', e => { if (e.altKey && e.shiftKey && e.code === 'KeyP') { e.preventDefault(); toggle(); } }, true);
  try {
    GM_registerMenuCommand('Ligar/desligar (Alt+Shift+P)', toggle);
    GM_registerMenuCommand('Nomes extras a borrar…', () => {
      const v = prompt('Nomes separados por vírgula (ex.: Fulano, Siqueira):', get('nomes', ''));
      if (v !== null) { set('nomes', v); location.reload(); }
    });
    if (excluded()) {
      GM_registerMenuCommand('Voltar a borrar neste site', () => {
        set('excluir', (get('excluir', '') || '').split(',').filter(h => h && h !== location.hostname).join(','));
      });
    } else {
      GM_registerMenuCommand('Nunca neste site', () => {
        const l = (get('excluir', '') || '').split(',').filter(Boolean); l.push(location.hostname);
        set('excluir', [...new Set(l)].join(',')); disable();
      });
    }
  } catch (_) {}
  if (get('ligado', false)) enable();
})();
