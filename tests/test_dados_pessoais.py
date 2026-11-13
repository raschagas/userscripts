"""dados-pessoais: borrão por sobreposição, sem tocar na página, em caixa de correio e app reativo."""
from conftest import inject, open_page, serve

S = "dados-pessoais.user.js"
BOXES = "() => [...document.querySelectorAll('#pv-layer > div')].map(d => { const r = d.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, d.className]; })"
COVERED = """sel => { const e = document.querySelector(sel), r = document.createRange(); r.selectNodeContents(e);
  const t = r.getBoundingClientRect(); const cx = (t.left + t.right) / 2, cy = (t.top + t.bottom) / 2;
  return [...document.querySelectorAll('#pv-layer > div')].some(d => { const b = d.getBoundingClientRect(); return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom; }); }"""


NOMES = "Fulano, Fulana, Beltrano, Beltrana, Ciclano"  # nomes fictícios fora da lista embutida


def load(make_ctx, fixture, url, nomes=NOMES):
    ctx = make_ctx()
    serve(ctx, url.split("?")[0] + "*", fixture)
    if nomes:
        ctx.add_init_script(f"localStorage.setItem('__gm:nomes', JSON.stringify('{nomes}'))")
    page = open_page(ctx, url)
    return page


def toggle(page):
    page.keyboard.press("Alt+Shift+KeyP")
    page.wait_for_timeout(120)


def test_desligado_por_padrao_e_desfaz_sem_rastro(make_ctx):
    page = load(make_ctx, "pii.html", "https://outlook.live.com/mail/0/")
    before = page.evaluate("document.body.innerHTML")
    inject(page, S)
    assert page.evaluate("document.querySelectorAll('#pv-layer,#pv-style').length") == 0
    toggle(page)
    n = page.evaluate("+document.getElementById('pv-layer').dataset.n")
    assert n >= 20, n
    assert page.evaluate("document.body.innerHTML") == before, "a página não pode ser alterada"
    toggle(page)
    assert page.evaluate("document.querySelectorAll('#pv-layer,#pv-style,#pv-badge').length") == 0
    assert page.evaluate("JSON.parse(localStorage.getItem('__gm:ligado'))") is False


def test_cobre_os_dados(make_ctx):
    page = load(make_ctx, "pii.html", "https://outlook.live.com/mail/0/")
    inject(page, S)
    toggle(page)
    page.wait_for_timeout(200)
    for td in range(1, 8):  # CPF, RG, telefone, e-mail, endereço, renda, cartão
        assert page.evaluate(COVERED, f".read table tr:nth-child({td}) td:nth-child(2)"), td
    assert page.evaluate(COVERED, ".read .meta")
    assert page.evaluate(COVERED, ".att div:first-child")


