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
    assert page.evaluate("document.querySelectorAll('#pv-layer,#pv-style').length") == 0
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
    for extra, expected in (("", False), ("Ciclana", True)):
        ctx = make_ctx()
        serve(ctx, "https://web.whatsapp.com/*", "pii-negatives.html")
        ctx.add_init_script(f"localStorage.setItem('__gm:nomes', JSON.stringify('{extra}'))")
        page = open_page(ctx, "https://web.whatsapp.com/")
        page.evaluate("document.body.insertAdjacentHTML('beforeend', '<p id=\"x\">Contato: Ciclana Exemplar</p>')")
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
