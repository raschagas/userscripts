"""shop-filter em fixtures servidas nos hosts reais (adaptador escolhido pelo host)."""
import pytest

from conftest import inject, open_page, serve

S = "shop-filter.user.js"
AMZ = "https://www.amazon.com.br/s?k=suporte+monitor"
TEN = "https://loja-exemplo.invalid/busca"
ALI = "https://pt.aliexpress.com/w/wholesale-suporte-monitor.html"

CARDS = """() => [...document.querySelectorAll('[data-component-type="s-search-result"]')].map(c => ({
  id: c.dataset.id, v: c.querySelector('.us-sf-dot')?.dataset.v || null,
  label: [...c.querySelectorAll('.us-sf-dot span')].map(s => s.textContent).join(' | '),
  hidden: c.classList.contains('us-sf-hide'), dim: c.classList.contains('us-sf-dim')}))"""
STATS = "() => Object.assign({}, document.getElementById('us-shop-filter')?.dataset)"


def by_id(page):
    return {c["id"]: c for c in page.evaluate(CARDS)}


def shadow(page, js):
    return page.evaluate(f"(() => {{ const r = document.getElementById('us-shop-filter').shadowRoot; {js} }})()")


def set_range(page, sel, value):
    shadow(page, f"const i = r.querySelector('{sel}'); i.value = '{value}'; i.dispatchEvent(new Event('input', {{bubbles: true}}));")


def amazon(make_ctx, **kw):
    ctx = make_ctx(**kw)
    serve(ctx, "https://www.amazon.com.br/**", "shop-amazon.html")
    page = open_page(ctx, AMZ)
    inject(page, S)
    return ctx, page


def test_amazon_veredito_padrao(make_ctx):
    ctx, page = amazon(make_ctx)
    c = by_id(page)
    assert c["pass"]["v"] == "pass" and not c["pass"]["dim"] and c["pass"]["label"] == "4.7★ · 812".replace(".", ",")
    assert c["lowrate"]["dim"] and c["lowrate"]["v"] == "fail"
    assert c["lowcount"]["dim"] and c["lowcount"]["v"] == "fail"
    # patrocinado aprovado fica, com selo; reprovado e sem nota somem
    assert c["sppass"]["v"] == "pass" and "patrocinado ✓" in c["sppass"]["label"]
    assert c["spfail"]["hidden"] and c["spfail"]["v"] is None
    assert c["spnone"]["hidden"]
    # null ≠ 0: sem dados = cinza; só contagem / só nota decidem pelo eixo presente; 0 é dado real
    assert c["none"]["v"] == "unknown" and not c["none"]["hidden"] and c["none"]["label"] == "sem nota"
    assert c["countonly"]["v"] == "pass" and c["countonly"]["label"] == "sem nota · 300"
    assert c["rateonly"]["v"] == "pass" and c["rateonly"]["label"] == "4,9★"
    assert c["zero"]["v"] == "fail" and c["zero"]["label"] == "4,9★ · 0"
    assert c["mil"]["v"] == "pass" and c["mil"]["label"] == "4,5★ · 2.300"
    st = page.evaluate(STATS)
    assert (st["total"], st["pass"], st["fail"], st["unknown"], st["spHidden"], st["dimmed"]) == ("11", "5", "4", "2", "2", "3")
    pill = shadow(page, "return r.querySelector('.pill').textContent")
    assert pill == "4 reprovados · 2 patrocinados ocultos"
    assert page.errors == []


def test_circulo_12px_da_foto(make_ctx):
    ctx, page = amazon(make_ctx)
    off = page.evaluate("""() => { const c = document.querySelector('[data-id="pass"]');
      const p = c.querySelector('.s-product-image-container').getBoundingClientRect(), d = c.querySelector('.us-sf-dot > i').getBoundingClientRect();
      return [d.top - p.top, d.left - p.left, d.width, getComputedStyle(c.querySelector('.us-sf-dot')).zIndex]; }""")
    assert off == [12, 12, 16, "2"]


