// ==UserScript==
// @name         Zotero — salvar página
// @namespace    raschagas/userscripts
// @version      1.0.0
// @description  Salva a página atual no Zotero com a referência ABNT completa: Zotero de casa primeiro, depois o Zotero desktop e, por fim, a Web API do zotero.org.
// @match        *://*/*
// @noframes
// @inject-into content
// @sandbox     DOM
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      zotero.raschagas.lan
// @connect      127.0.0.1
// @connect      api.zotero.org
// @downloadURL  https://raw.githubusercontent.com/raschagas/userscripts/main/src/zotero-salvar.user.js
// @updateURL    https://raw.githubusercontent.com/raschagas/userscripts/main/src/zotero-salvar.user.js
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window.self || window.__zoteroSalvar) return;
  window.__zoteroSalvar = true;

  const BRIDGE = 'http://zotero.raschagas.lan';
  const DESKTOP = 'http://127.0.0.1:23119';
  const API = 'https://api.zotero.org';
  const ESTILO = 'associacao-brasileira-de-normas-tecnicas';
  const HOST = location.hostname.replace(/^www\./, '');
  const DESKTOP_H = { 'Content-Type': 'application/json', 'X-Zotero-Connector-API-Version': '3', 'Zotero-Allowed-Request': '1' };

  const gv = (k, d) => { try { const v = GM_getValue(k, d); return v === undefined ? d : v; } catch (e) { return d; } };
  const sv = (k, v) => { try { GM_setValue(k, v); } catch (e) { /* sem armazenamento */ } };
  const parse = (t) => { try { return JSON.parse(t); } catch (e) { return null; } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const token = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

  function gm(o) {
    return new Promise((resolve) => {
      const fim = (r) => resolve(r);
      try {
        GM_xmlhttpRequest({
          method: o.method || 'GET', url: o.url, headers: o.headers || {}, data: o.data,
          timeout: o.timeout || 15000, anonymous: !!o.anonymous,
          onload: (r) => fim({ ok: r.status >= 200 && r.status < 300, status: r.status, text: r.responseText || '' }),
          onerror: () => fim({ ok: false, status: 0, text: '', erro: 'sem resposta' }),
          ontimeout: () => fim({ ok: false, status: 0, text: '', erro: 'tempo esgotado' }),
          onabort: () => fim({ ok: false, status: 0, text: '', erro: 'cancelado' }),
        });
      } catch (e) { fim({ ok: false, status: 0, text: '', erro: 'não enviado' }); }
    });
  }

  // ---------------------------------------------------------------- captura local
  function metas(re) {
    const m = {};
    for (const el of document.querySelectorAll('meta[name],meta[property]')) {
      const k = (el.getAttribute('name') || el.getAttribute('property') || '').trim().toLowerCase();
      const v = clean(el.getAttribute('content'));
      if (!k || !v || !re.test(k)) continue;
      (m[k] = m[k] || []).push(v);
    }
    return m;
  }

  function jsonld() {
    const out = [];
    const walk = (o, d) => {
      if (d > 4 || !o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach((x) => walk(x, d + 1)); return; }
      if (o['@graph']) walk(o['@graph'], d + 1);
      if (o['@type'] && out.length < 12) out.push(o);
    };
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) walk(parse(s.textContent), 0);
    return out.filter((o) => JSON.stringify(o).length < 40000);
  }
  const ldType = (o) => [].concat(o['@type'] || []).map(String);
  const LD_OBRA = /^(ScholarlyArticle|MedicalScholarlyArticle|Book|Chapter|Thesis|Report|Dataset|Article|NewsArticle|BlogPosting|WebPage|CreativeWork)$/;

  function coins() {
    return Array.from(document.querySelectorAll('span.Z3988[title]')).slice(0, 5).map((s) => {
      const o = {};
      for (const [k, v] of new URLSearchParams(s.getAttribute('title'))) (o[k] = o[k] || []).push(clean(v));
      return o;
    });
  }

  const DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>]+[^\s"'<>.,;:)\]])/;
  const normDoi = (s) => {
    let t = String(s || '');
    try { t = decodeURIComponent(t); } catch (e) { /* escape inválido: usa o texto cru */ }
    const m = DOI_RE.exec(t);
    return m ? m[1] : '';
  };
  function isbnOk(raw) {
    const s = String(raw || '').toUpperCase().replace(/[^0-9X]/g, '');
    if (s.length === 10) {
      let t = 0; for (let i = 0; i < 10; i++) { const c = s[i] === 'X' ? 10 : +s[i]; if (s[i] === 'X' && i < 9) return ''; t += c * (10 - i); }
      return t % 11 === 0 ? s : '';
    }
    if (s.length === 13 && !s.includes('X')) {
      let t = 0; for (let i = 0; i < 13; i++) t += +s[i] * (i % 2 ? 3 : 1);
      return t % 10 === 0 ? s : '';
    }
    return '';
  }
  // ISBN-10 vira ISBN-13 (prefixo 978) para comparar; inválido vira ''.
  function isbn13(raw) {
    const v = isbnOk(raw);
    if (v.length !== 10) return v;
    const b = `978${v.slice(0, 9)}`;
    let t = 0; for (let i = 0; i < 12; i++) t += +b[i] * (i % 2 ? 3 : 1);
    return b + ((10 - (t % 10)) % 10);
  }
  // Só http/https, relativo resolvido contra a página.
  const urlWeb = (v) => { try { const u = new URL(String(v || ''), location.href); return v && /^https?:$/.test(u.protocol) ? u.href : ''; } catch (e) { return ''; } };
  // Valores JSON-LD podem vir como texto, número, lista ou objeto ({"@value"} ou {name}).
  const txt = (v, d = 0) => {
    if (v == null || d > 4) return '';
    if (typeof v === 'string' || typeof v === 'number') return clean(v);
    if (Array.isArray(v)) { for (const x of v) { const t = txt(x, d + 1); if (t) return t; } return ''; }
    if (typeof v === 'object') return txt(v['@value'] !== undefined ? v['@value'] : v.name, d + 1);
    return '';
  };
  const pdfAqui = () => /pdf/i.test(document.contentType || '');

  // Só metadados declarados na página (barato, roda uma vez no carregamento).
  function captura(comTexto) {
    const cit = metas(/^(citation_|bepress_citation_)/);
    for (const k of Object.keys(cit)) if (k.startsWith('bepress_')) { const n = k.slice(8); cit[n] = (cit[n] || []).concat(cit[k]); delete cit[k]; }
    const dc = metas(/^(dc|dcterms)[.:]/);
    const prism = metas(/^prism[.:]/);
    const og = metas(/^(og|article|book|books):/);
    const autor = metas(/^author$/);
    const ld = jsonld();
    const co = coins();
    const canon = document.querySelector('link[rel="canonical"]');
    let url = location.href;
    if (canon && canon.href && /^https?:/.test(canon.href) && new URL(canon.href, location.href).hostname === location.hostname) url = canon.href;

    let doi = normDoi((cit.citation_doi || [])[0] || (prism['prism.doi'] || [])[0] || '');
    if (!doi) for (const v of (dc['dc.identifier'] || []).concat(dc['dcterms.identifier'] || [])) if ((doi = normDoi(v))) break;
    if (!doi) for (const o of ld) for (const v of [].concat(o.identifier || [], o.sameAs || [], o['@id'] || [])) if (!doi && typeof v === 'string' && /doi/i.test(v)) doi = normDoi(v);
    if (!doi) for (const o of co) for (const v of o.rft_id || []) if (!doi && /doi/i.test(v)) doi = normDoi(v);
    if (!doi && /doi|10\.\d{4}/i.test(location.pathname)) doi = normDoi(location.pathname);
    const doiMeta = doi;

    let isbn = '';
    const isbns = [].concat(cit.citation_isbn || [], og['book:isbn'] || [], og['books:isbn'] || [], ...co.map((o) => o['rft.isbn'] || []),
      ...ld.map((o) => [].concat(o.isbn || [])), (dc['dc.identifier'] || []).filter((v) => /isbn/i.test(v)));
    for (const v of isbns) if ((isbn = isbnOk(v))) break;
    const isbnMeta = isbn;

    if (comTexto && (!doi || !isbn)) {
      const corpoTxt = (document.body ? document.body.textContent : '').slice(0, 200000);
      if (!doi) {
        const todos = new Set((corpoTxt.match(new RegExp(DOI_RE.source, 'g')) || []).map(normDoi));
        if (todos.size === 1) doi = [...todos][0];
      }
      if (!isbn) {
        const achados = new Set();
        for (const m of corpoTxt.matchAll(/ISBN(?:-1[03])?:?\s*([0-9][0-9\- ]{8,16}[0-9Xx])/g)) { const v = isbnOk(m[1]); if (v) achados.add(v); }
        if (achados.size === 1) isbn = [...achados][0];
      }
    }

    let pdf = urlWeb((cit.citation_pdf_url || [])[0]);
    if (!pdf && pdfAqui()) pdf = urlWeb(location.href);
    if (!pdf) { const l = document.querySelector('link[type="application/pdf"][href]'); if (l) pdf = urlWeb(l.getAttribute('href')); }

    const sel = clean((window.getSelection && String(window.getSelection())) || '').slice(0, 5000);
    const titulo = clean(document.title);
    return {
      url, titulo, doi, doiMeta, isbn, isbnMeta, pdf, sel, pdfPagina: pdfAqui(),
      m: { citation: cit, dc, prism, og, author: autor, jsonld: ld, coins: co },
    };
  }

  function academica(c) {
    const ld = c.m.jsonld.some((o) => ldType(o).some((t) => /^(ScholarlyArticle|MedicalScholarlyArticle|Book|Chapter|Thesis|Report)$/.test(t)));
    return Object.keys(c.m.citation).length > 0 || !!c.doiMeta || !!c.isbnMeta || ld || c.m.coins.length > 0 || c.pdfPagina;
  }

  // ---------------------------------------------------------------- item Zotero
  const CAMPOS = {
    journalArticle: ['publicationTitle', 'volume', 'issue', 'pages', 'journalAbbreviation', 'DOI', 'ISSN'],
    book: ['publisher', 'place', 'edition', 'numPages', 'ISBN', 'series'],
    bookSection: ['bookTitle', 'publisher', 'place', 'pages', 'ISBN', 'edition'],
    conferencePaper: ['proceedingsTitle', 'conferenceName', 'publisher', 'place', 'pages', 'DOI', 'ISBN', 'volume'],
    thesis: ['university', 'place', 'thesisType', 'numPages'],
    report: ['institution', 'place', 'reportNumber', 'reportType', 'pages'],
    preprint: ['repository', 'archiveID', 'DOI', 'place'],
    webpage: ['websiteTitle', 'websiteType'],
    document: ['publisher'],
  };
  const COMUNS = ['title', 'abstractNote', 'date', 'url', 'accessDate', 'language', 'extra'];
  const TIPO_PT = {
    journalArticle: 'Artigo de periódico', book: 'Livro', bookSection: 'Capítulo de livro', conferencePaper: 'Trabalho em evento',
    thesis: 'Tese ou dissertação', report: 'Relatório', preprint: 'Preprint', webpage: 'Página web', document: 'Documento',
  };
  const SUFIXO = /^(filho|filha|júnior|junior|jr\.?|neto|neta|sobrinho|sobrinha)$/i;

  function pessoa(s, tipo) {
    s = clean(s).replace(/\s*\(.*?\)\s*$/, '');
    if (!s) return null;
    if (s.includes(',')) { const [l, ...f] = s.split(','); return { creatorType: tipo, lastName: clean(l), firstName: clean(f.join(',')) }; }
    const p = s.split(' ');
    if (p.length === 1) return { creatorType: tipo, name: s };
    let i = p.length - 1;
    if (SUFIXO.test(p[i]) && i > 1) i--;
    // NBR 6023: partícula fica com o prenome (João da Silva → SILVA, João da); sufixo fica no sobrenome.
    return { creatorType: tipo, firstName: p.slice(0, i).join(' '), lastName: p.slice(i).join(' ') };
  }
  function ldPessoa(a, tipo) {
    if (!a) return null;
    if (typeof a === 'string') return pessoa(a, tipo);
    if (typeof a !== 'object') return null;
    const fam = txt(a.familyName), nm = txt(a.name);
    if (fam) return { creatorType: tipo, lastName: fam, firstName: txt(a.givenName) };
    if (ldType(a).includes('Organization') && nm) return { creatorType: tipo, name: nm };
    return nm ? pessoa(nm, tipo) : null;
  }
  const dataIso = (s) => { s = clean(s); const m = /^(\d{4})[/-](\d{1,2})(?:[/-](\d{1,2}))?/.exec(s); return m ? [m[1], m[2].padStart(2, '0'), m[3] && m[3].padStart(2, '0')].filter(Boolean).join('-') : s; };
  const ano = (s) => { const m = /\b(1[5-9]\d{2}|20\d{2})\b/.exec(String(s || '')); return m ? m[1] : ''; };

  function montaItem(c) {
    const ci = c.m.citation, dc = c.m.dc, og = c.m.og, pr = c.m.prism;
    const um = (o, ...ks) => { for (const k of ks) if (o[k] && o[k][0]) return o[k][0]; return ''; };
    const ld = c.m.jsonld.find((o) => ldType(o).some((t) => /^(ScholarlyArticle|MedicalScholarlyArticle|Book|Chapter|Thesis|Report)$/.test(t)))
      || c.m.jsonld.find((o) => ldType(o).some((t) => LD_OBRA.test(t) && t !== 'WebPage')) || {};
    const lt = ldType(ld);
    const tem = (k) => !!(ci[k] && ci[k].length);

    let tipo = 'webpage';
    if (c.pdfPagina && !Object.keys(ci).length) tipo = 'document';
    if (tem('citation_arxiv_id')) tipo = 'preprint';
    if (tem('citation_isbn') || lt.includes('Book') || /book/.test(um(og, 'og:type')) || (c.isbnMeta && !tem('citation_journal_title'))) tipo = 'book';
    if (tem('citation_book_title') || lt.includes('Chapter')) tipo = 'bookSection';
    if (tem('citation_dissertation_institution') || lt.includes('Thesis')) tipo = 'thesis';
    if (tem('citation_technical_report_institution') || lt.includes('Report')) tipo = 'report';
    if (tem('citation_conference_title')) tipo = 'conferencePaper';
    if (tem('citation_journal_title') || um(pr, 'prism.publicationname') || (lt.some((t) => /ScholarlyArticle/.test(t)) && ld.isPartOf)) tipo = 'journalArticle';

    const it = { itemType: tipo };
    const fontes = {};
    const poe = (campo, valor, fonte) => { valor = clean(valor); if (valor && !it[campo]) { it[campo] = valor; fontes[campo] = fonte; } };

    poe('title', um(ci, 'citation_title'), 'citation');
    poe('title', um(dc, 'dc.title', 'dcterms.title'), 'dublin core');
    poe('title', txt(ld.headline) || txt(ld.name), 'json-ld');
    poe('title', um(og, 'og:title'), 'open graph');
    poe('title', c.titulo, 'título da página');

    let cr = (ci.citation_author || []).map((a) => pessoa(a, 'author')).filter(Boolean);
    let crf = 'citation';
    if (!cr.length) { cr = (dc['dc.creator'] || dc['dcterms.creator'] || []).map((a) => pessoa(a, 'author')).filter(Boolean); crf = 'dublin core'; }
    if (!cr.length) { cr = [].concat(ld.author || []).map((a) => ldPessoa(a, 'author')).filter(Boolean); crf = 'json-ld'; }
    if (!cr.length && tipo !== 'webpage') { cr = (c.m.author.author || []).map((a) => pessoa(a, 'author')).filter(Boolean); crf = 'meta author'; }
    if (tipo === 'bookSection' && tem('citation_editor')) cr = cr.concat(ci.citation_editor.map((a) => pessoa(a, 'editor')).filter(Boolean));
    if (cr.length) { it.creators = cr.slice(0, 60); fontes.creators = crf; }

    const dt = um(ci, 'citation_publication_date', 'citation_date', 'citation_cover_date', 'citation_online_date');
    poe('date', dt && dataIso(dt), 'citation');
    poe('date', dataIso(um(dc, 'dc.date', 'dcterms.issued', 'dcterms.date', 'dc.date.issued')), 'dublin core');
    poe('date', dataIso(um(pr, 'prism.publicationdate')), 'prism');
    poe('date', txt(ld.datePublished) && dataIso(txt(ld.datePublished)), 'json-ld');
    poe('date', dataIso(um(og, 'article:published_time')), 'open graph');

    const parte = [].concat(ld.isPartOf || [])[0] || {};
    poe('publicationTitle', um(ci, 'citation_journal_title') || um(pr, 'prism.publicationname'), 'citation');
    poe('publicationTitle', txt(parte.name), 'json-ld');
    poe('journalAbbreviation', um(ci, 'citation_journal_abbrev'), 'citation');
    poe('volume', um(ci, 'citation_volume') || um(pr, 'prism.volume'), 'citation');
    poe('issue', um(ci, 'citation_issue') || um(pr, 'prism.number'), 'citation');
    const fp = um(ci, 'citation_firstpage') || um(pr, 'prism.startingpage'), lp = um(ci, 'citation_lastpage') || um(pr, 'prism.endingpage');
    poe('pages', fp && (lp && lp !== fp ? `${fp}-${lp}` : fp), 'citation');
    poe('ISSN', um(ci, 'citation_issn') || um(pr, 'prism.issn'), 'citation');
    const pub = [].concat(ld.publisher || [])[0];
    poe('publisher', um(ci, 'citation_publisher') || um(dc, 'dc.publisher', 'dcterms.publisher'), 'citation');
    poe('publisher', txt(pub), 'json-ld');
    poe('bookTitle', um(ci, 'citation_book_title'), 'citation');
    poe('university', um(ci, 'citation_dissertation_institution'), 'citation');
    poe('institution', um(ci, 'citation_technical_report_institution'), 'citation');
    poe('reportNumber', um(ci, 'citation_technical_report_number'), 'citation');
    poe('conferenceName', um(ci, 'citation_conference_title'), 'citation');
    poe('proceedingsTitle', um(ci, 'citation_conference_title'), 'citation');
    poe('edition', txt(ld.bookEdition), 'json-ld');
    poe('numPages', txt(ld.numberOfPages), 'json-ld');
    if (tipo === 'preprint') { poe('repository', 'arXiv', 'citation'); poe('archiveID', `arXiv:${um(ci, 'citation_arxiv_id')}`, 'citation'); }
    poe('abstractNote', um(ci, 'citation_abstract'), 'citation');
    if (tipo !== 'webpage') poe('abstractNote', um(dc, 'dc.description', 'dcterms.abstract'), 'dublin core');
    poe('language', um(ci, 'citation_language') || um(dc, 'dc.language', 'dcterms.language'), 'citation');
    poe('websiteTitle', um(og, 'og:site_name'), 'open graph');
    if (c.isbn) poe('ISBN', c.isbn, c.isbnMeta ? 'metadados' : 'texto da página');
    if (c.doiMeta) {
      if ((CAMPOS[tipo] || []).includes('DOI')) poe('DOI', c.doiMeta, 'metadados');
      else poe('extra', `DOI: ${c.doiMeta}`, 'metadados');
    }
    poe('url', c.url, 'endereço');
    it.accessDate = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    fontes.accessDate = 'data de hoje';

    const vale = new Set(COMUNS.concat(CAMPOS[tipo] || []));
    for (const k of Object.keys(it)) if (!vale.has(k) && !['itemType', 'creators'].includes(k)) { delete it[k]; delete fontes[k]; }
    return { item: it, fontes };
  }

  // ---------------------------------------------------------------- ABNT local (desktop) e lacunas
  const ROTULO = { creators: 'autor', title: 'título', place: 'local', publisher: 'editora', date: 'ano', publicationTitle: 'periódico',
    volume: 'volume', issue: 'número', pages: 'páginas', url: 'URL', accessDate: 'data de acesso', bookTitle: 'título do livro',
    university: 'instituição', institution: 'instituição', conferenceName: 'evento', repository: 'repositório' };
  const EXIGE = {
    book: ['creators', 'title', 'place', 'publisher', 'date'],
    bookSection: ['creators', 'title', 'bookTitle', 'place', 'publisher', 'date', 'pages'],
    journalArticle: ['creators', 'title', 'publicationTitle', 'volume', 'issue', 'pages', 'date'],
    conferencePaper: ['creators', 'title', 'conferenceName', 'place', 'date'],
    thesis: ['creators', 'title', 'university', 'place', 'date'],
    report: ['creators', 'title', 'institution', 'place', 'date'],
    preprint: ['creators', 'title', 'repository', 'date', 'url', 'accessDate'],
    webpage: ['title', 'url', 'accessDate'],
    document: ['title', 'url', 'accessDate'],
  };
  function faltando(it) {
    return (EXIGE[it.itemType] || EXIGE.webpage).filter((k) => (k === 'creators' ? !(it.creators && it.creators.length) : k === 'date' ? !ano(it.date) : !clean(it[k])))
      .map((k) => ROTULO[k] || k);
  }

  const MES = ['jan.', 'fev.', 'mar.', 'abr.', 'maio', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
  function abntLocal(it) {
    const e = (s) => esc(clean(s));
    const autores = (it.creators || []).filter((x) => x.creatorType === 'author');
    const nome = (x) => (x.name ? e(x.name).toUpperCase() : `${e(x.lastName).toUpperCase()}${x.firstName ? `, ${e(x.firstName)}` : ''}`);
    const A = autores.length > 3 ? `${nome(autores[0])} et al` : autores.map(nome).join('; ');
    const neg = (t) => { const s = e(t); const i = s.indexOf(': '); return i > 0 ? `<b>${s.slice(0, i)}</b>${s.slice(i)}` : `<b>${s}</b>`; };
    const semAutor = (t) => { const s = e(t); const i = s.search(/\s/); return i > 0 ? s.slice(0, i).toUpperCase() + s.slice(i) : s.toUpperCase(); };
    const y = ano(it.date) || '[s. d.]';
    const pag = (p) => (p ? (/^\d/.test(p) ? `p. ${e(p)}` : e(p)) : '');
    const d = new Date(it.accessDate || Date.now());
    const acesso = it.url ? ` Disponível em: ${e(it.url)}. Acesso em: ${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()}.` : '';
    const doi = it.DOI ? ` DOI: ${e(it.DOI)}.` : '';
    const lugar = (pl, ed) => `${pl ? e(pl) : '[<i>S. l.</i>]'}: ${ed ? e(ed) : '[<i>s. n.</i>]'}`;
    const ini = A ? `${A}. ` : '';
    const titPrincipal = (t) => (A ? neg(t) : semAutor(t));
    const j = (...p) => p.filter(Boolean).join(', ');
    switch (it.itemType) {
      case 'journalArticle':
        return `${ini}${A ? e(it.title) : semAutor(it.title)}. ${neg(it.publicationTitle || '[periódico]')}, ${j(it.place && e(it.place), it.volume && `v. ${e(it.volume)}`, it.issue && `n. ${e(it.issue)}`, pag(it.pages), y)}.${doi}${acesso}`;
      case 'book':
        return `${ini}${titPrincipal(it.title)}. ${it.edition ? `${e(it.edition)} ed. ` : ''}${lugar(it.place, it.publisher)}, ${y}.${acesso}`;
      case 'bookSection': {
        const eds = (it.creators || []).filter((x) => x.creatorType === 'editor');
        const org = eds.length ? `${eds.map(nome).join('; ')} (org.). ` : '';
        return `${ini}${e(it.title)}. <i>In</i>: ${org}${neg(it.bookTitle || '')}. ${lugar(it.place, it.publisher)}, ${y}. ${pag(it.pages)}.${acesso}`.replace(/\. \./g, '.');
      }
      case 'thesis':
        // NBR 6023 (7.9): ano de depósito após o título e data da defesa depois da vinculação acadêmica.
        return `${ini}${titPrincipal(it.title)}. ${y}. ${it.thesisType ? `${e(it.thesisType)} – ` : ''}${j(it.university && e(it.university), it.place && e(it.place), y)}.${acesso}`;
      case 'report':
        return `${ini}${titPrincipal(it.title)}. ${lugar(it.place, it.institution)}, ${y}.${acesso}`;
      case 'conferencePaper':
        return `${ini}${e(it.title)}. <i>In</i>: ${e(it.conferenceName || '').toUpperCase()}, ${y}${it.place ? `, ${e(it.place)}` : ''}. ${neg(it.proceedingsTitle || '')}. ${pag(it.pages)}.${doi}${acesso}`.replace(/\. \./g, '.');
      case 'preprint':
        return `${ini}${titPrincipal(it.title)}. ${j(it.repository && e(it.repository), y)}. Preprint.${it.archiveID ? ` ${e(it.archiveID)}.` : ''}${doi}${acesso}`;
      default:
        return `${ini}${titPrincipal(it.title)}. ${j(it.websiteTitle && e(it.websiteTitle), ano(it.date))}${it.websiteTitle || ano(it.date) ? '.' : ''}${acesso}`.replace(/\.\s+Disponível/, '. Disponível').replace(/^\s+/, '');
    }
  }

  // A referência que vem de fora (Web API, Zotero de casa) passa por aqui: só texto e negrito/itálico.
  function sanitiza(html) {
    const doc = new DOMParser().parseFromString(`<div>${String(html || '')}</div>`, 'text/html');
    const ok = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', SUP: 'sup', SUB: 'sub' };
    const fora = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
    const walk = (n) => Array.from(n.childNodes).map((x) => {
      if (x.nodeType === 3) return esc(x.nodeValue);
      if (x.nodeType !== 1 || fora.has(x.tagName)) return '';
      const t = ok[x.tagName];
      const dentro = walk(x);
      if (x.style && /italic/.test(x.style.fontStyle)) return `<i>${dentro}</i>`;
      if (x.style && /bold|[6-9]00/.test(x.style.fontWeight)) return `<b>${dentro}</b>`;
      return t ? `<${t}>${dentro}</${t}>` : dentro;
    }).join('');
    return clean(walk(doc.body)).replace(/\s+([.,;:])/g, '$1');
  }

  // ---------------------------------------------------------------- coleções
  // Por site: { key, name, origem } (origem = de onde veio a chave: casa, web ou desktop). Valor antigo em texto = só o nome.
  const colecaoDoSite = () => {
    const v = (gv('colecoes', {}) || {})[HOST];
    if (typeof v === 'string') return v ? { key: '', name: v, origem: '' } : null;
    return v && typeof v === 'object' && v.name ? { key: String(v.key || ''), name: String(v.name), origem: String(v.origem || '') } : null;
  };
  const guardaColecao = (col) => {
    const m = gv('colecoes', {}) || {};
    if (col && col.name) m[HOST] = { key: col.key || '', name: col.name, origem: col.origem || '' }; else delete m[HOST];
    sv('colecoes', m);
  };
  function arvore(lista) {
    const filhos = {};
    for (const c of lista) (filhos[c.parent || ''] = filhos[c.parent || ''] || []).push(c);
    const out = [];
    const desce = (p, n) => { for (const c of (filhos[p] || []).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))) { out.push({ ...c, nivel: n }); if (n < 6) desce(c.key, n + 1); } };
    desce('', 0);
    return out;
  }
  // null = sem chave; { erro } = falha de rede, chave recusada ou outra resposta; senão as credenciais.
  async function credenciais() {
    const key = gv('zotero_key', '');
    if (!key) return null;
    let uid = gv('zotero_user', '');
    if (!uid) {
      const r = await gm({ url: `${API}/keys/current`, headers: { 'Zotero-API-Key': key, 'Zotero-API-Version': '3' }, anonymous: true });
      if (!r.status) return { erro: 'zotero.org sem resposta' };
      if (r.status === 401 || r.status === 403) return { erro: 'chave recusada' };
      const j = r.ok && parse(r.text);
      if (!j || !j.userID) return { erro: `zotero.org respondeu ${r.status}` };
      uid = String(j.userID); sv('zotero_user', uid); sv('zotero_username', j.username || '');
    }
    return { key, uid, h: { 'Zotero-API-Key': key, 'Zotero-API-Version': '3' } };
  }
  async function colecoesWeb() {
    const cr = await credenciais();
    if (!cr || cr.erro) return null;
    const out = [];
    for (let pg = 0; pg < 10; pg++) {
      const r = await gm({ url: `${API}/users/${cr.uid}/collections?limit=100&start=${pg * 100}&format=json`, headers: cr.h, anonymous: true });
      const j = r.ok && parse(r.text);
      // Página que falha = lista incompleta: não serve de cache nem para resolver a coleção.
      if (!Array.isArray(j)) return null;
      for (const c of j) if (c && c.key && c.data && c.data.name) out.push({ key: c.key, name: c.data.name, parent: c.data.parentCollection || '' });
      if (j.length < 100) break;
    }
    return out;
  }
  async function colecoesCasa() {
    const r = await gm({ url: `${gv('bridge_url', BRIDGE)}/collections`, timeout: 4000 });
    const j = r.ok && parse(r.text);
    const l = j && (Array.isArray(j) ? j : j.colecoes || j.collections);
    return Array.isArray(l) ? l.filter((c) => c && c.key && c.name).map((c) => ({ key: c.key, name: c.name, parent: c.parentCollection || c.parent || '' })) : null;
  }
  async function alvosDesktop() {
    const r = await gm({ method: 'POST', url: `${DESKTOP}/connector/getSelectedCollection`, headers: DESKTOP_H, data: '{}', timeout: 2500 });
    const j = r.ok && parse(r.text);
    return j && Array.isArray(j.targets) ? j.targets : null;
  }
  // Cada origem tem o próprio cache: chave do Zotero de casa não serve à Web API, nem o contrário.
  async function listaColecoes() {
    const casa = await colecoesCasa();
    if (casa) { sv('colecoes_cache_casa', casa); return { origem: 'casa', itens: arvore(casa) }; }
    const web = await colecoesWeb();
    if (web) { sv('colecoes_cache_web', web); return { origem: 'web', itens: arvore(web) }; }
    const t = await alvosDesktop();
    if (t) return { origem: 'desktop', itens: t.filter((x) => /^C/.test(x.id)).map((x) => ({ key: '', name: x.name, nivel: Math.max(0, (x.level || 1) - 1) })) };
    const cache = gv('colecoes_cache_casa', []) || [];
    if (cache.length) return { origem: 'casa', itens: arvore(cache) };
    return { origem: 'web', itens: arvore(gv('colecoes_cache_web', []) || []) };
  }
  // Gravação enviada e sem resposta (erro de rede ou tempo esgotado): pode ter gravado. Status HTTP = resposta certa de falha.
  const semResposta = (r) => !r.status && (r.erro === 'sem resposta' || r.erro === 'tempo esgotado');
  const semColecao = (nome) => `coleção “${nome}” não encontrada; item salvo na biblioteca`;
  const chaveDe = (nome, lista) => { const c = (lista || []).find((x) => x.name === nome); return c ? c.key : ''; };

  // ---------------------------------------------------------------- destinos
  async function viaCasa(c, it, col, passo) {
    const B = gv('bridge_url', BRIDGE);
    const nome = col ? col.name : '';
    passo('casa', 'run');
    const h = await gm({ url: `${B}/health`, timeout: 4000 });
    if (!h.ok) return { falha: h.status ? `respondeu ${h.status}` : 'fora do ar' };
    // Chave só vale se a lista escolhida veio do Zotero de casa; senão resolve pelo nome.
    let colKey = col && col.origem === 'casa' && col.key ? col.key : '';
    if (nome && !colKey) colKey = chaveDe(nome, gv('colecoes_cache_casa', []));
    if (nome && !colKey) { const l = await colecoesCasa(); if (l) { sv('colecoes_cache_casa', l); colKey = chaveDe(nome, l); } }
    const corpo = {
      url: c.url, title: it.title || c.titulo, html_meta: c.m, doi: c.doi || undefined, isbn: c.isbn || undefined,
      selection: c.sel || undefined, pdf_url: c.pdf || undefined,
      collection: colKey || nome || undefined, collection_name: nome || undefined,
    };
    const r = await gm({ method: 'POST', url: `${B}/save`, headers: { 'Content-Type': 'application/json' }, data: JSON.stringify(corpo), timeout: 90000 });
    // Pedido enviado e sem resposta: pode ter gravado. Parar aqui evita item duplicado em outro destino.
    if (semResposta(r)) return { incerto: true };
    const j = r.ok && parse(r.text);
    if (!j || !j.key) return { falha: r.status ? `respondeu ${r.status}` : r.erro || 'sem resposta' };
    const abnt = sanitiza(j.abnt_html || j.abnt);
    const dest = j.destino && typeof j.destino === 'object' ? j.destino : {};
    const avisos = nome && !colKey && !dest.colecao && !j.duplicata ? [semColecao(nome)] : [];
    return {
      key: j.key, abnt: abnt || abntLocal(it), abntFonte: abnt ? 'zotero' : 'local', avisos,
      faltando: Array.isArray(j.faltando) ? j.faltando.map((f) => clean(f && typeof f === 'object' ? f.rotulo || f.campo : f)).filter(Boolean) : [],
      duplicata: !!j.duplicata, fontes: j.fontes,
    };
  }

  async function viaDesktop(c, it, col, passo) {
    const nome = col ? col.name : '';
    passo('desktop', 'run');
    const p = await gm({ method: 'POST', url: `${DESKTOP}/connector/ping`, headers: DESKTOP_H, data: '{}', timeout: 2500 });
    if (!p.ok) return { falha: p.status ? `respondeu ${p.status}` : 'fechado' };
    const sid = token();
    const falta = faltando(it);
    const item = { ...it, id: 'zs1', tags: falta.length ? [{ tag: 'abnt-incompleto' }] : [], attachments: [], notes: [] };
    if (c.pdf) item.attachments.push({ url: c.pdf, title: 'PDF', mimeType: 'application/pdf' });
    if (c.sel) item.notes.push({ note: `<p>${esc(c.sel)}</p>` });
    const s = await gm({ method: 'POST', url: `${DESKTOP}/connector/saveItems`, headers: DESKTOP_H, data: JSON.stringify({ sessionID: sid, uri: c.url, items: [item] }), timeout: 60000 });
    // Item enviado e sem resposta: pode ter gravado; a Web API não é tentada.
    if (semResposta(s)) return { incerto: true };
    if (!s.ok) return { falha: s.status ? `respondeu ${s.status}` : s.erro || 'sem resposta' };
    const avisos = [];
    if (nome) {
      const t = await alvosDesktop();
      const alvo = t && t.find((x) => /^C/.test(x.id) && x.name === nome);
      const u = alvo && await gm({ method: 'POST', url: `${DESKTOP}/connector/updateSession`, headers: DESKTOP_H, data: JSON.stringify({ sessionID: sid, target: alvo.id }), timeout: 5000 });
      if (!u || !u.ok) avisos.push(semColecao(nome));
    }
    return { key: '', abnt: abntLocal(it), abntFonte: 'local', faltando: falta, duplicata: false, avisos };
  }

  async function viaWeb(c, it, col, passo) {
    const nome = col ? col.name : '';
    passo('web', 'run');
    if (!gv('zotero_key', '')) return { falha: 'sem chave (menu “Configurar chave”)' };
    const cr = await credenciais();
    if (!cr || cr.erro) return { falha: cr ? cr.erro : 'chave recusada' };
    const base = `${API}/users/${cr.uid}`;
    const bib = async (k) => {
      const r = await gm({ url: `${base}/items/${k}?format=bib&style=${ESTILO}&locale=pt-BR`, headers: cr.h, anonymous: true });
      return r.ok ? sanitiza(r.text) : '';
    };
    // Duplicata: mesmo DOI (sem caixa, com ou sem doi.org), ISBN (qualquer um dos guardados, como ISBN-13) ou URL.
    const norm = (s) => clean(s).toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '')
      .replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    const isbns = (s) => String(s || '').split(/[\s,;]+/).map(isbn13).filter(Boolean);
    const doiA = norm(it.DOI || c.doiMeta), isbnA = isbn13(it.ISBN), urlA = norm(it.url);
    // Uma busca por identificador (DOI, ISBN, URL), parando no primeiro item que casar.
    const alvos = [...new Set([it.DOI || c.doiMeta, it.ISBN, it.url].map(clean).filter(Boolean))];
    const avisos = [];
    let conferiu = false;
    for (const alvo of alvos) {
      const r = await gm({ url: `${base}/items/top?q=${encodeURIComponent(alvo)}&qmode=everything&limit=10&format=json`, headers: cr.h, anonymous: true });
      const l = r.ok && parse(r.text);
      if (!Array.isArray(l)) continue;
      conferiu = true;
      const igual = l.find((x) => {
        const d = (x && x.data) || {};
        const dois = [d.DOI, (/DOI:\s*(\S+)/i.exec(d.extra || '') || [])[1]].filter(Boolean).map(norm);
        return (doiA && dois.includes(doiA)) || (isbnA && isbns(d.ISBN).includes(isbnA)) || (urlA && d.url && norm(d.url) === urlA);
      });
      if (igual) {
        const ab = await bib(igual.key);
        return { key: igual.key, abnt: ab || abntLocal(igual.data || it), abntFonte: ab ? 'zotero' : 'local', faltando: faltando(igual.data || {}), duplicata: true };
      }
    }
    if (alvos.length && !conferiu) avisos.push('não deu para conferir duplicata no zotero.org; confira a biblioteca');
    const falta = faltando(it);
    let colKey = '';
    if (nome) {
      const l = await colecoesWeb();
      if (l) sv('colecoes_cache_web', l);
      // Chave escolhida na lista da Web API vale enquanto existir; senão resolve pelo nome.
      const k = col.origem === 'web' && col.key ? col.key : '';
      colKey = k && (!l || l.some((x) => x.key === k)) ? k : chaveDe(nome, l);
      if (!colKey) avisos.push(semColecao(nome));
    }
    const novo = { ...it, tags: falta.length ? [{ tag: 'abnt-incompleto' }] : [], collections: colKey ? [colKey] : [] };
    const h = { ...cr.h, 'Content-Type': 'application/json', 'Zotero-Write-Token': token() };
    const r = await gm({ method: 'POST', url: `${base}/items`, headers: h, data: JSON.stringify([novo]), anonymous: true, timeout: 30000 });
    if (semResposta(r)) return { incerto: true };
    const j = r.ok && parse(r.text);
    const key = j && j.successful && j.successful['0'] && j.successful['0'].key;
    if (!key) return { falha: r.status ? `respondeu ${r.status}` : r.erro || 'sem resposta' };
    const filhos = [];
    if (c.pdf) filhos.push({ itemType: 'attachment', parentItem: key, linkMode: 'linked_url', title: 'PDF', url: c.pdf, contentType: 'application/pdf', tags: [] });
    if (c.sel) filhos.push({ itemType: 'note', parentItem: key, note: `<p>${esc(c.sel)}</p>`, tags: [] });
    if (filhos.length) {
      const f = await gm({ method: 'POST', url: `${base}/items`, headers: { ...h, 'Zotero-Write-Token': token() }, data: JSON.stringify(filhos), anonymous: true, timeout: 30000 });
      const fj = f.ok && parse(f.text);
      const gravou = !!(fj && fj.successful && Object.keys(fj.successful).length === filhos.length);
      if (!gravou) {
        const oq = [c.pdf && 'o anexo PDF', c.sel && 'a nota com a seleção'].filter(Boolean);
        const g = oq.length > 1 ? 'gravados' : c.pdf ? 'gravado' : 'gravada';
        // Sem resposta: os filhos podem ter sido gravados; com status de erro, certamente não.
        avisos.push(semResposta(f) ? `item salvo; ${oq.join(' e ')} ${oq.length > 1 ? 'podem não ter sido' : 'pode não ter sido'} ${g}`
          : `item salvo; ${oq.join(' e ')} não ${oq.length > 1 ? 'foram' : 'foi'} ${g}`);
      }
    }
    const ab = await bib(key);
    return { key, abnt: ab || abntLocal(it), abntFonte: ab ? 'zotero' : 'local', faltando: falta, duplicata: false, avisos };
  }

  const DESTINOS = [['casa', 'Zotero de casa', viaCasa], ['desktop', 'Zotero desktop', viaDesktop], ['web', 'Web API (zotero.org)', viaWeb]];
  let salvando = false;
  async function salvar() {
    if (salvando) return;
    salvando = true;
    try {
      const c = captura(true);
      if (selecaoGuardada && !c.sel) c.sel = selecaoGuardada;
      selecaoGuardada = '';
      const { item } = montaItem(c);
      const col = ui.colecao();
      ui.inicio(item, c);
      const passo = (d, estado, t) => ui.passo(d, estado, t);
      let res = null;
      for (const [id, , fn] of DESTINOS) {
        let r;
        try { r = await fn(c, item, col, passo); } catch (e) { r = { falha: 'erro inesperado' }; }
        if (r && r.incerto) { passo(id, 'warn', 'sem resposta a tempo'); res = { incerto: true, destino: id }; break; }
        if (r && !r.falha) { passo(id, 'ok', r.duplicata ? 'já existia' : 'salvo'); res = { ...r, destino: id }; break; }
        passo(id, 'fail', r ? r.falha : 'sem resposta');
      }
      ui.fim(res, item);
    } catch (e) {
      ui.erro();
    } finally {
      salvando = false;
    }
  }

  // ---------------------------------------------------------------- interface
  let selecaoGuardada = '';
  const CSS = `
:host{all:initial;
  --us-font: system-ui, "Segoe UI", Roboto, "Noto Sans", sans-serif;
  --us-pass:#16a34a; --us-fail:#dc2626; --us-unknown:#64748b; --us-accent:#2563eb;
  --us-surface:#ffffff; --us-surface-2:#f3f4f6; --us-text:#111827; --us-text-2:#4b5563; --us-border:#e5e7eb;
  --us-float-bg:rgba(17,24,39,.92); --us-float-text:#f9fafb;
  --us-radius-s:6px; --us-radius-m:14px; --us-radius-pill:999px; --us-shadow:0 8px 28px rgba(0,0,0,.28);
  --us-motion:.15s; --us-target:44px; --us-z:2147483646; --us-warn-bg:#fef3c7; --us-warn-text:#78350f;}
@media (prefers-color-scheme: dark){:host{--us-surface:#1f2937; --us-surface-2:#111827; --us-text:#f9fafb; --us-text-2:#cbd5e1; --us-border:#374151;
  --us-float-bg:rgba(249,250,251,.94); --us-float-text:#111827; --us-warn-bg:#422006; --us-warn-text:#fde68a;}}
@media (prefers-reduced-motion: reduce){:host{--us-motion:0s}}
*{box-sizing:border-box;font-family:var(--us-font)}
button,select{font:inherit;color:inherit}
:focus-visible{outline:3px solid var(--us-accent);outline-offset:2px}
.pill{position:fixed;right:16px;bottom:16px;z-index:var(--us-z);width:var(--us-target);height:var(--us-target);display:flex;align-items:center;justify-content:center;
  padding:0;border:0;border-radius:var(--us-radius-pill);background:var(--us-float-bg);color:var(--us-float-text);box-shadow:var(--us-shadow);cursor:pointer;transition:transform var(--us-motion)}
.pill:hover{transform:translateY(-1px)}
.pill .dot{position:absolute;top:2px;right:2px;width:12px;height:12px;border-radius:50%;background:var(--us-unknown);box-shadow:0 0 0 2px rgba(255,255,255,.7)}
.pill .dot.ok{background:var(--us-pass)}
.pill .z{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:5px;background:#cc2936;color:#fff;font-weight:800;font-size:17px}
.painel{position:fixed;right:16px;bottom:72px;z-index:var(--us-z);width:360px;max-height:calc(100vh - 88px);overflow:auto;background:var(--us-surface);color:var(--us-text);
  border:1px solid var(--us-border);border-radius:var(--us-radius-m);box-shadow:var(--us-shadow);font-size:14px;line-height:1.45}
.painel[hidden]{display:none}
.alca{display:none}
@media (max-width:599px){
  .painel{left:0;right:0;bottom:0;width:auto;max-height:82vh;border-radius:18px 18px 0 0;font-size:15px;border-bottom:0}
  .alca{display:block;width:40px;height:5px;border-radius:3px;background:var(--us-border);margin:8px auto 0}
}
.cab{display:flex;align-items:center;gap:8px;padding:8px 6px 4px 16px}
.cab h2{flex:1;margin:0;font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.x{width:var(--us-target);height:var(--us-target);border:0;background:none;border-radius:50%;font-size:22px;cursor:pointer;color:var(--us-text-2)}
.x:hover{background:var(--us-surface-2)}
.corpo{padding:0 16px 14px}
.tipo{font-size:12px;color:var(--us-text-2);text-transform:uppercase;letter-spacing:.04em;font-weight:600}
.tit{margin:2px 0 2px;font-weight:600;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.meta{color:var(--us-text-2);font-size:13px}
.lin{display:flex;align-items:center;gap:10px;min-height:var(--us-target);border-top:1px solid var(--us-border);margin-top:10px;padding-top:4px}
.lin label{flex:0 0 auto;color:var(--us-text-2)}
.lin select{flex:1;min-width:0;height:var(--us-target);border:1px solid var(--us-border);border-radius:var(--us-radius-s);background:var(--us-surface-2);padding:0 8px}
.nota{font-size:12px;color:var(--us-text-2);margin-top:-2px}
.salvar{width:100%;height:var(--us-target);margin-top:10px;border:0;border-radius:10px;background:var(--us-accent);color:#fff;font-weight:700;font-size:15px;cursor:pointer}
.salvar[disabled]{opacity:.6;cursor:default}
.passos{list-style:none;margin:10px 0 0;padding:8px 0 0;border-top:1px solid var(--us-border);display:grid;gap:4px}
.passos li{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--us-text-2)}
.passos b{color:var(--us-text);font-weight:600}
.st{width:10px;height:10px;border-radius:50%;background:var(--us-border);flex:0 0 auto}
.st.run{background:var(--us-accent);animation:pulsa 1s infinite alternate}
.st.ok{background:var(--us-pass)}.st.fail{background:var(--us-fail)}.st.warn{background:var(--us-unknown)}
@keyframes pulsa{to{opacity:.35}}
@media (prefers-reduced-motion: reduce){.st.run{animation:none}}
.res{margin-top:10px;font-weight:700}
.res.ok{color:var(--us-pass)}.res.fail{color:var(--us-fail)}
.res.warn{margin-top:10px;padding:8px 10px;border-radius:10px;background:var(--us-warn-bg);color:var(--us-warn-text)}
.aviso{margin-top:6px;padding:6px 10px;border-radius:10px;background:var(--us-warn-bg);color:var(--us-warn-text);font-size:13px;font-weight:600}
.abnt{margin-top:6px;padding:10px 12px;border-radius:10px;background:var(--us-surface-2);border:1px solid var(--us-border);font-size:13px;line-height:1.5;word-break:break-word}
.abnt small{display:block;margin-top:6px;color:var(--us-text-2);font-size:11px}
.acoes{display:flex;gap:8px;margin-top:8px}
.acoes button,.acoes a{flex:1;display:inline-flex;align-items:center;justify-content:center;min-height:var(--us-target);border:1px solid var(--us-border);border-radius:10px;
  background:var(--us-surface);color:var(--us-text);text-decoration:none;font-weight:600;font-size:14px;cursor:pointer}
.falta{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center}
.falta span{padding:3px 10px;border-radius:var(--us-radius-pill);background:var(--us-warn-bg);color:var(--us-warn-text);font-size:12px;font-weight:600}
.falta .compl{background:none;color:var(--us-pass);padding:0}
.rodape{padding:8px 16px 12px;border-top:1px solid var(--us-border);font-size:12px;color:var(--us-text-2)}
kbd{font-family:inherit;border:1px solid var(--us-border);border-bottom-width:2px;border-radius:4px;padding:0 4px;font-size:11px}
`;

  const ui = (() => {
    let raiz = null, sh = null, pill = null, painel = null, lista = [], listaOrigem = '', colAtual = colecaoDoSite();
    // Salvamento em curso ou o último: sobrevive a fechar e reabrir o painel.
    let atual = null;
    function monta() {
      if (raiz) return;
      raiz = document.createElement('zotero-salvar');
      raiz.style.cssText = 'all:initial;position:fixed;z-index:2147483646';
      sh = raiz.attachShadow({ mode: 'closed' });
      sh.innerHTML = `<style>${CSS}</style>`;
      document.documentElement.append(raiz);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && painel && !painel.hidden) fecha(); }, true);
    }
    function mostraPilula(c) {
      monta();
      const { item } = montaItem(c);
      const completo = !faltando(item).length;
      pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'pill';
      const rot = `Salvar no Zotero · ${TIPO_PT[item.itemType]}${completo ? '' : ' (dados incompletos)'}`;
      pill.title = `${rot} — Alt+Shift+Z`;
      pill.setAttribute('aria-label', rot);
      pill.innerHTML = `<span class="z" aria-hidden="true">Z</span><span class="dot${completo ? ' ok' : ''}"></span>`;
      pill.addEventListener('pointerdown', () => { selecaoGuardada = clean(String(window.getSelection() || '')).slice(0, 5000); });
      pill.addEventListener('click', (e) => { if (!e.isTrusted) return; if (painel && !painel.hidden) fecha(); else abre(captura(true)); });
      sh.append(pill);
    }
    // Valor da opção: a chave quando a lista tem chave, senão o nome.
    const valor = (x) => (x ? x.key || x.name : '');
    function valorAtual() {
      if (!colAtual) return '';
      const x = (colAtual.key && colAtual.origem === listaOrigem && lista.find((o) => o.key === colAtual.key)) || lista.find((o) => o.name === colAtual.name);
      return x ? valor(x) : valor(colAtual);
    }
    function base(item, c) {
      monta();
      if (!painel) {
        painel = document.createElement('section');
        painel.className = 'painel';
        painel.setAttribute('role', 'dialog');
        painel.setAttribute('aria-label', 'Salvar no Zotero');
        sh.append(painel);
      }
      painel.hidden = false;
      const aut = (item.creators || []).filter((x) => x.creatorType === 'author');
      const meta = [aut.length ? (aut.length === 1 ? (aut[0].lastName || aut[0].name) : `${aut[0].lastName || aut[0].name} e mais ${aut.length - 1}`) : 'sem autor', ano(item.date) || 'sem ano', item.publicationTitle || item.websiteTitle || ''].filter(Boolean).join(' · ');
      painel.innerHTML = `<div class="alca" aria-hidden="true"></div>
<div class="cab"><h2>Zotero · ${esc(HOST)}</h2><button class="x" type="button" aria-label="Fechar">×</button></div>
<div class="corpo">
  <div class="tipo">${esc(TIPO_PT[item.itemType])}</div>
  <div class="tit">${esc(item.title || c.titulo)}</div>
  <div class="meta">${esc(meta)}</div>
  <div class="lin"><label for="zs-col">Coleção</label><select id="zs-col"><option value="">Biblioteca (sem coleção)</option></select></div>
  <div class="nota">lembrada neste site</div>
  <div class="area"></div>
</div>
<div class="rodape"><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> salva · casa → desktop → Web API</div>`;
      painel.querySelector('.x').addEventListener('click', fecha);
      const sel = painel.querySelector('select');
      const preenche = () => {
        sel.innerHTML = '<option value="">Biblioteca (sem coleção)</option>' + lista.map((x) => `<option value="${esc(valor(x))}">${'  '.repeat(x.nivel || 0)}${esc(x.name)}</option>`).join('');
        const v = valorAtual();
        if (v && !lista.some((x) => valor(x) === v)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(v)}">${esc(colAtual.name)}</option>`);
        sel.value = v;
      };
      preenche();
      sel.addEventListener('change', () => {
        const x = lista.find((o) => valor(o) === sel.value);
        if (x) colAtual = { key: x.key || '', name: x.name, origem: listaOrigem };
        else if (!sel.value) colAtual = null;
        guardaColecao(colAtual);
      });
      if (!lista.length) {
        listaColecoes().then((l) => {
          if (l && l.itens && l.itens.length) {
            lista = l.itens; listaOrigem = l.origem;
            const s = painel && !painel.hidden && painel.querySelector('select');
            if (s === sel) preenche();
          }
        }).catch(() => { /* fica só a biblioteca */ });
      }
      return painel.querySelector('.area');
    }
    function previa(c) {
      const { item } = montaItem(c);
      const area = base(item, c);
      const f = faltando(item);
      area.innerHTML = `<div class="falta">${f.length ? `<span class="tipo" style="background:none;padding:0">pela página, falta:</span>${f.map((x) => `<span>${esc(x)}</span>`).join('')}` : '<span class="compl">✓ dados completos para a ABNT</span>'}</div>
<button class="salvar" type="button">Salvar no Zotero</button>`;
      area.querySelector('.salvar').addEventListener('click', (e) => { if (e.isTrusted) salvar(); });
    }
    // Reabrir durante o salvamento mostra o progresso; depois dele, o resultado (ou o erro) desta mesma página.
    function abre(c) {
      if (atual && (atual.fase === 'salvando' || ((atual.fase === 'fim' || atual.fase === 'erro') && atual.url === location.href))) desenha();
      else previa(c);
    }
    function desenha() {
      const area = base(atual.item, atual.c);
      if (atual.fase === 'erro') {
        area.innerHTML = '<div class="saida" aria-live="polite"></div>';
        pintaErro();
        return;
      }
      area.innerHTML = `<ul class="passos">${DESTINOS.map(([id, nome]) => `<li data-d="${id}"><span class="st"></span><b>${nome}</b><span class="m"></span></li>`).join('')}</ul><div class="saida" aria-live="polite"></div>`;
      for (const [d, [estado, t]] of Object.entries(atual.passos)) pintaPasso(d, estado, t);
      if (atual.fase === 'fim') pintaFim();
    }
    function inicio(item, c) {
      atual = { item, c, url: location.href, passos: {}, fase: 'salvando', res: null };
      desenha();
    }
    function pintaPasso(d, estado, t) {
      const li = painel && painel.querySelector(`li[data-d="${d}"]`);
      const st = li && li.querySelector('.st'), m = li && li.querySelector('.m');
      if (!st || !m) return;
      st.className = `st ${estado}`;
      m.textContent = t ? `— ${t}` : estado === 'run' ? '— tentando…' : '';
    }
    function passo(d, estado, t) {
      if (atual) atual.passos[d] = [estado, t];
      pintaPasso(d, estado, t);
    }
    const INCERTO = { casa: 'O Zotero de casa', desktop: 'O Zotero desktop', web: 'A Web API (zotero.org)' };
    function pintaFim() {
      const out = painel && painel.querySelector('.saida');
      if (!out || !atual) return;
      const r = atual.res, item = atual.item;
      if (!r) { out.innerHTML = '<div class="res fail">Não salvou em nenhum destino.</div><div class="nota">Confira o Zotero de casa, abra o Zotero desktop ou configure a chave da Web API no menu do gerenciador.</div>'; return; }
      if (r.incerto) { out.innerHTML = `<div class="res warn">${esc(INCERTO[r.destino] || 'O Zotero')} não respondeu a tempo; confira a biblioteca antes de salvar de novo.</div>`; return; }
      const salvo = { casa: 'no Zotero de casa', desktop: 'no Zotero desktop', web: 'pela Web API (zotero.org)' };
      const existia = { casa: 'no Zotero de casa', desktop: 'no Zotero desktop', web: 'na biblioteca do zotero.org' };
      const usuario = gv('zotero_username', '');
      const link = r.destino === 'web' && r.key && usuario ? `https://www.zotero.org/${encodeURIComponent(usuario)}/items/${encodeURIComponent(r.key)}` : '';
      const f = r.faltando || [];
      const local = r.abntFonte === 'local' || !r.abnt;
      out.innerHTML = `<div class="res ok">${r.duplicata ? `Já existia ${esc(existia[r.destino])}: nada foi criado.` : `Salvo ${esc(salvo[r.destino])}.`}</div>
${(r.avisos || []).map((a) => `<div class="aviso">${esc(a)}</div>`).join('')}
<div class="abnt"><span class="ref">${r.abnt || abntLocal(item)}</span><small>ABNT ${local ? 'montada aqui com os dados da página' : 'formatada pelo Zotero'}</small></div>
<div class="falta">${f.length ? `<span class="tipo" style="background:none;padding:0">falta:</span>${f.map((x) => `<span>${esc(x)}</span>`).join('')}` : '<span class="compl">✓ referência completa</span>'}</div>
<div class="acoes"><button type="button" class="cp">Copiar ABNT</button>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">Abrir no Zotero</a>` : ''}</div>`;
      const cp = out.querySelector('.cp');
      cp.addEventListener('click', async (e) => {
        if (!e.isTrusted) return;
        const el = out.querySelector('.ref');
        try {
          if (window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([el.innerHTML], { type: 'text/html' }), 'text/plain': new Blob([el.textContent], { type: 'text/plain' }) })]);
          else await navigator.clipboard.writeText(el.textContent);
          cp.textContent = 'Copiada ✓';
        } catch (e) { cp.textContent = 'Selecione e copie'; }
      });
    }
    function fim(r, item) {
      if (!atual) atual = { item, c: { titulo: clean(document.title) }, url: location.href, passos: {} };
      atual.res = r; atual.item = item || atual.item; atual.fase = 'fim';
      pintaFim();
    }
    function pintaErro() {
      const out = painel && painel.querySelector('.saida');
      if (out) out.innerHTML = '<div class="res fail">Erro inesperado: nada foi salvo. Tente de novo.</div>';
    }
    function erro() {
      atual = { item: { itemType: 'document' }, c: { titulo: clean(document.title) }, url: location.href, passos: {}, fase: 'erro', res: null };
      desenha();
    }
    function fecha() { if (painel) painel.hidden = true; }
    const colecao = () => colAtual;
    return { mostraPilula, abre, inicio, passo, fim, erro, fecha, colecao };
  })();

  // ---------------------------------------------------------------- gatilhos
  document.addEventListener('keydown', (e) => {
    if (!e.isTrusted) return; // só teclas reais: a página não dispara gravação
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyZ') { e.preventDefault(); e.stopPropagation(); salvar(); }
  }, true);

  try {
    GM_registerMenuCommand('Salvar no Zotero (Alt+Shift+Z)', salvar);
    GM_registerMenuCommand('Configurar chave da Web API', async () => {
      const v = window.prompt('Chave privada da Web API do Zotero (zotero.org/settings/keys). Fica só neste aparelho. Deixe vazio para apagar.', '');
      if (v === null) return;
      const k = clean(v);
      sv('zotero_key', k); sv('zotero_user', ''); sv('zotero_username', '');
      if (!k) { window.alert('Chave apagada deste aparelho.'); return; }
      const cr = await credenciais();
      if (cr && !cr.erro) window.alert('Chave aceita pelo zotero.org.');
      else if (cr && cr.erro === 'chave recusada') window.alert('O zotero.org recusou a chave. Ela ficou guardada; confira e configure de novo.');
      else window.alert(`Não deu para conferir a chave (${cr ? cr.erro : 'sem chave'}). Ela ficou guardada; o script tenta de novo ao salvar.`);
    });
    GM_registerMenuCommand('Mostrar/ocultar a pílula neste site', () => {
      const m = gv('sem_pilula', {}) || {};
      if (m[HOST]) delete m[HOST]; else m[HOST] = true;
      sv('sem_pilula', m);
      window.alert(m[HOST] ? 'Pílula oculta neste site. Alt+Shift+Z continua salvando.' : 'Pílula de volta neste site (recarregue a página).');
    });
  } catch (e) { /* gerenciador sem menu */ }

  const inicial = captura(false);
  if (academica(inicial) && !(gv('sem_pilula', {}) || {})[HOST]) ui.mostraPilula(inicial);
})();
