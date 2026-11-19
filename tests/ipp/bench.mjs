// Roda o userscript (release candidate) no Node com GM_* de bancada contra a
// impressora IPP de bancada. Mostra o caminho feliz e cada recusa da ponte.
import fs from 'node:fs';
// 3º argumento opcional: pathname da página (o News Reader é SPA por hash e pode estar sob /reader/).
const [,, script, port, pathname = '/'] = process.argv;
const store = {}; const calls = []; const events = new EventTarget(); const capture = { click: [], keydown: [] };
globalThis.location = { href: `http://127.0.0.1:${port}${pathname}#/bookmarks`, origin: `http://127.0.0.1:${port}`, host: '127.0.0.1', pathname };
globalThis.document = { documentElement: { dataset: {} },
  addEventListener: (t, f, cap) => (cap && capture[t] ? capture[t].push(f) : events.addEventListener(t, f)),
  dispatchEvent: (e) => events.dispatchEvent(e) };
globalThis.CustomEvent = class extends Event { constructor(t, o) { super(t); this.detail = o && o.detail; } };
globalThis.GM_getValue = (k, d) => (k in store ? store[k] : d);
globalThis.GM_setValue = (k, v) => { store[k] = v; };
globalThis.GM_registerMenuCommand = () => {};
globalThis.GM_xmlhttpRequest = (o) => {
  // Como no gerenciador: erro de rede vai ao onerror; exceção dentro do onload NÃO vira onerror.
  // data pode ser Blob (o fetch aceita); finalUrl = endereço depois de redirecionamentos.
  if (o.data !== undefined && !(o.data instanceof Blob) && typeof o.data !== 'string') throw new Error('data inesperado no GM_xmlhttpRequest');
  calls.push({ method: o.method, anonymous: o.anonymous === true, blob: o.data instanceof Blob, type: o.data instanceof Blob ? o.data.type : null });
  fetch(o.url, { method: o.method, body: o.data, headers: o.headers }).then(async (r) => ({ status: r.status, response: await r.arrayBuffer(),
    finalUrl: r.url, responseHeaders: [...r.headers].map(([k, v]) => k + ': ' + v).join('\r\n') }), () => null)
    .then((r) => setTimeout(() => (r ? o.onload(r) : o.onerror()), 0));
};
new Function(fs.readFileSync(script, 'utf8'))();
// Gesto do dono: o navegador entrega isTrusted=true; um script da página, não.
const gesture = (where, trusted = true) => capture.click.forEach((f) => f({ type: 'click', isTrusted: trusted,
  target: { closest: (sel) => (sel.includes(where) ? {} : null) } }));
const wait = (type) => new Promise((res) => events.addEventListener(type, (e) => res(JSON.parse(e.detail)), { once: true }));
const send = (type, d) => document.dispatchEvent(new CustomEvent(type, { detail: JSON.stringify(d) }));
const ask = async (type, d, reply) => { const p = wait(reply); send(type, d); return p; };
const uri = `ipp://127.0.0.1:${port}/ipp/print`;
const log = (k, v) => console.log(k.padEnd(34), JSON.stringify(v));

if (pathname !== '/') {   // bancada curta da base: só o que muda com o pathname
  gesture('#settings-print');
  await ask('nr-print:save', { device: { label: 'Base', printers: [{ name: 'Bancada', uri }], default_printer: 'Bancada' } }, 'nr-print:helper');
  gesture('[data-print-split]');
  log('job sob a base', await ask('nr-print:job', { seq: 1, pdf_url: pathname.replace(/\/+$/, '') + '/api/print/bookmarks/1.pdf' }, 'nr-print:result'));
  gesture('[data-print-split]');
  log('job fora da base', await ask('nr-print:job', { seq: 2, pdf_url: '/api/print/bookmarks/1.pdf' }, 'nr-print:result'));
  process.exit(0);
}