def test_patrocinado_opcao_desligada_e_modo_ocultar_persistem(make_ctx):
    ctx, page = amazon(make_ctx)
    page.locator("#us-shop-filter .pill").click()
    assert shadow(page, "return !r.querySelector('.panel').hidden && r.querySelector('.panel').classList.contains('desk')")
    page.locator('#us-shop-filter .sw[data-k="sponsoredOnlyIfPass"]').click()
    c = by_id(page)
    assert c["spfail"]["dim"] and not c["spfail"]["hidden"] and c["spnone"]["v"] == "unknown"
    page.locator('#us-shop-filter .sw[data-k="hide"]').click()
    c = by_id(page)
    assert c["lowrate"]["hidden"] and c["lowcount"]["hidden"] and c["spfail"]["hidden"] and not c["pass"]["hidden"]
    page.locator("header").click()  # clique fora fecha o painel
    assert shadow(page, "return r.querySelector('.panel').hidden")
    page.reload(wait_until="load")
    inject(page, S)
    c = by_id(page)
    assert c["lowrate"]["hidden"] and c["spnone"]["v"] == "unknown" and not c["spnone"]["hidden"]
    assert page.evaluate("JSON.parse(localStorage.getItem('__gm:site:amazon')).mode") == "hide"


def test_sliders_mudam_resultado_e_persistem(make_ctx):
    ctx, page = amazon(make_ctx)
    page.locator("#us-shop-filter .pill").click()
    set_range(page, "#n", 0)
    assert by_id(page)["lowcount"]["v"] == "pass"
    set_range(page, "#r", 4.0)
    c = by_id(page)
    assert c["lowrate"]["v"] == "pass" and c["spfail"]["hidden"]
    assert shadow(page, "return r.querySelector('#ro').textContent") == "4,0 / 5"
    page.reload(wait_until="load")
    inject(page, S)
    c = by_id(page)
    assert c["lowrate"]["v"] == "pass" and c["lowcount"]["v"] == "pass"
    page.locator("#us-shop-filter .pill").click()
    assert shadow(page, "return [r.querySelector('#ro').textContent, r.querySelector('#no').textContent, r.querySelector('#r').max]") == ["4,0 / 5", "0", "5"]


def test_filtro_desligado_limpa_tudo(make_ctx):
    ctx, page = amazon(make_ctx)
    page.locator("#us-shop-filter .pill").click()
    page.locator('#us-shop-filter .sw[data-k="enabled"]').click()
    assert page.evaluate("document.querySelectorAll('.us-sf-dot,.us-sf-dim,.us-sf-hide,.us-sf-card').length") == 0
    assert shadow(page, "return r.querySelector('.pill').textContent") == "Filtro desligado"


def test_rolagem_infinita_e_no_reaproveitado(make_ctx):
    ctx, page = amazon(make_ctx)
    page.evaluate("addMore()")
    page.wait_for_timeout(700)
    assert by_id(page)["late"]["v"] == "fail"
    page.evaluate("reuse()")  # o site troca o conteúdo do mesmo nó: não confiar na marcação antiga
    page.wait_for_timeout(700)
    assert by_id(page)["pass"]["v"] == "fail"
    assert page.evaluate("document.querySelectorAll('[data-id=\"pass\"] .us-sf-dot').length") == 1


def test_sem_cartoes_nao_faz_nada(make_ctx):
    ctx = make_ctx()
    serve(ctx, "https://www.amazon.com.br/**", "shop-amazon-empty.html")
    page = open_page(ctx, "https://www.amazon.com.br/dp/B000")
    html = page.evaluate("document.documentElement.outerHTML")
    inject(page, S)
    page.wait_for_timeout(500)
    assert page.evaluate("!!document.getElementById('us-shop-filter') || !!document.getElementById('us-sf-style')") is False
    after = page.evaluate("document.documentElement.outerHTML")
    assert after.count("<script") == html.count("<script") + 1  # só a própria tag injetada pelo teste


def test_escala_10(make_ctx):
    ctx = make_ctx()
    serve(ctx, "https://loja-exemplo.invalid/**", "shop10.html")
    page = open_page(ctx, TEN)
    inject(page, S)
    v = page.evaluate("[...document.querySelectorAll('.card')].map(c => [c.querySelector('.us-sf-dot')?.dataset.v, c.querySelector('.us-sf-dot span')?.textContent, c.classList.contains('us-sf-dim')])")
    assert [x[0] for x in v] == ["pass", "fail", "fail", "fail", "pass", "unknown", "fail", "pass"]  # 9,2 com 96 avaliações reprova pela contagem
    assert v[0][1] == "9,6/10 · 1.820" and v[5][1] == "sem nota" and v[1][2] is True
    page.locator("#us-shop-filter .pill").click()
    assert shadow(page, "return [r.querySelector('#ro').textContent, r.querySelector('#r').max, r.querySelector('#r').value]") == ["9,0 / 10", "10", "9"]
    set_range(page, "#r", 7.5)
    assert page.evaluate("document.querySelector('[data-i=\"1\"] .us-sf-dot').dataset.v") == "pass"
    assert page.evaluate("JSON.parse(localStorage.getItem('__gm:site:exemplo10')).minRating") == 7.5


