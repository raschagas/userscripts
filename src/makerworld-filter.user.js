// ==UserScript==
// @name         MakerWorld — filtros e modelos ocultos
// @namespace    raschagas/userscripts
// @version      1.0.0
// @description  Oculta modelos e criadores, filtra títulos e popularidade e aciona o carregamento nativo. Integração experimental.
// @match        https://makerworld.com/*
// @match        https://www.makerworld.com/*
// @exclude      *://camara.leg.br/*
// @exclude      *://*.camara.leg.br/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/raschagas/userscripts/main/src/makerworld-filter.user.js
// @updateURL    https://raw.githubusercontent.com/raschagas/userscripts/main/src/makerworld-filter.user.js
// ==/UserScript==

(() => {
  'use strict';
  if (!/^(www\.)?makerworld\.com$/.test(location.hostname) || window.top !== window.self || document.getElementById('us-mw')) return;
  const KEY = 'makerworld:v1';
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const defaults = {enabled:true, words:'', likes:0, downloads:0, hide:false, auto:true, models:[], creators:[]};
  let stored;
  try { stored = GM_getValue(KEY, {}); if (typeof stored === 'string') stored = JSON.parse(stored); } catch (_) {}
  const cfg = {...defaults};
  if (stored && typeof stored === 'object') {
    for (const k of ['enabled','hide','auto']) if (typeof stored[k] === 'boolean') cfg[k] = stored[k];
    for (const k of ['likes','downloads']) if (Number.isFinite(stored[k]) && stored[k] >= 0) cfg[k] = Math.min(100000, stored[k]);
    if (typeof stored.words === 'string') cfg.words = stored.words.slice(0,10000);
    for (const k of ['models','creators']) if (Array.isArray(stored[k])) cfg[k] = stored[k].filter(x => x && /^\d+$/.test(x.id) && typeof x.name === 'string').map(x => ({id:x.id,name:x.name.slice(0,200)}));
  }
  let host, ui, style, observer, interval, scheduled = 0, active = false, undo = null, records = new Map(), url = location.href;
  let seen = new Set(), pending = null, misses = 0, pause = '', nextLoad = 0, storageError = false;
  const save = () => { try { GM_setValue(KEY, cfg); storageError = false; } catch (_) { storageError = true; } };
  const own = e => e?.nodeType === 1 && (e.closest?.('#us-mw,[data-us-mw]'));
  const qs = s => ui.querySelector(s);
  function idOf(a, kind) {
    try { const u = new URL(a.getAttribute('href'), location.href); if (u.origin !== location.origin) return null;
      const m = u.pathname.match(kind === 'models' ? /^\/[a-z-]+\/models\/(\d+)(?:[-/]|$)/i : /^\/[a-z-]+\/(@|u\/)(\d+)(?:[-/]|$)/i);
      return m ? m[kind === 'models' ? 1 : 2] : null;
    } catch (_) { return null; }
  }
  function count(raw) {
    const s = norm(raw).replace(/\s+/g,'').replace(/\+$/,'');
    const m = s.match(/^(\d+(?:[.,]\d+)*)(k|mil|m)?$/);
    if (!m) return null;
    if (!m[2] && !/^(?:\d+|\d{1,3}(?:[.,]\d{3})+)$/.test(m[1])) return null;
    const n = m[2] ? Number(m[1].replace(',','.')) * (m[2] === 'm' ? 1e6 : 1e3) : Number(m[1].replace(/[.,]/g,''));
    return Number.isFinite(n) ? n : null;
  }
  function metric(card, kind) {
    // Only explicitly labelled metrics. Bare icon-adjacent numbers are ambiguous.
    const word = kind === 'likes' ? '(?:likes?|curtidas?)' : '(?:downloads?|baixados?|transferencias?)';
    const before = new RegExp('^([\\d.,]+\\s*(?:k|mil|m)?\\+?)\\s*'+word+'$','i');
    const after = new RegExp('^'+word+'\\s*:?\\s*([\\d.,]+\\s*(?:k|mil|m)?\\+?)$','i');
    for (const e of card.querySelectorAll('[aria-label],[title],span,button')) {
      if (own(e)) continue;
      for (const raw of [e.getAttribute('aria-label'), e.getAttribute('title'), e.children.length ? null : e.textContent]) {
        if (!raw) continue; const m = norm(raw.trim()).match(before) || norm(raw.trim()).match(after); if (m) return count(m[1]);
      }
    }
    return null;
  }
  function extract(card) {
    if (card.closest('nav,header,footer,[contenteditable="true"]')) return null;
    const links = [...card.querySelectorAll('a[href]')].filter(a => !own(a));
    const models = links.map(a => idOf(a,'models')).filter(Boolean);
    if (new Set(models).size !== 1) return null;
    const link = links.find(a => idOf(a,'models') === models[0] && a.textContent.trim());
    const photo = card.querySelector('img'); if (!link || !photo) return null;
    const title = (card.querySelector('.design-bottom-row .translated-text a,h3,h2')?.textContent || link.textContent).trim();
    const creators = links.filter(a => idOf(a,'creators'));
    const creator = new Set(creators.map(a=>idOf(a,'creators'))).size === 1 ? creators[0] : null;
    return {id:models[0], title, photo, creator:creator ? idOf(creator,'creators') : null, creatorName:creator?.textContent.trim() || '', likes:metric(card,'likes'), downloads:metric(card,'downloads')};
  }
  function unmark(card, r) {
    r.box.remove(); r.dot.remove(); card.classList.remove('us-mw-card','us-mw-rel','us-mw-fail','us-mw-hidden');
  }
  function hide(kind, id, name) {
    if (!id || cfg[kind].some(x=>x.id === id)) return;
    cfg[kind].push({id,name}); undo = {kind,id}; save(); scan(); qs('#undo').focus();
  }
  function button(text, fn) {
    const b = document.createElement('button'); b.type='button'; b.textContent=text;
    b.onclick = e => { e.preventDefault(); e.stopPropagation(); fn(); }; return b;
  }
  function mark(card, d) {
    let r = records.get(card);
    if (r && r.id !== d.id) { unmark(card,r); records.delete(card); r=null; }
    if (!r) {
      const box=document.createElement('span');box.dataset.usMw='';box.className='us-mw-actions';
      const dot=document.createElement('span');dot.dataset.usMw='';dot.className='us-mw-dot';dot.setAttribute('role','img');
      box.addEventListener('click', e => { if (e.target.closest('summary')) { e.preventDefault(); e.stopPropagation(); const details=e.target.closest('details'); details.open=!details.open; } });
      card.append(dot,box);r={id:d.id,box,dot,creator:undefined};records.set(card,r);
    }
    // Rebuild only when identity changes, retaining open/focused controls on routine scans.
    if (r.creator !== d.creator) {
      r.creator=d.creator;r.box.replaceChildren();
      const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Ocultar';
      details.append(summary,button('Este modelo',()=>hide('models',r.id,r.title)));
      if(d.creator) details.append(button('Este criador',()=>hide('creators',r.creator,r.creatorName)));
      r.box.append(details);
    }
    r.title=d.title;r.creatorName=d.creatorName;
    card.classList.add('us-mw-card'); if (getComputedStyle(card).position==='static') card.classList.add('us-mw-rel');
    const words=cfg.words.split('\n').map(x=>norm(x.trim())).filter(Boolean);
    const fail=words.some(w=>norm(d.title).includes(w)) || (d.likes!==null && d.likes<cfg.likes) || (d.downloads!==null && d.downloads<cfg.downloads);
    const hidden=cfg.models.some(x=>x.id===d.id)||cfg.creators.some(x=>x.id===d.creator)||(cfg.hide&&fail);
    // Remove display:none temporarily only for geometry; restore synchronously before paint.
    card.classList.remove('us-mw-hidden');
    const c=card.getBoundingClientRect(),p=d.photo.getBoundingClientRect();
    r.dot.style.top=`${p.top-c.top+12}px`;r.dot.style.left=`${p.left-c.left+12}px`;
    const verdict=fail?'fail':d.likes===null&&d.downloads===null?'unknown':'pass';
    r.dot.dataset.verdict=verdict;
    r.dot.setAttribute('aria-label',`${fail?'Reprovado':verdict==='unknown'?'Sem dados':'Aprovado'} · curtidas: ${d.likes??'sem dados'} · downloads: ${d.downloads??'sem dados'}`);
    r.dot.title=r.dot.getAttribute('aria-label');
    card.classList.toggle('us-mw-fail',fail&&!hidden);card.classList.toggle('us-mw-hidden',hidden);
    return {hidden,fail,id:d.id};
  }
  function resetLoading() { seen=new Set();pending=null;misses=0;pause='';nextLoad=Date.now()+1500; }
  function scan() {
    if (!active) return;
    observer.disconnect();
    if (url!==location.href) { url=location.href; for(const [c,r] of records)unmark(c,r);records.clear();resetLoading(); }
    const valid=new Map();
    // Semantic card fallback only; never walk upward into an unknown grid wrapper.
    for(const card of document.querySelectorAll('.js-design-card,article')) {
      if (card.querySelector('.js-design-card,article')) continue;
      const d=extract(card);if(d)valid.set(card,d);
    }
    for(const [c,r] of records) if(!valid.has(c)){unmark(c,r);records.delete(c);}
    const result=[...valid].map(([c,d])=>mark(c,d));
    const fresh=result.filter(x=>!seen.has(x.id)); result.forEach(x=>seen.add(x.id));
    if(pending && fresh.length){misses=fresh.some(x=>!x.hidden)?0:misses+1;pending=null;nextLoad=Date.now()+1500;if(misses>=3)pause='Três lotes sem modelos visíveis.';}
    if(pending && Date.now()-pending.since>12000){pending=null;pause='Carregamento sem novos modelos. Confira a página e tente novamente.';}
    const hidden=result.filter(x=>x.hidden).length,failed=result.filter(x=>x.fail).length;
    qs('.pill').textContent=`${failed} reprovados · ${hidden} ocultos`;
    qs('#counts').textContent=`${result.length} cartões reconhecidos · integração experimental`;
    qs('#load-status').textContent=storageError?'Não foi possível salvar: ajustes só nesta visita.':pause || (pending?'Carregando…':cfg.auto?'Carregamento nativo assistido ligado.':'Carregamento assistido desligado.');
    qs('#continue').hidden=!pause;qs('#undo').disabled=!undo;
    updateRestore();
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['href','src','aria-label','title','class','disabled','aria-busy']});
    loadMore();
  }
  function loadMore() {
    if(!active||!cfg.auto||pause||pending||Date.now()<nextLoad||document.visibilityState==='hidden'||!records.size)return;
    const main=document.querySelector('main');if(!main)return;
    if(document.querySelector('#challenge-running,#challenge-form,iframe[src*="challenges.cloudflare.com"]') || [...main.querySelectorAll('[role="alert"]')].some(e=>/error|erro|try again|tente novamente/i.test(e.textContent))) {pause='A página exige atenção. Carregamento pausado.';return;}
    if(main.querySelector('[aria-busy="true"],[role="progressbar"]'))return;
    const buttons=[...main.querySelectorAll('button')].filter(b=>!own(b)&&!b.closest('.js-design-card,article,nav,form,[role="dialog"]')&&!b.disabled&&b.getAttribute('aria-disabled')!=='true'&&/^(load more|show more models|carregar mais|mostrar mais modelos)$/i.test(b.textContent.trim())&&b.getClientRects().length);
    if(buttons.length!==1)return;
    const b=buttons[0],rect=b.getBoundingClientRect();
    if(rect.top>innerHeight+400 || rect.bottom<0)return;
    pending={since:Date.now()};nextLoad=Date.now()+1500;b.click();
  }
  function schedule(){if(active&&!scheduled)scheduled=setTimeout(()=>{scheduled=0;scan();},200);}
  function updateRestore(){
    const query=norm(qs('#search').value),container=qs('#restore');
    const entries=['models','creators'].flatMap(kind=>cfg[kind].filter(x=>norm(x.name+' '+x.id).includes(query)).map(x=>({kind,...x})));
    const signature=JSON.stringify(entries);
    if(container.dataset.signature===signature)return;
    container.dataset.signature=signature;container.replaceChildren();
    for(const e of entries)container.append(button(`Restaurar ${e.kind==='models'?'modelo':'criador'}: ${e.name || e.id}`,()=>{cfg[e.kind]=cfg[e.kind].filter(x=>x.id!==e.id);save();scan();}));
    if(!entries.length)container.textContent='Nenhum oculto nesta busca.';
  }
  const CSS = `
:host{all:initial;font:15px var(--us-font);color:var(--us-text)}*{box-sizing:border-box}[hidden]{display:none!important}
button,input,textarea,summary{font:inherit}button,summary{min-height:44px;cursor:pointer}button{background:var(--us-surface-2);color:var(--us-text);border:1px solid var(--us-border);border-radius:6px;padding:8px 12px}button:disabled{cursor:default;opacity:.55}button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--us-accent);outline-offset:2px}
.pill{position:fixed;bottom:16px;right:16px;border:0;border-radius:999px;background:var(--us-float-bg);color:var(--us-float-text);box-shadow:var(--us-shadow)}.pill::before{content:'●';color:var(--us-unknown);margin-right:8px}
.panel{position:fixed;bottom:72px;right:16px;width:340px;max-height:calc(100dvh - 96px);overflow:auto;padding:16px;border-radius:14px;background:var(--us-surface);box-shadow:var(--us-shadow)}h2{font:600 18px var(--us-font);margin:0 0 8px}p{font-size:13px;line-height:1.5;color:var(--us-text-2)}label{display:block;padding:10px 0;border-bottom:1px solid var(--us-border)}textarea,input[type=search]{width:100%;background:var(--us-surface-2);color:var(--us-text);border:1px solid var(--us-border);border-radius:6px;padding:8px}input[type=range]{width:100%;height:44px;accent-color:var(--us-accent)}output{float:right}input[type=checkbox]{width:20px;height:20px;vertical-align:middle;margin:0 8px 0 0}#restore button{display:block;width:100%;margin:6px 0;text-align:left}#restore{max-height:220px;overflow:auto}.actions{display:flex;gap:8px;flex-wrap:wrap}
@media(max-width:599px){.panel{bottom:0;right:0;width:100%;max-height:85dvh;border-radius:18px 18px 0 0;padding:16px 16px max(16px,env(safe-area-inset-bottom));font-size:15px}.panel::before{content:'';display:block;width:40px;height:5px;margin:0 auto 12px;border-radius:4px;background:var(--us-border)}}`;
  const CARD_CSS=`.us-mw-rel{position:relative!important}.us-mw-hidden{display:none!important}.us-mw-fail::after{content:'';position:absolute;inset:0;background:var(--us-veil);pointer-events:none;z-index:1;border-radius:inherit}.us-mw-dot{position:absolute;width:16px;height:16px;box-sizing:content-box;border:2px solid white;border-radius:50%;box-shadow:0 1px 4px #0005;z-index:2;background:var(--us-unknown)}.us-mw-dot[data-verdict=pass]{background:var(--us-pass)}.us-mw-dot[data-verdict=fail]{background:var(--us-fail)}.us-mw-actions{position:absolute;right:8px;top:8px;z-index:3;font:14px var(--us-font);color:var(--us-text);max-width:calc(100% - 48px)}.us-mw-actions details{background:var(--us-surface);border-radius:6px;box-shadow:var(--us-shadow)}.us-mw-actions summary,.us-mw-actions button{box-sizing:border-box;min-height:44px;padding:12px;cursor:pointer;font:inherit;color:var(--us-text)}.us-mw-actions button{display:block;width:100%;border:0;background:var(--us-surface);text-align:left}.us-mw-actions summary:focus-visible,.us-mw-actions button:focus-visible{outline:2px solid var(--us-accent)}@media(hover:hover){.us-mw-fail:hover::after{opacity:0}}`;
  // TOKENS inserted below from the repository's existing UI contract.
  const TOKENS = ":root{--us-font:system-ui,\"Segoe UI\",Roboto,\"Noto Sans\",sans-serif;--us-pass:#16a34a;--us-fail:#dc2626;--us-unknown:#64748b;--us-accent:#2563eb;--us-surface:#ffffff;--us-surface-2:#f3f4f6;--us-text:#111827;--us-text-2:#4b5563;--us-border:#e5e7eb;--us-float-bg:rgba(17,24,39,.92);--us-float-text:#f9fafb;--us-chip-bg:rgba(17,24,39,.85);--us-radius-s:6px;--us-radius-m:14px;--us-radius-pill:999px;--us-shadow:0 8px 28px rgba(0,0,0,.28);--us-motion:.15s;--us-gap:12px;--us-dot:16px;--us-target:44px;--us-veil:rgba(255,255,255,.55);--us-z:2147483646;--us-svc-jellyfin:#0077a8;--us-svc-seerr:#4f46e5;--us-svc-mealie:#b45309;--us-svc-skyscanner:#0062e3;--us-svc-gflights:#1a73e8}\n@media (prefers-color-scheme:dark){:root{--us-surface:#1f2937;--us-surface-2:#111827;--us-text:#f9fafb;--us-text-2:#cbd5e1;--us-border:#374151;--us-float-bg:rgba(249,250,251,.94);--us-float-text:#111827}}\n@media (prefers-reduced-motion:reduce){:root{--us-motion:0s}}";
  function start(){
    if(active)return;active=true;url=location.href;resetLoading();
    style=document.createElement('style');style.id='us-mw-style';style.textContent=TOKENS+CARD_CSS;document.head.append(style);
    host=document.createElement('div');host.id='us-mw';host.style.cssText='position:relative;z-index:2147483646';ui=host.attachShadow({mode:'open'});
    ui.innerHTML=`<style>${CSS}</style><button class="pill" aria-expanded="false" aria-controls="panel">MakerWorld</button><section class="panel" id="panel" aria-label="Filtros MakerWorld" hidden><h2>Filtro · MakerWorld</h2><p id="counts"></p><p>Validado com dados de teste; o layout real pode não ser reconhecido. Ajustes só neste dispositivo.</p><label>Palavras no título (uma por linha)<textarea id="words" rows="3" maxlength="10000"></textarea></label><label>Curtidas mínimas <output id="likes-value"></output><input id="likes" type="range" min="0" max="100000" step="1"></label><label>Downloads mínimos <output id="downloads-value"></output><input id="downloads" type="range" min="0" max="100000" step="1"></label><label><input id="hide" type="checkbox">Ocultar reprovados (desligado: véu)</label><label><input id="auto" type="checkbox">Carregar mais automaticamente</label><p id="load-status" role="status"></p><button id="continue" hidden>Continuar</button><div class="actions"><button id="undo">Desfazer ocultamento</button><button id="close">Fechar</button></div><details><summary>Restaurar modelos e criadores</summary><label>Buscar nome ou ID<input id="search" type="search"></label><div id="restore"></div></details><p>Verde: aprovado · vermelho: reprovado · cinza: sem dados. Dados ausentes não reprovam.</p><button id="off">Desligar neste site</button></section>`;
    document.body.append(host);
    const close=()=>{qs('.panel').hidden=true;qs('.pill').setAttribute('aria-expanded','false');qs('.pill').focus();};
    qs('.pill').onclick=()=>{const open=qs('.panel').hidden;qs('.panel').hidden=!open;qs('.pill').setAttribute('aria-expanded',String(open));if(open)qs('#words').focus();};
    qs('#close').onclick=close;ui.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}});
    for(const k of ['words','likes','downloads','hide','auto']){
      const el=qs('#'+k);if(typeof cfg[k]==='boolean')el.checked=cfg[k];else el.value=cfg[k];
      if(['likes','downloads'].includes(k))qs('#'+k+'-value').textContent=cfg[k].toLocaleString('pt-BR');
      el.oninput=()=>{cfg[k]=typeof defaults[k]==='boolean'?el.checked:typeof defaults[k]==='number'?Number(el.value):el.value;save();if(['likes','downloads'].includes(k))qs('#'+k+'-value').textContent=cfg[k].toLocaleString('pt-BR');if(k==='auto'&&!cfg.auto)pending=null;scan();};
    }
    qs('#continue').onclick=()=>{pause='';misses=0;nextLoad=0;scan();};
    qs('#search').oninput=updateRestore;
    qs('#undo').onclick=()=>{if(undo){cfg[undo.kind]=cfg[undo.kind].filter(x=>x.id!==undo.id);undo=null;save();scan();}};
    qs('#off').onclick=()=>{cfg.enabled=false;save();stop();};
    observer=new MutationObserver(changes=>{if(changes.some(c=>!own(c.target)))schedule();});
    window.addEventListener('scroll',schedule,{passive:true,capture:true});window.addEventListener('resize',schedule);document.addEventListener('click',outside);
    interval=setInterval(schedule,1000);scan();
  }
  function outside(e){if(e.isTrusted&&active&&!e.composedPath().includes(host)&&!qs('.panel').hidden){qs('.panel').hidden=true;qs('.pill').setAttribute('aria-expanded','false');}}
  function stop(){active=false;observer?.disconnect();clearInterval(interval);clearTimeout(scheduled);scheduled=0;pending=null;window.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);document.removeEventListener('click',outside);for(const[c,r]of records)unmark(c,r);records.clear();host?.remove();style?.remove();}
  try{GM_registerMenuCommand('Ligar/desligar filtro MakerWorld',()=>{cfg.enabled=!cfg.enabled;save();if(cfg.enabled)start();else stop();});GM_registerMenuCommand('Abrir ajustes MakerWorld',()=>{if(!cfg.enabled){cfg.enabled=true;save();start();}qs('.panel').hidden=false;qs('.pill').setAttribute('aria-expanded','true');qs('#words').focus();});}catch(_){}
  if(cfg.enabled)start();
})();
