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