def test_aliexpress_pc_combos_e_anuncio(make_ctx):
    ctx = make_ctx()
    serve(ctx, "https://pt.aliexpress.com/**", "ali-pc.html")
    page = open_page(ctx, ALI)
    inject(page, S)
    r = page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('.search-card-out-wrapper')].map(w => [w.dataset.i, {
      v: w.querySelector('.us-sf-dot')?.dataset.v || null, hidden: w.classList.contains('us-sf-hide'), href: w.querySelector('a').getAttribute('href')}]))""")
    assert r["a"]["v"] == "pass" and r["a"]["href"] == "https://pt.aliexpress.com/item/1005001111111111.html?p4pId=9&sourceType=1", \
        "link de item comum fora de combo fica intacto"
    assert r["b"]["v"] == "fail"
    assert r["c"]["hidden"], "selo Anúncio no invólucro: patrocinado reprovado some"
    assert r["d"]["v"] == "pass" and r["d"]["href"] == "https://pt.aliexpress.com/item/1005004444444444.html"
    assert page.evaluate("document.getElementById('order').getAttribute('href')").startswith("https://pt.aliexpress.com/p/order/")
    page.locator("#us-shop-filter .pill").click()
    page.locator('#us-shop-filter .sw[data-k="rewriteCombos"]').click()
    assert page.evaluate("document.querySelector('[data-i=\"d\"] a').getAttribute('href')").startswith("https://pt.aliexpress.com/ssr/")
    assert page.evaluate("document.querySelectorAll('[data-us-sf-href-original]').length") == 0


def test_aliexpress_celular_gaveta(make_ctx):
    ctx = make_ctx(mobile=True)
    serve(ctx, "https://m.aliexpress.com/**", "ali-mobile.html")
    page = open_page(ctx, "https://m.aliexpress.com/w/wholesale-suporte.html")
    inject(page, S)
    v = page.evaluate("[...document.querySelectorAll('[class^=\"galleryItem--\"]')].map(g => [g.dataset.i, g.querySelectorAll('.us-sf-dot').length, g.querySelector('.us-sf-dot')?.dataset.v])")
    assert v == [["a", 1, "pass"], ["b", 1, "fail"], ["c", 1, "unknown"], ["d", 1, "pass"]]
    page.locator("#us-shop-filter .pill").tap()
    g = shadow(page, """const p = r.querySelector('.panel'), b = p.getBoundingClientRect();
      return {sheet: p.classList.contains('sheet'), w: b.width, bottom: Math.round(b.bottom),
        mins: [...r.querySelectorAll('.sw, input[type=range], .pill, .close')].map(e => Math.round(Math.min(e.getBoundingClientRect().height, e.getBoundingClientRect().width)))}""")
    assert g["sheet"] and g["w"] == 412 and g["bottom"] == 915
    assert min(g["mins"]) >= 44, g["mins"]
    page.locator('#us-shop-filter .sw[data-k="hide"]').tap()
    assert page.evaluate("document.querySelector('[data-i=\"b\"]').classList.contains('us-sf-hide')")
    page.keyboard.press("Escape")  # (toque fora: o ajuste de toque do Chrome puxa para o link vizinho)
    assert shadow(page, "return r.querySelector('.panel').hidden")


@pytest.mark.parametrize("dark", [False, True])
def test_painel_claro_escuro(make_ctx, dark):
    ctx, page = amazon(make_ctx, dark=dark)
    page.locator("#us-shop-filter .pill").click()
    bg = shadow(page, "return getComputedStyle(r.querySelector('.panel')).backgroundColor")
    assert bg == ("rgb(31, 41, 55)" if dark else "rgb(255, 255, 255)")


def test_aliexpress_loja_cupom_e_botao_no_cartao_combo(make_ctx):
    ctx = make_ctx()
    serve(ctx, "https://pt.aliexpress.com/**", "ali-pc.html")
    page = open_page(ctx, ALI)
    inject(page, S)
    e = page.evaluate("""() => { const w = document.querySelector('[data-i="e"]');
      return [w.querySelector('a.search-card-item').getAttribute('href'), ...['store', 'coupon', 'reviews'].map(i => document.getElementById(i).getAttribute('href'))]; }""")
    assert e == ["https://pt.aliexpress.com/item/1005006666666666.html",
                 "https://pt.aliexpress.com/store/1234567",
                 "https://pt.aliexpress.com/p/coupon/index.html?productId=1005006666666666",
                 "https://feedback.aliexpress.com/display/productEvaluation.htm?productId=1005001234567890"], e
    page.locator("#cart").click()
    page.wait_for_timeout(300)
    assert page.url == ALI and page.evaluate("window.cartClicks") == 1, "botão do carrinho segue com a página, sem navegar"
    assert page.evaluate("""() => { const sp = document.querySelector('[data-i="d"] a').getAttribute('href'); return sp; }""").endswith("/item/1005004444444444.html")


LINKS_INTACTOS = {
    "rev": "https://feedback.aliexpress.com/display/productEvaluation.htm?productId=1005001234567890",
    "msg": "https://www.aliexpress.com/p/message/index.html?productId=1005001234567890&sellerId=99",
    "report": "https://report.aliexpress.com/health/reportIndex.htm?productId=1005001234567890",
    "ext": "https://example.org/bundle?productId=1005001234567890",
    "item": "https://pt.aliexpress.com/item/1005007777777777.html?sourceType=x",
}


def test_aliexpress_links_que_nao_sao_item_nem_combo_ficam_intactos(make_ctx):
    ctx = make_ctx()
    serve(ctx, "https://pt.aliexpress.com/**", "ali-pc.html")
    page = open_page(ctx, ALI)
    page.evaluate("""l => { for (const [id, h] of Object.entries(l)) { const a = document.createElement('a'); a.id = id; a.href = h;
      a.textContent = id; document.body.append(a); } }""", LINKS_INTACTOS)
    inject(page, S)
    page.wait_for_timeout(500)
    got = page.evaluate("l => Object.fromEntries(Object.keys(l).map(id => [id, document.getElementById(id).getAttribute('href')]))", LINKS_INTACTOS)
    assert got == LINKS_INTACTOS
    assert page.evaluate("document.querySelectorAll('[data-us-sf-href-original]').length") == 2, "só os dois combos mudaram"


def test_contador_dentro_do_cartao_nao_provoca_varreduras(make_ctx):
    ctx = make_ctx(mobile=True)
    serve(ctx, "https://m.aliexpress.com/**", "ali-mobile.html")
    page = ctx.new_page()
    page.clock.install()
    page.goto("https://m.aliexpress.com/w/wholesale-suporte.html", wait_until="load")
    page.evaluate("""() => { for (const g of document.querySelectorAll('[class^="galleryItem--"] a')) {
      const s = document.createElement('span'); s.className = 'cd'; s.textContent = 'Termina em 00:00:00'; g.append(s); }
      let n = 0; setInterval(() => { n++; document.querySelectorAll('.cd').forEach((s, i) => {
        if (i % 2) s.firstChild.nodeValue = 'Termina em 00:00:' + n; else s.textContent = 'Termina em 00:00:' + n; }); }, 1000); }""")
    inject(page, S)
    page.clock.run_for(10000)
    assert int(page.evaluate(STATS)["scans"]) <= 2

def test_aliexpress_link_blank_abre_em_nova_aba(make_ctx):
    ctx = make_ctx()
    serve(ctx, "https://pt.aliexpress.com/**", "ali-pc.html")
    page = open_page(ctx, ALI)
    inject(page, S)
    # O site volta a pôr o href de combo depois da marcação (navegação por JS): o ouvinte de clique corrige.
    page.evaluate("""() => { const a = document.querySelector('[data-i="e"] a.search-card-item'); a.target = '_blank';
      a.setAttribute('href', 'https://pt.aliexpress.com/ssr/300000512/BundleDeals2?x=1'); window.opened = [];
      window.open = (u, t) => { window.opened.push([u, t]); return null; }; }""")
    page.locator('[data-i="e"] a.search-card-item').click()
    assert page.evaluate("window.opened") == [["https://pt.aliexpress.com/item/1005006666666666.html", "_blank"]]
    assert page.url == ALI


def test_experimental_so_esmaece_e_rejeita_vitrine(make_ctx):
    ctx = make_ctx()
    ctx.add_init_script("localStorage.setItem('__gm:site:americanas', JSON.stringify({mode: 'hide'}))")
    serve(ctx, "https://www.americanas.com.br/**", "shop-experimental.html")
    page = open_page(ctx, "https://www.americanas.com.br/busca/fone")
    inject(page, S)
    r = page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('[data-testid]')].map(c => [c.dataset.i,
      [c.querySelector(':scope > .us-sf-dot')?.dataset.v || null, c.classList.contains('us-sf-dim'), c.classList.contains('us-sf-hide')]]))""")
    assert r["ok"] == ["pass", False, False]
    assert r["ruim"] == ["fail", True, False], "experimental nunca oculta, mesmo com ocultar ligado"
    assert r["sp"] == ["fail", True, False], "patrocinado reprovado também só esmaece"
    assert r["shelf"] == [None, False, False], "vitrine com vários produtos não é cartão"
    assert page.evaluate(STATS)["total"] == "3"
    page.locator("#us-shop-filter .pill").click()
    assert "Site experimental: só esmaece" in shadow(page, "return r.querySelector('.note.exp').textContent")