log('probe sem gesto', await ask('nr-print:probe', { uri }, 'nr-print:probed'));
gesture('#settings-print');
log('probe http:// (não ipp)', await ask('nr-print:probe', { uri: 'http://127.0.0.1:' + port + '/' }, 'nr-print:probed'));
log('probe ipp com gesto', await ask('nr-print:probe', { uri }, 'nr-print:probed'));
log('probe segundo com o mesmo gesto', await ask('nr-print:probe', { uri }, 'nr-print:probed'));
const probeAt = async (path) => { gesture('#settings-print'); return ask('nr-print:probe', { uri: uri.replace('/print', path) }, 'nr-print:probed'); };
log('probe resposta truncada', await probeAt('/lixo'));
log('probe só cabeçalho (8 bytes)', await probeAt('/so-cabecalho'));
log('probe sem a tag de fim', await probeAt('/sem-fim'));
log('probe request-id diferente', await probeAt('/outro-id'));
log('probe versão 9', await probeAt('/versao-9'));
log('probe inteiro com 2 bytes', await probeAt('/inteiro-curto'));
log('probe comprimento estoura', await probeAt('/estoura'));
gesture('#settings-print');
log('probe com usuário no host', await ask('nr-print:probe', { uri: `ipp://u:p@127.0.0.1:${port}/ipp/print` }, 'nr-print:probed'));
log('probe IPv6', await ask('nr-print:probe', { uri: 'ipp://[fe80::1]/' }, 'nr-print:probed'));
const dev = { label: 'PC de teste', printers: [{ name: 'Bancada', uri }, { name: 'Ruim', uri: 'javascript:alert(1)' },
  { name: 'Com usuário', uri: `ipp://u:p@127.0.0.1:${port}/` }, { name: 'IPv6', uri: 'ipp://[fe80::1]/' }], default_printer: 'Bancada' };
await new Promise((r) => setTimeout(r, 5200));   // o gesto anterior expira (5 s)
gesture('#settings-print', false);   // clique sintético da página: isTrusted=false, não conta
log('save sem gesto confiável', await (async () => { const p = Promise.race([wait('nr-print:refused'), wait('nr-print:helper')]); send('nr-print:save', { device: dev }); return p; })());
gesture('#settings-print');
log('save com gesto (lista revalidada)', (await ask('nr-print:save', { device: dev }, 'nr-print:helper')).device);
log('save segundo com o mesmo gesto', await (async () => { const p = Promise.race([wait('nr-print:refused'), wait('nr-print:helper')]); send('nr-print:save', { device: dev }); return p; })());
log('job sem clique no Imprimir', await ask('nr-print:job', { seq: 1, pdf_url: '/api/print/bookmarks/1.pdf' }, 'nr-print:result'));
gesture('[data-print-split]');
log('job pdf de outra origem', await ask('nr-print:job', { seq: 2, pdf_url: 'https://outro.example/api/print/x.pdf' }, 'nr-print:result'));
gesture('[data-print-split]');
log('job fora de /api/print/', await ask('nr-print:job', { seq: 3, pdf_url: '/api/bookmarks/export' }, 'nr-print:result'));
gesture('[data-print-split]');
log('job resposta não-PDF', await ask('nr-print:job', { seq: 4, pdf_url: '/api/print/nao-pdf.pdf' }, 'nr-print:result'));
gesture('[data-print-split]');
log('job válido', await ask('nr-print:job', { seq: 5, pdf_url: '/api/print/bookmarks/1.pdf?mode=booklet-borderless', title: 'Conselho propõe perda de cargo', mode: 'booklet-borderless' }, 'nr-print:result'));
log('mesmo clique, segundo job', await ask('nr-print:job', { seq: 6, pdf_url: '/api/print/bookmarks/1.pdf' }, 'nr-print:result'));
gesture('[data-print-split]');
log('job redirecionado para fora', await ask('nr-print:job', { seq: 8, pdf_url: '/api/print/redireciona.pdf' }, 'nr-print:result'));
gesture('[data-print-split]');
log('job título longo acentuado', await ask('nr-print:job', { seq: 9, pdf_url: '/api/print/bookmarks/2.pdf', title: 'Ação já é exceção. '.repeat(30) }, 'nr-print:result'));
gesture('[data-print-split]');
log('impressora não cadastrada', await ask('nr-print:job', { seq: 7, pdf_url: '/api/print/bookmarks/1.pdf', printer: 'Inexistente' }, 'nr-print:result'));
log('chamadas GM_xmlhttpRequest', calls);