def test_revelar_no_hover(make_ctx):
    page = load(make_ctx, "pii.html", "https://outlook.live.com/mail/0/")
    inject(page, S)
    toggle(page)
    b = page.evaluate(BOXES)[0]
    page.mouse.move((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
    page.wait_for_timeout(150)
    assert page.evaluate("document.querySelectorAll('#pv-layer > div.rv').length") == 1
    page.mouse.move(1360, 760)
    page.wait_for_timeout(150)
    assert page.evaluate("document.querySelectorAll('#pv-layer > div.rv').length") == 0


def test_negativos(make_ctx):
    page = load(make_ctx, "pii-negatives.html", "https://intranet.example/teste")
    inject(page, S)
    toggle(page)
    page.wait_for_timeout(150)
    assert not page.evaluate(COVERED, "#pedido"), "número sem contexto de RG não é RG"
    assert page.evaluate(COVERED, "#rg")
    assert page.evaluate(COVERED, "#nome")
    assert not page.evaluate(COVERED, "#edit"), "campo editável nunca"
    assert not page.evaluate(COVERED, "#svgname"), "svg nunca"
    inp = page.evaluate("(() => { const r = document.getElementById('campo').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()")
    for b in page.evaluate(BOXES):
        assert b[2] <= inp[0] or b[0] >= inp[2] or b[3] <= inp[1] or b[1] >= inp[3], "nada sobre o <input>"


def test_app_reativo(make_ctx):
    page = load(make_ctx, "react-stress.html", "https://teams.microsoft.com/v2/")
    compose = page.evaluate("document.getElementById('compose').innerHTML")
    inject(page, S)
    toggle(page)
    page.wait_for_timeout(600)
    page.evaluate("document.getElementById('list').scrollTop = 180")
    page.wait_for_timeout(2000)  # vários re-renders de 300 ms
    lst = page.evaluate("(() => { const r = document.getElementById('list').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()")
    boxes = page.evaluate(BOXES)
    assert len(boxes) >= 10
    for b in boxes:  # nada fora do painel com rolagem
        assert b[0] >= lst[0] - 3 and b[2] <= lst[2] + 3 and b[1] >= lst[1] - 2 and b[3] <= lst[3] + 2, (b, lst)
    assert page.evaluate("document.getElementById('compose').innerHTML") == compose, "rascunho intacto"
    log = page.inner_text("#log")
    assert log.endswith("erros JS: 0"), log
    assert int(log.split()[1]) >= 8
    assert page.errors == []
    ms = page.evaluate("[+document.getElementById('pv-layer').dataset.scanMs, +document.getElementById('pv-layer').dataset.paintMs]")
    print("tempos react-stress (varredura, repaint) ms:", ms)
    assert ms[0] < 50 and ms[1] < 50


def test_nunca_neste_site(make_ctx):
    page = load(make_ctx, "pii.html", "https://mail.google.com/mail/u/0/")
    inject(page, S)
    toggle(page)
    page.evaluate("window.__menu.find(m => m.t === 'Nunca neste site').f()")
    assert page.evaluate("document.querySelectorAll('#pv-layer,#pv-style').length") == 0
    page.reload(wait_until="load")
    inject(page, S)
    toggle(page)
    assert page.evaluate("document.querySelectorAll('#pv-layer').length") == 0
    assert "Voltar a borrar neste site" in page.evaluate("window.__menu.map(m => m.t)")


def test_nomes_extras(make_ctx):
    # 2.0.0: nome + sobrenome já é borrado pela estrutura; o extra agora vale para a palavra sozinha.
    for extra, expected in (("", False), ("Ciclana", True)):
        ctx = make_ctx()
        serve(ctx, "https://web.whatsapp.com/*", "pii-negatives.html")
        ctx.add_init_script(f"localStorage.setItem('__gm:nomes', JSON.stringify('{extra}'))")
        page = open_page(ctx, "https://web.whatsapp.com/")
        page.evaluate("document.body.insertAdjacentHTML('beforeend', '<p id=\"x\">Ciclana</p>')")
        inject(page, S)
        toggle(page)
        page.wait_for_timeout(150)
        assert page.evaluate(COVERED, "#x") is expected, extra


def test_espera_maxima_com_rerender_continuo(make_ctx):
    page = load(make_ctx, "pii-negatives.html", "https://web.whatsapp.com/")
    inject(page, S)
    toggle(page)
    # Mutação a cada 100 ms: o debounce de 250 ms sozinho nunca dispararia.
    page.evaluate("""() => { let n = 0; setInterval(() => { document.getElementById('pedido').textContent = 'Pedido ' + (++n); }, 100);
      document.body.insertAdjacentHTML('beforeend', '<p id=\"novo\">CPF 987.654.321-00</p>'); }""")
    page.wait_for_timeout(1400)
    assert page.evaluate(COVERED, "#novo")


def test_fora_da_viewport_nao_vira_caixa_e_troca_de_body(make_ctx):
    page = load(make_ctx, "pii-negatives.html", "https://web.whatsapp.com/")
    page.evaluate("document.body.insertAdjacentHTML('beforeend', Array.from({length: 400}, (_, i) => `<p>Linha ${i}: CPF 123.456.789-09</p>`).join(''))")
    inject(page, S)
    toggle(page)
    page.wait_for_timeout(200)
    for b in page.evaluate(BOXES):
        assert b[1] < 768 and b[3] > 0, b
    assert int(page.evaluate("document.getElementById('pv-layer').dataset.n")) < 60
    page.evaluate("""() => { const b = document.createElement('body'); b.innerHTML = '<p id=\"troca\" style=\"font:16px system-ui\">Telefone (61) 99876-5432</p>'; document.documentElement.replaceChild(b, document.body); }""")
    page.wait_for_timeout(500)
    assert page.evaluate(COVERED, "#troca"), "observador no <html> pega o <body> novo"


# ---------- 2.0.0 ----------
CHAR = """([sel, needle]) => { const e = document.querySelector(sel);
  const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let t;
  while ((t = w.nextNode())) { const i = t.nodeValue.indexOf(needle); if (i < 0) continue;
    const r = document.createRange(), m = i + Math.floor(needle.length / 2); r.setStart(t, m); r.setEnd(t, m + 1);
    const b = r.getBoundingClientRect(), cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
    return [...document.querySelectorAll('#pv-layer > div')].some(d => { const q = d.getBoundingClientRect(); return cx >= q.left && cx <= q.right && cy >= q.top && cy <= q.bottom; }); }
  throw new Error('texto não achado: ' + needle); }"""
OVER = """sel => [...document.querySelectorAll(sel)].some(e => { const r = e.getBoundingClientRect();
  return [...document.querySelectorAll('#pv-layer > div')].some(d => { const b = d.getBoundingClientRect();
    return Math.min(r.right, b.right) - Math.max(r.left, b.left) > 3 && Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) > 3; }); })"""
APP = "document.getElementById('pv-layer').dataset.app"


def ligar(make_ctx, fixture, url):
    page = load(make_ctx, fixture, url, nomes="")
    before = page.evaluate("document.body.innerHTML")
    inject(page, S)
    toggle(page)
    page.wait_for_timeout(200)
    page.before = before
    return page


def cov(page, sel, needle=None):
    return page.evaluate(CHAR, [sel, needle]) if needle else page.evaluate(COVERED, sel)


def test_outlook_nomes_fora_da_lista_antiga_e_dicionario(make_ctx):
    page = ligar(make_ctx, "pii-outlook.html", "https://outlook.office.com/mail/inbox/")
    assert page.evaluate(APP) == "outlook"
    for sel in ("#of1", "#of2", "#ofrom", "#oto",  # remetente e destinatário (estrutura)
                "#ob2", "#ob3", "#ob4",            # MAIÚSCULAS com prenome do IBGE, nome composto, "Sobrenome, Prenome"
                "#ob1", "#osig"):                  # palavra sozinha, achada pelo dicionário da página
        assert cov(page, sel), sel
    assert not page.evaluate(OVER, ".coin"), "foto de perfil nunca é borrada"
    assert not cov(page, "#ocompose"), "caixa de escrever intocada"
    for i in range(1, 7):
        assert not cov(page, f"#nav{i}"), f"menu nav{i}"
    assert page.evaluate("document.body.innerHTML") == page.before


def test_novos_padroes(make_ctx):
    page = ligar(make_ctx, "pii-outlook.html", "https://outlook.office.com/mail/inbox/")
    casos = {"#r1": "99999-9999", "#r2": "555 0123", "#r3": "61999999999", "#r4": "6132160000", "#r5": "@fulano_exemplo",
             "#r6": "01234567890", "#r7": "0123 4567 8901", "#r8": "123.45678.90-1", "#r9": "FZ123456", "#r10": "ABC-1234",
             "#r11": "BRA2E19", "#r12": "03/04/1980", "#r13": "03/04/1980", "#r14": "7b4d-4e8a", "#r15": "60000.000003",
             "#r16": "123.456", "#r17": "98765", "#r18": "192.168.0.10"}
    for sel, needle in casos.items():
        assert cov(page, sel, needle), (sel, needle)
    for sel, rotulo in (("#r6", "CNH"), ("#r9", "Passaporte"), ("#r12", "DN"), ("#r17", "Ponto")):
        assert not cov(page, sel, rotulo), "o rótulo fica legível"


def test_miniatura_de_anexo_sensivel(make_ctx):
    page = ligar(make_ctx, "pii-outlook.html", "https://outlook.office.com/mail/inbox/")
    assert page.evaluate(OVER, "#othumb"), "alt com nome sensível"
    assert page.evaluate(OVER, "#othumb2"), "miniatura ao lado de laudo-exame.pdf"
    assert not page.evaluate(OVER, "#othumb3"), "anexo comum fica"


def test_negativos_de_nomes(make_ctx):
    page = ligar(make_ctx, "pii-negatives-nomes.html", "https://intranet.example/x")
    boxes = page.evaluate("""[...document.querySelectorAll('#pv-layer > div')].map(d => { const b = d.getBoundingClientRect();
      return document.elementsFromPoint(b.left + b.width / 2, b.top + b.height / 2).find(e => e.closest('body'))?.textContent; })""")
    assert boxes == [], boxes


def test_whatsapp(make_ctx):
    page = ligar(make_ctx, "pii-whatsapp.html", "https://web.whatsapp.com/")
    assert page.evaluate(APP) == "whatsapp"
    # nome de toda conversa (grupo, individual, só número, uma palavra) na lateral e no cabeçalho
    for sel in ("#n1", "#n2", "#n3", "#n4", "#hn"):
        assert cov(page, sel), sel
    # prévias borradas; prefixo do remetente legível
    assert cov(page, "#m1") and cov(page, "#p2") and cov(page, "#p3") and cov(page, "#p4", "obrigado")
    assert not cov(page, "#s1"), "remetente na prévia fica legível"
    assert not cov(page, "#p4", "Você"), "prefixo sem elemento próprio também"
    # dentro da conversa: remetente legível, telefone sempre borrado, dados no texto borrados
    assert not cov(page, "#snd1") and not cov(page, "#snd2b")
    assert cov(page, "#snd2"), "telefone como remetente"
    assert cov(page, "#txt2", "123.456.789-09") and cov(page, "#txt2", "7b4d-4e8a")
    assert cov(page, "#txt3", "Nonato") and cov(page, "#txt3", "61999990000")
    assert not cov(page, "#hs"), "participantes (remetentes) no subtítulo ficam"
    assert not cov(page, "#t1"), "hora fica legível"
    assert not page.evaluate(OVER, "img.av"), "foto de perfil nunca é borrada"
    assert not cov(page, "#compose")
    assert page.evaluate("document.body.innerHTML") == page.before


def test_qr_code(make_ctx):
    page = load(make_ctx, "pii-whatsapp.html", "https://web.whatsapp.com/", nomes="")
    page.evaluate("""document.body.insertAdjacentHTML('beforeend', '<div data-ref="2@abc" style="position:fixed;left:500px;top:200px;background:#fff">' +
      '<canvas id="qr" aria-label="Scan this QR code to link a device!" role="img" width="160" height="160"></canvas></div>')""")
    inject(page, S)
    toggle(page)
    page.wait_for_timeout(200)
    assert page.evaluate(OVER, "#qr")


def test_telegram_k_e_a(make_ctx):
    for url in ("https://web.telegram.org/k/", "https://web.telegram.org/a/"):
        page = ligar(make_ctx, "pii-telegram.html", url)
        assert page.evaluate(APP) == "telegram"
        for sel in ("#kn1", "#kn2", "#kh", "#km1", "#km2", "#an1", "#ah", "#am1"):
            assert cov(page, sel), (url, sel)
        assert cov(page, "#kbm", "@sindico_exemplo") and cov(page, "#abm", "BRA2E19")
        for sel in ("#ks1", "#as1", "#kbn", "#abn", "#kt1", "#at1", "#khs", "#ahs"):
            assert not cov(page, sel), (url, sel)
        assert not page.evaluate(OVER, "#kav, #kav2, #aav"), "avatar e iniciais ficam"
        assert not cov(page, "#kcompose") and not cov(page, "#acompose")
        assert page.evaluate("document.body.innerHTML") == page.before


def test_chatwoot_pela_estrutura(make_ctx):
    for url in ("https://chat.exemplo.invalid/app/accounts/1/conversations/42", "https://atendimento.exemplo.invalid/"):
        page = ligar(make_ctx, "pii-chatwoot.html", url)
        assert page.evaluate(APP) == "chatwoot", url
        for sel in ("#wn1", "#wn2", "#wp1", "#wp2", "#wh", "#wcn", "#wcp"):
            assert cov(page, sel), (url, sel)
        assert cov(page, "#wm", "3216-0000") and cov(page, "#wm", "123.456-7")
        for sel in ("#wsn", "#wsa", "#wt1"):
            assert not cov(page, sel), (url, sel)
        assert not page.evaluate(OVER, ".user-thumbnail")
        assert not cov(page, "#wcompose")


def test_selo_visivel_e_clique_desliga(make_ctx):
    page = ligar(make_ctx, "pii-whatsapp.html", "https://web.whatsapp.com/")
    b = page.locator("#pv-badge")
    assert b.is_visible() and b.inner_text() == "🔒 borrando"
    b.click()
    page.wait_for_timeout(100)
    assert page.evaluate("document.querySelectorAll('#pv-layer,#pv-style,#pv-badge').length") == 0
    assert page.evaluate("JSON.parse(localStorage.getItem('__gm:ligado'))") is False


def test_desempenho_2000_mensagens(make_ctx):
    page = load(make_ctx, "pii-whatsapp.html", "https://web.whatsapp.com/", nomes="")
    page.evaluate("""() => { const m = document.getElementById('msgs'), h = [];
      for (let i = 0; i < 2000; i++) h.push(`<div role="row"><div class="message-in"><span dir="auto" class="snd">Fulana Modelo ${i % 7}</span>` +
        `<div class="copyable-text"><span class="selectable-text copyable-text"><span>Mensagem ${i}: falar com Raimundo Nonato no 61 9${String(8000 + i).padStart(4, '0')}-1234 amanhã</span></span></div>` +
        `<span class="tm">10:${String(i % 60).padStart(2, '0')}</span></div></div>`);
      m.insertAdjacentHTML('beforeend', h.join('')); m.scrollTop = m.scrollHeight; }""")
    inject(page, S)
    toggle(page)
    page.wait_for_timeout(400)
    page.evaluate("""document.getElementById('msgs').insertAdjacentHTML('beforeend',
      '<div role="row"><div class="message-in"><span class="selectable-text" id="novo">CPF 987.654.321-00</span></div></div>')""")
    page.wait_for_timeout(700)  # revarredura com 2.000 mensagens
    page.evaluate("document.getElementById('msgs').scrollTop = 1e9")
    page.wait_for_timeout(150)
    assert cov(page, "#novo", "987.654")
    page.evaluate("document.getElementById('msgs').scrollTop -= 300")  # repaint só de rolagem (sem revarrer)
    page.wait_for_timeout(150)
    ms = page.evaluate("[+document.getElementById('pv-layer').dataset.scanMs, +document.getElementById('pv-layer').dataset.paintMs]")
    print("tempos 2.000 mensagens (varredura, repaint) ms:", ms)
    assert ms[0] < 400 and ms[1] < 50, ms
    assert page.errors == []


WA = ("whatsapp-web.html", "https://web.whatsapp.com/")
FOTOS = "#avvoce, #pane-side img.av"
BLUR = "getComputedStyle(document.querySelector('#pv-layer > div')).backdropFilter"
# Caixa própria do elemento (não só um trecho de texto que passa por cima dele).
BOXED = """sel => { const r = document.querySelector(sel).getBoundingClientRect();
  return [...document.querySelectorAll('#pv-layer > div')].some(d => { const b = d.getBoundingClientRect();
    return Math.abs(b.left + 2 - r.left) <= 1 && Math.abs(b.top + 1 - r.top) <= 1 && Math.abs(b.width - 4 - r.width) <= 1 && Math.abs(b.height - 2 - r.height) <= 1; }); }"""


def wa(make_ctx, ajustes=None, mobile=False):
    ctx = make_ctx(mobile=mobile)
    serve(ctx, WA[1] + "*", WA[0])
    if ajustes:
        ctx.add_init_script(f"localStorage.setItem('__gm:ajustes', JSON.stringify({{whatsapp: {ajustes}}}))")
    page = open_page(ctx, WA[1])
    inject(page, S)
    toggle(page)
    page.wait_for_timeout(250)
    return page


def test_whatsapp_fotos_nitidas_com_classes_ofuscadas(make_ctx):
    # as classes "x…" da página contêm "qr" por acaso: não é QR code, e foto de perfil nunca é coberta
    page = wa(make_ctx)
    assert page.evaluate("document.querySelectorAll('[class*=\"qr\" i] img').length") >= 9
    assert not page.evaluate(OVER, FOTOS)
    assert cov(page, "#p5", "Assembleia") and not page.evaluate(BOXED, "#emo5"), "emoji só some junto com o texto"
    assert cov(page, "#n1") and cov(page, "#m1") and not cov(page, "#s1") and not cov(page, "#t1")
    assert page.evaluate(BLUR) == "blur(3px)", "borrão leve por padrão nos mensageiros"


def test_qr_code_por_classe_com_separador(make_ctx):
    page = wa(make_ctx)
    page.evaluate("""document.body.insertAdjacentHTML('beforeend', '<div class="login-qr-box" style="position:fixed;left:700px;top:40px">' +
      '<canvas id="qr2" width="120" height="120"></canvas></div>')""")
    page.wait_for_timeout(500)
    assert page.evaluate(OVER, "#qr2")


def test_borrar_fotos_e_modos_pelo_painel(make_ctx):
    page = wa(make_ctx)
    page.locator("#pv-gear").click()
    assert page.locator("#pv-panel").is_visible() and page.locator("#pv-badge").is_visible(), "a engrenagem não desliga"
    page.locator("#pv-panel input[type=checkbox]").check()
    page.wait_for_timeout(150)
    assert page.evaluate(OVER, "#av1") and page.evaluate(OVER, "#avvoce")
    assert not page.evaluate(BOXED, "#emo5"), "emoji pequeno não é foto de perfil"
    page.locator("#pv-panel input[type=checkbox]").uncheck()
    page.locator("#pv-panel input[value=previa]").check()
    page.wait_for_timeout(150)
    assert not page.evaluate(OVER, FOTOS)
    assert not cov(page, "#n1") and cov(page, "#m1") and cov(page, "#n3"), "nome legível; telefone como nome continua borrado"
    page.locator("#pv-panel input[value=padroes]").check()
    page.wait_for_timeout(150)
    assert not cov(page, "#n1") and not cov(page, "#m1") and cov(page, "#p2", "99999-0002") and cov(page, "#p6", "beltrana@")
    page.locator("#pv-panel input[type=range]").fill("8")
    page.wait_for_timeout(150)
    assert page.evaluate(BLUR) == "blur(8px)"
    assert page.evaluate("JSON.parse(localStorage.getItem('__gm:ajustes'))") == {"whatsapp": {"fotos": False, "modo": "padroes", "forca": 8}}
    page.keyboard.press("Escape")
    assert page.locator("#pv-panel").count() == 0


ATRAS = """() => { const p = document.getElementById('pv-panel').getBoundingClientRect();
  return [...document.querySelectorAll('#pane-side span[title][id^="n"]')].filter(e => { const r = e.getBoundingClientRect();
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2; return cx > p.left && cx < p.right && cy > p.top && cy < p.bottom; }).map(e => '#' + e.id); }"""


def test_painel_nao_descobre_o_que_esta_atras(make_ctx):
    page = wa(make_ctx)
    antes = page.evaluate("+document.getElementById('pv-layer').dataset.n")
    page.locator("#pv-gear").click()
    page.wait_for_timeout(200)
    assert page.evaluate("+document.getElementById('pv-layer').dataset.n") == antes
    atras = page.evaluate(ATRAS)
    assert atras, "algum nome de conversa fica atrás do painel"
    for sel in atras:
        assert cov(page, sel), sel


def test_ajustes_salvos_por_site_e_gaveta_no_celular(make_ctx):
    page = wa(make_ctx, ajustes="{modo: 'previa', forca: 9, fotos: true}", mobile=True)
    assert page.evaluate(BLUR) == "blur(9px)" and page.evaluate(OVER, "#av1") and not cov(page, "#n1")
    page.evaluate("document.getElementById('pv-gear').click()")
    box = page.locator("#pv-panel").bounding_box()
    assert box["x"] == 0 and round(box["width"]) == 412 and round(box["y"] + box["height"]) == 915
    alvos = page.evaluate("[...document.querySelectorAll('#pv-panel label, #pv-panel .x')].map(e => e.getBoundingClientRect().height)")
    assert min(alvos) >= 44, alvos


def test_chatwoot_que_aparece_depois_no_spa(make_ctx):
    # SPA: o painel do Chatwoot só monta depois do carregamento, numa rota qualquer de host próprio.
    page = load(make_ctx, "pii-chatwoot.html", "https://suporte.exemplo.invalid/", nomes="")
    page.evaluate("window.__html = document.body.innerHTML; document.body.innerHTML = ''")
    inject(page, S)
    toggle(page)
    page.wait_for_timeout(150)
    assert page.evaluate(APP) == "geral"
    page.evaluate("document.body.innerHTML = window.__html")
    page.wait_for_timeout(500)
    assert page.evaluate(APP) == "chatwoot"
    assert page.evaluate(BLUR) == "blur(3px)"
    assert cov(page, "#wn1") and not cov(page, "#wsn")
    page.locator("#pv-gear").click()
    assert page.locator("#pv-panel input[value=previa]").count() == 1, "modos aparecem no Chatwoot"


def test_miniaturas_redondas_de_anexo_sensivel(make_ctx):
    page = wa(make_ctx)
    img = "<img id=\"{}\" alt=\"{}\" style=\"width:48px;height:48px;border-radius:50%;display:block\" src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48'><rect width='48' height='48' fill='%23999'/></svg>\">"
    html = ('<div style="position:fixed;left:760px;top:120px;background:#fff;padding:8px">' + img.format("thalt", "CPF_frente.jpg") + '</div>'
            '<div style="position:fixed;left:760px;top:260px;background:#fff;padding:8px;display:flex;gap:8px">'
            + img.format("thviz", "") + '<span>CPF_frente.jpg</span></div>')
    page.evaluate("h => document.body.insertAdjacentHTML('beforeend', h)", html)
    page.wait_for_timeout(500)
    assert page.evaluate(OVER, "#thalt"), "alt com nome sensível, mesmo redonda"
    assert page.evaluate(OVER, "#thviz"), "redonda de 48 px ao lado de CPF_frente.jpg"
    assert not page.evaluate(OVER, FOTOS), "fotos de perfil seguem nítidas"


def test_modos_so_na_lista_de_conversas(make_ctx):
    for modo in ("previa", "padroes"):
        ctx = make_ctx()
        serve(ctx, "https://web.whatsapp.com/*", "pii-whatsapp.html")
        ctx.add_init_script(f"localStorage.setItem('__gm:ajustes', JSON.stringify({{whatsapp: {{modo: '{modo}'}}}}))")
        page = open_page(ctx, "https://web.whatsapp.com/")
        inject(page, S)
        toggle(page)
        page.wait_for_timeout(200)
        assert not cov(page, "#n1"), modo
        assert cov(page, "#hn"), ("nome no cabeçalho da conversa aberta continua borrado", modo)
        assert cov(page, "#m1") is (modo == "previa"), modo


def test_modos_no_telegram(make_ctx):
    for modo in ("previa", "padroes"):
        ctx = make_ctx()
        serve(ctx, "https://web.telegram.org/**", "pii-telegram.html")
        ctx.add_init_script(f"localStorage.setItem('__gm:ajustes', JSON.stringify({{telegram: {{modo: '{modo}'}}}}))")
        page = open_page(ctx, "https://web.telegram.org/k/")
        inject(page, S)
        toggle(page)
        page.wait_for_timeout(200)
        assert page.evaluate(APP) == "telegram"
        assert not cov(page, "#kn1") and not cov(page, "#an1"), modo
        assert cov(page, "#kh") and cov(page, "#ah"), ("cabeçalho da conversa continua borrado", modo)
        assert cov(page, "#km1") is (modo == "previa") and cov(page, "#am1") is (modo == "previa"), modo
        assert cov(page, "#km2", "99999 1234"), ("telefone na prévia sempre", modo)


def test_ajustes_invalidos_caem_nos_padroes(make_ctx):
    for ajustes in ('"lixo"', "[1, 2]", "{whatsapp: 'x'}", "{whatsapp: {modo: 'nada', forca: 0, fotos: 'sim'}}",
                    "{whatsapp: {forca: 11, fotos: 1}}", "{whatsapp: {forca: 'x'}}"):
        ctx = make_ctx()
        serve(ctx, WA[1] + "*", WA[0])
        ctx.add_init_script(f"localStorage.setItem('__gm:ajustes', JSON.stringify({ajustes}))")
        page = open_page(ctx, WA[1])
        inject(page, S)
        toggle(page)
        page.wait_for_timeout(250)
        assert page.evaluate(BLUR) == "blur(3px)", ajustes
        assert cov(page, "#n1") and cov(page, "#m1"), ("modo padrão: nome e prévia", ajustes)
        assert not page.evaluate(OVER, FOTOS), ("fotos nítidas por padrão", ajustes)
        page.locator("#pv-gear").click()
        assert page.locator("#pv-panel input[value=tudo]").is_checked(), ajustes
        assert not page.locator("#pv-panel input[type=checkbox]").is_checked(), ajustes


def test_site_comum_usa_6px_e_nao_herda_ajuste_de_outro_adaptador(make_ctx):
    ctx = make_ctx()
    serve(ctx, "https://outlook.live.com/**", "pii.html")
    ctx.add_init_script("localStorage.setItem('__gm:ajustes', JSON.stringify({whatsapp: {forca: 9, modo: 'padroes'}}))")
    page = open_page(ctx, "https://outlook.live.com/mail/0/")
    inject(page, S)
    toggle(page)
    page.wait_for_timeout(200)
    assert page.evaluate(APP) == "outlook"
    assert page.evaluate(BLUR) == "blur(6px)"
    page.locator("#pv-gear").click()
    assert page.locator("#pv-panel input[type=radio]").count() == 0, "modos só nos mensageiros"


def test_engrenagem_irma_do_selo_foco_escape_e_menu(make_ctx):
    for canto in ("inferior-esquerdo", "inferior-direito", "superior-esquerdo", "superior-direito"):
        ctx = make_ctx()
        serve(ctx, WA[1] + "*", WA[0])
        ctx.add_init_script(f"localStorage.setItem('__gm:canto_selo', JSON.stringify('{canto}'))")
        page = open_page(ctx, WA[1])
        inject(page, S)
        toggle(page)
        page.wait_for_timeout(200)
        g, b = page.locator("#pv-gear").bounding_box(), page.locator("#pv-badge").bounding_box()
        assert page.evaluate("!document.getElementById('pv-badge').contains(document.getElementById('pv-gear'))"), canto
        assert g["width"] >= 44 and g["height"] >= 44, (canto, g)
        assert g["x"] >= 0 and g["y"] >= 0 and g["x"] + g["width"] <= 1366 and g["y"] + g["height"] <= 768, (canto, g)
        assert g["x"] >= b["x"] + b["width"] or g["x"] + g["width"] <= b["x"], ("ao lado, sem sobrepor", canto)
        assert (b["x"] <= 8.5) is canto.endswith("esquerdo") and (b["y"] <= 8.5) is canto.startswith("superior"), (canto, b)
    # foco e Escape (último contexto)
    page.locator("#pv-gear").click()
    assert page.evaluate("document.activeElement === document.querySelector('#pv-panel input')")
    page.evaluate("document.activeElement.blur()")
    page.keyboard.press("Escape")
    assert page.locator("#pv-panel").count() == 0, "Escape fecha com o foco fora do painel"
    assert page.evaluate("document.activeElement.id") == "pv-gear", "foco volta à engrenagem"
    page.keyboard.press("Escape")  # ouvinte já removido: nada quebra
    assert page.errors == []
    # pelo menu, desligado: liga, lembra e abre
    toggle(page)
    assert page.evaluate("JSON.parse(localStorage.getItem('__gm:ligado'))") is False
    page.evaluate("window.__menu.find(m => m.t === 'Ajustes do borrão…').f()")
    assert page.locator("#pv-panel").is_visible()
    assert page.evaluate("JSON.parse(localStorage.getItem('__gm:ligado'))") is True
    toggle(page)
    assert page.evaluate("document.querySelectorAll('#pv-layer,#pv-style,#pv-ctl,#pv-badge,#pv-gear,#pv-panel').length") == 0


def test_menu_de_ajustes_em_site_excluido(make_ctx):
    ctx = make_ctx()
    serve(ctx, WA[1] + "*", WA[0])
    ctx.add_init_script("localStorage.setItem('__gm:excluir', JSON.stringify('web.whatsapp.com'))")
    page = open_page(ctx, WA[1])
    inject(page, S)
    page.evaluate("window.__menu.find(m => m.t === 'Ajustes do borrão…').f()")
    assert page.evaluate("document.querySelectorAll('#pv-layer,#pv-ctl,#pv-panel').length") == 0
    assert page.evaluate("localStorage.getItem('__gm:ligado')") is None
    assert page.errors == []


def test_slider_salva_so_ao_soltar(make_ctx):
    page = wa(make_ctx)
    page.locator("#pv-gear").click()
    page.evaluate("""() => { const r = document.querySelector('#pv-panel input[type=range]'); r.value = 7;
      r.dispatchEvent(new Event('input', { bubbles: true })); }""")
    assert page.inner_text("#pv-panel output") == "7 px"
    assert page.evaluate("document.getElementById('pv-layer').style.getPropertyValue('--pv-blur')") == "7px"
    assert page.evaluate("localStorage.getItem('__gm:ajustes')") is None, "arrastando não salva"
    page.evaluate("document.querySelector('#pv-panel input[type=range]').dispatchEvent(new Event('change', { bubbles: true }))")
    assert page.evaluate("JSON.parse(localStorage.getItem('__gm:ajustes'))") == {"whatsapp": {"forca": 7}}


def test_miniatura_nao_redonda_coberta_e_foto_de_quem_enviou_nitida(make_ctx):
    page = wa(make_ctx)
    redonda = "<img id=\"fotoenv\" alt=\"\" style=\"width:48px;height:48px;border-radius:50%;display:block\" src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48'><rect width='48' height='48' fill='%23999'/></svg>\">"
    anexo = "<img id=\"anexo\" alt=\"\" style=\"width:64px;height:48px;display:block\" src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='48'><rect width='64' height='48' fill='%23bbb'/></svg>\">"
    html = ('<div style="position:fixed;left:760px;top:260px;background:#fff;padding:8px;display:flex;gap:8px">'
            + redonda + anexo + '<span>CPF_frente.jpg</span></div>')
    page.evaluate("h => document.body.insertAdjacentHTML('beforeend', h)", html)
    page.wait_for_timeout(500)
    assert page.evaluate(OVER, "#anexo"), "miniatura não redonda ao lado de CPF_frente.jpg"
    assert not page.evaluate(OVER, "#fotoenv"), "foto redonda de 48 px de quem enviou segue nítida"


def test_alt_sensivel_redondo_cobre_ate_dentro_da_lista_de_conversas(make_ctx):
    page = wa(make_ctx)
    img = ("<img id=\"nalista\" alt=\"RG_verso.jpg\" style=\"position:absolute;left:100px;top:300px;width:48px;height:48px;border-radius:50%\" "
           "src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48'><rect width='48' height='48' fill='%23999'/></svg>\">")
    page.evaluate("h => document.querySelector('#pane-side').insertAdjacentHTML('beforeend', h)", img)
    page.wait_for_timeout(500)
    assert page.evaluate("!!document.querySelector('#pane-side #nalista')")
    assert page.evaluate(OVER, "#nalista"), "alt sensível sempre cobre, mesmo redonda na lista"


def test_modos_na_lista_do_chatwoot(make_ctx):
    for modo in ("previa", "padroes"):
        ctx = make_ctx()
        serve(ctx, "https://chat.exemplo.invalid/**", "pii-chatwoot.html")
        ctx.add_init_script(f"localStorage.setItem('__gm:ajustes', JSON.stringify({{chatwoot: {{modo: '{modo}'}}}}))")
        page = open_page(ctx, "https://chat.exemplo.invalid/app/accounts/1/conversations/42")
        inject(page, S)
        toggle(page)
        page.wait_for_timeout(200)
        page.evaluate("""() => { const p = document.createElement('p'); p.className = 'conversation--message'; p.id = 'wpx';
          p.textContent = 'Escreva para fulano@exemplo.invalid'; document.querySelector('#w2 .conversation--details').appendChild(p); }""")
        page.wait_for_timeout(500)
        assert page.evaluate(APP) == "chatwoot", modo
        assert not cov(page, "#wn1"), ("nome na lista legível", modo)
        assert cov(page, "#wn2"), ("nome que é telefone segue coberto", modo)
        assert cov(page, "#wh") and cov(page, "#wcn"), ("cabeçalho e painel do contato seguem cobertos", modo)
        assert cov(page, "#wp2") is (modo == "previa"), modo
        assert cov(page, "#wpx", "fulano@exemplo.invalid"), ("e-mail na prévia sempre", modo)