def test_experimental_um_cartao_so_nao_faz_nada(make_ctx):
    ctx = make_ctx()
    serve(ctx, "https://www.americanas.com.br/**", "shop-experimental.html")
    page = open_page(ctx, "https://www.americanas.com.br/produto/111111")
    page.evaluate("document.querySelectorAll('[data-i=\"ruim\"], [data-i=\"sp\"]').forEach(e => e.remove())")
    inject(page, S)
    page.wait_for_timeout(400)
    assert page.evaluate("document.querySelectorAll('.us-sf-dot').length + (document.getElementById('us-shop-filter') ? 1 : 0)") == 0


def test_relogio_nao_provoca_varreduras(make_ctx):
    ctx = make_ctx()
    serve(ctx, "https://www.amazon.com.br/**", "shop-amazon.html")
    page = ctx.new_page()
    page.clock.install()
    page.goto(AMZ, wait_until="load")
    page.evaluate("""() => { const h = document.createElement('div'); h.id = 'relogio'; document.body.prepend(h);
      let n = 0; setInterval(() => { h.textContent = 'agora ' + (++n); }, 1000); }""")
    inject(page, S)
    page.clock.run_for(10000)
    assert int(page.evaluate(STATS)["scans"]) <= 2
    page.evaluate("addMore()")
    page.clock.run_for(1000)
    assert by_id(page)["late"]["v"] == "fail", "cartão novo ainda provoca varredura"


