// ==UserScript==
// @name         News Reader — impressão direta
// @namespace    raschagas/userscripts
// @version      1.1.0
// @description  Imprime artigos do News Reader direto nas impressoras deste aparelho (IPP), sem o diálogo.
// @match        https://reader.georritmo.com/*
// @exclude      *://camara.leg.br/*
// @exclude      *://*.camara.leg.br/*
// @exclude      *://camara.gov.br/*
// @exclude      *://*.camara.gov.br/*
// @noframes
// @inject-into content
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      *
// @downloadURL  https://raw.githubusercontent.com/raschagas/userscripts/main/src/news-reader-impressao.user.js
// @updateURL    https://raw.githubusercontent.com/raschagas/userscripts/main/src/news-reader-impressao.user.js
// ==/UserScript==

// News Reader — impressão direta (contrato da ponte página ↔ script descrito no README).
// Implementação original; não incorpora código de terceiros.
//
// @match cobre só o endereço público do News Reader; o endereço da rede local
// entra pela regra de @match personalizada do gerenciador em cada aparelho
// (README, "Sites extras por aparelho"). @connect * porque as impressoras são
// endereços de LAN que variam por aparelho; o script só fala com as impressoras
// cadastradas pelo dono e com o próprio News Reader (o PDF).
//
// Por que um script: a página não enxerga as impressoras do aparelho nem imprime
// sem o diálogo (window.print). O script guarda, POR APARELHO (GM_getValue), a
// lista de impressoras de rede e envia o PDF do artigo direto a elas por IPP
// (RFC 8011, Print-Job com application/pdf) via GM_xmlhttpRequest, que não
// sofre CORS. Impressora sem resposta, sem PDF ou não cadastrada → a página
// abre o diálogo do navegador (o formato já vem do @page).
//
// Conversa com a página só por eventos DOM com detail em JSON (string): em
// Chrome/Edge o detail-objeto não atravessa o mundo isolado do script.
//
// Defesas (contrato da ponte descrito no README): qualquer script da página pode
// disparar esses eventos, então o próprio script confere o GESTO DO DONO, que a
// página não consegue forjar: ele observa os cliques e o Enter com
// event.isTrusted (fase de captura) e guarda onde e quando foram. @inject-into
// content: no Violentmonkey o padrão é rodar no contexto da página, onde ela
// poderia trocar Date.now ou Element.prototype.closest e burlar essas checagens.
//   • job    só até 5 s depois de um clique confiável no botão Imprimir (ou no ▾);
//            pdf_url na mesma origem e sob <base>/api/print/; a resposta tem de
//            ser application/pdf e começar com %PDF.
//   • probe  só ipp:// ou ipps:// (sem usuário nem IPv6), e só até 5 s depois de
//            um gesto confiável dentro de Configurações → Impressão
//            (#settings-print); um gesto vale uma sondagem.
//   • save   só com gesto confiável em #settings-print; a lista é revalidada
//            (até 20 impressoras, nomes curtos, endereços ipp/ipps).
//   Tempo: a página desiste do trabalho em 30 s e abre a janela de impressão;
//   por isso o PDF tem 20 s e o POST IPP 8 s, e o resultado chega antes.
//   página → script: nr-print:job {pdf_url,title,mode,printer?} · nr-print:probe {uri}
//                    nr-print:save {device} · nr-print:ask
//   script → página: nr-print:helper {device} · nr-print:result {...} · nr-print:probed {...}
(() => {
  'use strict';
  const VERSION = '1.1.0';
  const KEY = 'nr.print.device';
  const EMPTY = { label: '', printers: [], default_printer: null };

  // ── IPP/1.1 (RFC 8010) ────────────────────────────────────────────────────
  const TAG = { op: 0x01, job: 0x02, end: 0x03, printer: 0x04, integer: 0x21, boolean: 0x22, enum: 0x23,
    keyword: 0x44, uri: 0x45, charset: 0x47, language: 0x48, mime: 0x49, name: 0x42, text: 0x41 };
  const enc = new TextEncoder();
  function attr(out, tag, name, value) {
    const n = enc.encode(name);
    let v;
    if (tag === TAG.integer || tag === TAG.enum) { v = new Uint8Array(4); new DataView(v.buffer).setInt32(0, value); }
    else if (tag === TAG.boolean) v = new Uint8Array([value ? 1 : 0]);
    else v = enc.encode(String(value));
    out.push(Uint8Array.of(tag, n.length >> 8, n.length & 255), n, Uint8Array.of(v.length >> 8, v.length & 255), v);
  }
  function request(op, uri, jobAttrs, requestId) {
    const out = [Uint8Array.of(1, 1, op >> 8, op & 255), new Uint8Array(new Uint32Array([0]).buffer)];
    new DataView(out[1].buffer).setUint32(0, requestId || 1);
    out.push(Uint8Array.of(TAG.op));
    attr(out, TAG.charset, 'attributes-charset', 'utf-8');
    attr(out, TAG.language, 'attributes-natural-language', 'pt-br');
    attr(out, TAG.uri, 'printer-uri', uri);
    attr(out, TAG.name, 'requesting-user-name', 'news-reader');
    (jobAttrs.op || []).forEach((a) => attr(out, a[0], a[1], a[2]));
    if ((jobAttrs.job || []).length) {
      out.push(Uint8Array.of(TAG.job));
      jobAttrs.job.forEach((a) => attr(out, a[0], a[1], a[2]));
    }
    out.push(Uint8Array.of(TAG.end));
    return out;
  }
  function concat(parts) {
    const len = parts.reduce((s, p) => s + p.length, 0), buf = new Uint8Array(len);
    let o = 0; parts.forEach((p) => { buf.set(p, o); o += p.length; });
    return buf;
  }
  // Resposta: status + atributos de printer/job como {nome: [valores]}. Estrita: qualquer
  // desvio (versão, request-id, comprimento fora do buffer, sem a tag de fim) lança.
  function parse(buffer, expectedId) {
    const b = new Uint8Array(buffer || new ArrayBuffer(0)), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const dec = new TextDecoder();
    const bad = () => { throw new Error('resposta IPP inválida'); };
    if (b.length < 9 || (b[0] !== 1 && b[0] !== 2) || dv.getUint32(4) !== expectedId) bad();
    const out = { status: dv.getUint16(2), attrs: Object.create(null) };
    let i = 8, last = null, ended = false;
    while (i < b.length) {
      const tag = b[i++];
      if (tag === TAG.end) { ended = true; break; }
      if (tag < 0x10) continue;                       // delimitador de grupo
      if (i + 2 > b.length) bad();
      const nl = dv.getUint16(i); i += 2;
      if (i + nl + 2 > b.length) bad();
      const name = dec.decode(b.subarray(i, i + nl)); i += nl;
      const vl = dv.getUint16(i); i += 2;
      if (i + vl > b.length) bad();
      let val;
      if (tag === TAG.integer || tag === TAG.enum) { if (vl !== 4) bad(); val = dv.getInt32(i); }
      else if (tag === TAG.boolean) { if (vl !== 1) bad(); val = !!b[i]; }
      else val = dec.decode(b.subarray(i, i + vl));
      i += vl;
      if (name) { last = name; out.attrs[name] = [val]; } else if (last) out.attrs[last].push(val); else bad();
    }
    if (!ended) bad();
    return out;
  }
  let lastId = 0;
  const nextId = () => { lastId = (lastId % 0x7fffffff) + 1; return lastId; };
  function httpUri(uri) { return uri.replace(/^ipps:/i, 'https:').replace(/^ipp:/i, 'http:').replace(/^(https?:\/\/[^/:]+)(\/|$)/, '$1:631$2'); }
  function post(uri, body, requestId) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      method: 'POST', url: httpUri(uri), data: new Blob([body], { type: 'application/ipp' }), anonymous: true,
      responseType: 'arraybuffer', timeout: 8000, headers: { 'Content-Type': 'application/ipp' },
      onload: (r) => {
        if (r.status !== 200) { reject(new Error('HTTP ' + r.status)); return; }
        // Resposta truncada ou malformada: falha (a página abre o diálogo), nunca fica pendurada.
        try { resolve(parse(r.response, requestId)); } catch (_) { reject(new Error('resposta IPP inválida')); }
      },
      onerror: () => reject(new Error('sem resposta')), ontimeout: () => reject(new Error('tempo esgotado')),
    }));
  }
  function header(raw) {
    const out = {};
    String(raw || '').split(/\r?\n/).forEach((line) => {
      const i = line.indexOf(':');
      if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    });
    return out;
  }
  // ── Gesto confiável do dono (a página não forja isTrusted) ───────────────
  const GESTURE_MS = 5000;
  const gesture = { print: 0, settings: 0 };
  function noteGesture(e) {
    if (!e.isTrusted || !e.target || !e.target.closest) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('[data-print-split], .print-menu')) gesture.print = Date.now();
    if (e.target.closest('#settings-print')) gesture.settings = Date.now();
  }
  const recent = (t) => Date.now() - t <= GESTURE_MS;
  // Base do app (o News Reader pode estar sob /reader): igual ao NR.BASE da página.
  const BASE = location.pathname.replace(/\/+$/, '');
  // Host sem userinfo (@) nem IPv6 ([…]) e porta só numérica: o httpUri nunca erra a porta.
  const IPP_URI = /^ipps?:\/\/[^\s/?#@[\]:]+(:\d{1,5})?(\/[^\s?#]*)?$/i;
  function cleanDevice(dev) {
    const d = dev && typeof dev === 'object' ? dev : {};
    const printers = (Array.isArray(d.printers) ? d.printers : []).slice(0, 20)
      .filter((p) => p && typeof p.name === 'string' && p.name.trim() && typeof p.uri === 'string' && IPP_URI.test(p.uri))
      .map((p) => ({ name: p.name.trim().slice(0, 80), uri: p.uri,
        caps: p.caps && typeof p.caps === 'object' ? JSON.parse(JSON.stringify(p.caps)) : {} }));
    const names = printers.map((p) => p.name);
    return { label: String(d.label || '').slice(0, 60), printers,
      default_printer: names.includes(d.default_printer) ? d.default_printer : (names[0] || null) };
  }

  // job-name é name(255): corta por bytes UTF-8 sem partir caractere.
  function clipBytes(s, max) {
    let out = '', n = 0;
    for (const ch of s) { const k = enc.encode(ch).length; if (n + k > max) break; out += ch; n += k; }
    return out;
  }

  async function probe(uri) {
    const id = nextId();
    const res = await post(uri, concat(request(0x000B, uri, { op: [[TAG.keyword, 'requested-attributes', 'all']] }, id)), id);
    const a = res.attrs;
    return { ok: res.status < 0x100, pdf: (a['document-format-supported'] || []).includes('application/pdf'),
      sides: a['sides-supported'] || [], number_up: a['number-up-supported'] || [], media: a['media-supported'] || [],
      name: (a['printer-make-and-model'] || a['printer-name'] || [''])[0], checked_at: new Date().toISOString() };
  }
  async function printJob(job) {
    const device = load();
    const name = job.printer || device.default_printer;
    const printer = device.printers.find((p) => p.name === name);
    if (!printer) throw new Error('Impressora não cadastrada neste aparelho');
    // O PDF vem só do próprio News Reader: mesma origem e só a rota de impressão.
    let pdfUrl;
    try { pdfUrl = new URL(String(job.pdf_url || ''), location.href); } catch (_) { throw new Error('PDF fora do News Reader'); }
    if (pdfUrl.origin !== location.origin || !pdfUrl.pathname.startsWith(BASE + '/api/print/')) throw new Error('PDF fora do News Reader');
    const got = await new Promise((resolve, reject) => GM_xmlhttpRequest({
      method: 'GET', url: pdfUrl.href, responseType: 'arraybuffer', timeout: 20000,
      onload: (r) => (r.status === 200 ? resolve(r) : reject(new Error('PDF HTTP ' + r.status))),
      onerror: () => reject(new Error('PDF indisponível')), ontimeout: () => reject(new Error('PDF demorou demais')) }));
    // Redirecionamento seguido pelo gerenciador: o destino final também tem de ser a rota de impressão.
    if (got.finalUrl) {
      let fin; try { fin = new URL(String(got.finalUrl)); } catch (_) { throw new Error('PDF fora do News Reader'); }
      if (fin.origin !== location.origin || !fin.pathname.startsWith(BASE + '/api/print/')) throw new Error('PDF fora do News Reader');
    }
    const hdr = header(got.responseHeaders);
    const body = new Uint8Array(got.response || new ArrayBuffer(0));
    const isPdf = body.length > 4 && String.fromCharCode(body[0], body[1], body[2], body[3], body[4]) === '%PDF-';
    if (!/^application\/pdf\b/i.test(hdr['content-type'] || '') || !isPdf) throw new Error('A resposta não é um PDF');
    // O servidor diz como imprimir este PDF (livreto imposto, lados, papel).
    const attrs = [[TAG.keyword, 'print-scaling', 'none']];
    const sides = hdr['x-print-sides'], media = hdr['x-print-media'];
    if (/^(one-sided|two-sided-long-edge|two-sided-short-edge)$/.test(sides || '')) attrs.push([TAG.keyword, 'sides', sides]);
    if (/^[a-z0-9_.]+$/.test(media || '')) attrs.push([TAG.keyword, 'media', media]);
    const id = nextId();
    const head = request(0x0002, printer.uri, {
      op: [[TAG.name, 'job-name', clipBytes(String(job.title || 'Artigo'), 255) || 'Artigo'], [TAG.mime, 'document-format', 'application/pdf']],
      job: attrs }, id);
    const res = await post(printer.uri, concat(head.concat([body])), id);
    if (res.status >= 0x100) throw new Error('A impressora recusou (0x' + res.status.toString(16) + ')');
    return { ok: true, printer: printer.name, job_id: (res.attrs['job-id'] || [null])[0], booklet: hdr['x-print-booklet'] || 'none' };
  }

  // ── Estado por aparelho ───────────────────────────────────────────────────
  function load() { try { return cleanDevice(JSON.parse(GM_getValue(KEY, '{}'))); } catch (_) { return Object.assign({}, EMPTY, { printers: [] }); } }
  function save(d) { GM_setValue(KEY, JSON.stringify(d)); }
  function emit(type, detail) { document.dispatchEvent(new CustomEvent(type, { detail: JSON.stringify(detail) })); }
  function on(type, fn) {
    document.addEventListener(type, (e) => {
      let d = {}; try { d = JSON.parse(e.detail || '{}'); } catch (_) { return; }
      if (!d || typeof d !== 'object' || Array.isArray(d)) return;
      fn(d);
    });
  }
  if (GM_getValue('nr.print.off.' + location.host, false)) {
    GM_registerMenuCommand('Ligar a impressão direta neste site', () => { GM_setValue('nr.print.off.' + location.host, false); location.reload(); });
    return;
  }
  GM_registerMenuCommand('Desligar a impressão direta neste site', () => { GM_setValue('nr.print.off.' + location.host, true); location.reload(); });
  document.addEventListener('click', noteGesture, true);
  document.addEventListener('keydown', noteGesture, true);
  on('nr-print:ask', () => emit('nr-print:helper', { version: VERSION, device: load() }));
  on('nr-print:save', (d) => {
    if (!recent(gesture.settings)) { emit('nr-print:refused', { what: 'save', reason: 'sem gesto em Configurações' }); return; }
    gesture.settings = 0;   // um gesto, um cadastro
    save(cleanDevice(d.device)); emit('nr-print:helper', { version: VERSION, device: load() });
  });
  on('nr-print:probe', (d) => {
    const uri = String(d.uri || '');
    if (!IPP_URI.test(uri)) { emit('nr-print:probed', { uri, error: 'endereço não é ipp:// nem ipps:// (sem usuário nem IPv6)' }); return; }
    if (!recent(gesture.settings)) { emit('nr-print:probed', { uri, error: 'sem gesto em Configurações' }); return; }
    gesture.settings = 0;   // um gesto, uma sondagem
    probe(uri).then((caps) => emit('nr-print:probed', { uri, caps }), (err) => emit('nr-print:probed', { uri, error: err.message }));
  });
  on('nr-print:job', (d) => {
    if (!recent(gesture.print)) { emit('nr-print:result', { seq: d.seq, ok: false, reason: 'sem clique no Imprimir' }); return; }
    gesture.print = 0;   // um clique, um trabalho
    printJob(d).then((r) => emit('nr-print:result', Object.assign({ seq: d.seq }, r)),
      (err) => emit('nr-print:result', { seq: d.seq, ok: false, reason: err.message }));
  });
  document.documentElement.dataset.nrPrintHelper = VERSION;
  emit('nr-print:helper', { version: VERSION, device: load() });
  GM_registerMenuCommand('Esquecer as impressoras deste aparelho', () => { save(EMPTY); emit('nr-print:helper', { version: VERSION, device: load() }); });

})();