def test_posicao_relative_so_em_cartao_static(make_ctx):
    ctx, page = amazon(make_ctx)
    page.evaluate("document.querySelector('[data-id=\"pass\"]').style.position = 'sticky'")
    page.locator("#us-shop-filter .pill").click()
    set_range(page, "#r", 4.6)  # força nova varredura
    r = page.evaluate("""() => ['pass', 'lowrate'].map(i => { const c = document.querySelector(`[data-id="${i}"]`);
      return [c.classList.contains('us-sf-rel'), getComputedStyle(c).position]; })""")
    assert r == [[False, "sticky"], [True, "relative"]]


# Item da grade ocupado por cada cartão: posição do canto, oculto e se é filho direto do contêiner.
GRID = """sel => Object.fromEntries([...document.querySelectorAll(sel)].map(e => { const r = e.getBoundingClientRect();
  return [e.dataset.i, {x: Math.round(r.left), y: Math.round(r.top), hidden: getComputedStyle(e).display === 'none',
    v: e.querySelector('.us-sf-dot')?.dataset.v || null}]; }))"""


def test_aliexpress_ocultar_tira_o_item_da_grade_sem_buraco(make_ctx):
    ctx = make_ctx()
    ctx.add_init_script("localStorage.setItem('__gm:site:aliexpress', JSON.stringify({mode: 'hide'}))")
    serve(ctx, "https://pt.aliexpress.com/**", "ali-grade.html")
    page = open_page(ctx, "https://pt.aliexpress.com/w/wholesale-descalcificador.html")
    before = page.evaluate(GRID, "#card-list > *")
    inject(page, S)
    after = page.evaluate(GRID, "#card-list > *")
    assert [k for k, v in after.items() if v["hidden"]] == ["b", "e"]
    # o próprio filho direto de #card-list some (não o invólucro interno) e os seguintes sobem uma casa
    assert page.evaluate("[...document.querySelectorAll('.us-sf-hide')].every(e => e.parentElement.id === 'card-list')")
    assert (after["c"]["x"], after["c"]["y"]) == (before["b"]["x"], before["b"]["y"])
    assert (after["f"]["x"], after["f"]["y"]) == (before["d"]["x"], before["d"]["y"])
    assert after["a"]["v"] == "pass" and after["h"]["v"] == "pass"
    st = page.evaluate(STATS)
    assert (st["total"], st["fail"], st["hidden"]) == ("8", "2", "2")
    # desligar ocultar devolve os itens, esmaecidos
    page.locator("#us-shop-filter .pill").click()
    page.locator('#us-shop-filter .sw[data-k="hide"]').click()
    back = page.evaluate(GRID, "#card-list > *")
    assert not any(v["hidden"] for v in back.values()) and back["b"]["v"] == "fail"
    assert page.errors == []


def test_amazon_circulo_alinhado_na_moldura_da_foto(make_ctx):
    ctx = make_ctx()
    serve(ctx, "https://www.amazon.com.br/**", "shop-amazon-grade.html")
    page = open_page(ctx, AMZ)
    inject(page, S)
    d = page.evaluate("""() => [...document.querySelectorAll('[data-component-type="s-search-result"]')].map(c => {
      const f = c.querySelector('.s-image-square-aspect').getBoundingClientRect(), i = c.querySelector('.s-image').getBoundingClientRect();
      const o = c.querySelector('.us-sf-dot > i').getBoundingClientRect();
      return {id: c.dataset.id, frame: [o.top - f.top, o.left - f.left], img: [o.top - i.top, o.left - i.left], top: o.top, left: o.left - c.getBoundingClientRect().left}; })""")
    assert all(x["frame"] == [12, 12] for x in d), d
    assert any(x["img"] != [12, 12] for x in d), "a foto varia dentro da moldura: o círculo não segue a foto"
    for row in (d[:4], d[4:]):  # mesma fileira, com ou sem selo: mesma altura e mesma distância da borda do cartão
        assert len({x["top"] for x in row}) == 1 and len({x["left"] for x in row}) == 1, row
    assert page.errors == []


def shopee(make_ctx, **kw):
    ctx = make_ctx()
    if kw.get("hide"):
        ctx.add_init_script("localStorage.setItem('__gm:site:shopee', JSON.stringify({mode: 'hide'}))")
    serve(ctx, "https://shopee.com.br/**", "shop-shopee.html")
    page = open_page(ctx, "https://shopee.com.br/search?keyword=descalcificador")
    return ctx, page


def test_shopee_circulo_no_canto_da_foto(make_ctx):
    ctx, page = shopee(make_ctx)
    inject(page, S)
    d = page.evaluate("""() => [...document.querySelectorAll('li.shopee-search-item-result__item')].filter(li => li.querySelector('.us-sf-dot')).map(li => {
      const i = li.querySelector('img.main').getBoundingClientRect(), o = li.querySelector('.us-sf-dot > i').getBoundingClientRect();
      return [li.dataset.i, o.top - i.top, o.left - i.left, o.bottom <= i.bottom]; })""")
    assert d and all(x[1:] == [12, 12, True] for x in d), d
    c = page.evaluate(GRID, "li.shopee-search-item-result__item")
    assert {k: v["v"] for k, v in c.items()} == {"ok": "pass", "ruim": "fail", "poucas": "fail", "ad": None, "ok2": "pass", "nada": "unknown", "ok3": "pass"}
    assert c["ad"]["hidden"], "Shopee verificada: patrocinado reprovado some"
    page.locator("#us-shop-filter .pill").click()
    assert shadow(page, "return r.querySelector('.note.exp')") is None, "sem aviso de experimental"


def test_shopee_ocultar_reprovados_tira_o_li(make_ctx):
    ctx, page = shopee(make_ctx, hide=True)
    before = page.evaluate(GRID, "li.shopee-search-item-result__item")
    inject(page, S)
    after = page.evaluate(GRID, "li.shopee-search-item-result__item")
    assert sorted(k for k, v in after.items() if v["hidden"]) == ["ad", "poucas", "ruim"]
    assert page.evaluate("[...document.querySelectorAll('.us-sf-hide')].every(e => e.matches('li.shopee-search-item-result__item'))")
    assert (after["ok2"]["x"], after["ok2"]["y"]) == (before["ruim"]["x"], before["ruim"]["y"])
    st = page.evaluate(STATS)
    assert (st["fail"], st["hidden"], st["spHidden"], st["dimmed"]) == ("3", "2", "1", "0")
    assert page.errors == []
