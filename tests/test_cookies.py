"""cookies-aceitar: CMP conhecido, aviso genérico só dentro de banner de cookies, negativos, iframes, parada aos 15 s."""
import pytest

from conftest import inject, serve, source

S = "cookies-aceitar.user.js"


def page_for(make_ctx, fixture, url, clock=False, off=None, debug=True):
    ctx = make_ctx()

    serve(ctx, url.split("?")[0] + "*", fixture)
    if off:
        ctx.add_init_script(f"localStorage.setItem('__gm:desligado', JSON.stringify('{off}'))")
    if debug:
        ctx.add_init_script("localStorage.setItem('__gm:debug', 'true')")
    page = ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    if clock:
        page.clock.install()
    page.goto(url, wait_until="load")
    return page


def test_onetrust(make_ctx):
    page = page_for(make_ctx, "cookies-onetrust.html", "https://www.exemplo-noticias.com.br/")
    inject(page, S)
    assert page.evaluate("window.accepted") == "onetrust"
    assert page.evaluate("document.documentElement.dataset.usCookies") == "cmp:#onetrust-accept-btn-handler"
    assert page.evaluate("window.formOk") is None, "OK de formulário fora do aviso nunca"
    assert page.errors == []


def test_marca_de_diagnostico_so_com_debug(make_ctx):
    page = page_for(make_ctx, "cookies-onetrust.html", "https://www.exemplo-noticias.com.br/", debug=False)
    inject(page, S)
    assert page.evaluate("window.accepted") == "onetrust"
    assert page.evaluate("'usCookies' in document.documentElement.dataset") is False


def test_generico_so_dentro_do_banner(make_ctx):
    page = page_for(make_ctx, "cookies-generic.html", "https://portal.exemplo.gov.br/")
    inject(page, S)
    assert page.evaluate("window.accepted") == "generic"
    assert page.evaluate("document.documentElement.dataset.usCookies") == "texto:Entendi"
    assert page.evaluate("window.decoyClicked") is None, "botão com 'cookie' na classe fora de aviso não conta"


def test_entendi_sem_cookie_no_nome_do_contenedor_nao_conta(make_ctx):
    page = page_for(make_ctx, "cookies-generic.html", "https://portal.exemplo.gov.br/")
    page.evaluate("document.getElementById('cookie-banner-lgpd').id = 'aviso'")
    inject(page, S)
    page.wait_for_timeout(1500)
    assert page.evaluate("window.accepted") is None


def test_id_generico_ignora_oculto_e_fora_de_aviso(make_ctx):
    page = page_for(make_ctx, "cookies-ids.html", "https://loja.exemplo.com/")
    inject(page, S)
    assert page.evaluate("[window.accepted, window.hiddenClicked, window.outside]") == ["ids", None, None]
    assert page.evaluate("document.documentElement.dataset.usCookies") == "id:.js-accept-cookies"


def test_negativos_nunca_clica(make_ctx):
    page = page_for(make_ctx, "cookies-negatives.html", "https://servico.exemplo.com.br/")
    inject(page, S)
    page.wait_for_timeout(1800)
    page.evaluate("document.body.insertAdjacentHTML('beforeend', '<div style=\"position:fixed;bottom:0\">Política de privacidade e LGPD <button onclick=\"hit(1)\">OK</button></div>')")
    page.wait_for_timeout(600)
    assert page.evaluate("window.clicked") == []
    assert page.evaluate("'usCookies' in document.documentElement.dataset") is False
    assert page.errors == []


@pytest.mark.parametrize("box,label,expected", [
    ('<div class="avisos" style="position:fixed;bottom:0">Usamos cookies. <button onclick="window.accepted=1">Aceitar cookies</button></div>', "Aceitar cookies", 1),
    ('<div id="consent-banner" style="position:fixed;bottom:0">Usamos cookies. <button onclick="window.accepted=1">Aceitar tudo</button></div>', "Aceitar tudo", 1),
    ('<div class="didomi-popup" style="position:fixed;bottom:0">Usamos cookies. <button onclick="window.accepted=1">Accept all</button></div>', "Accept all", 1),
    ('<div class="avisos" style="position:fixed;bottom:0">Usamos cookies. <button onclick="window.accepted=1">Aceitar tudo</button></div>', None, None),
    ('<div id="cookie-bar" style="position:fixed;bottom:0">Usamos cookies. <button onclick="window.accepted=1">Fechar</button></div>', None, None),
])
def test_frase_generica_exige_conteiner_de_consentimento(make_ctx, box, label, expected):
    page = page_for(make_ctx, "cookies-generic.html", "https://portal.exemplo.gov.br/")
    page.evaluate("document.getElementById('cookie-banner-lgpd').remove()")
    page.evaluate("b => document.body.insertAdjacentHTML('beforeend', b)", box)
    inject(page, S)
    page.wait_for_timeout(1500)
    assert page.evaluate("window.accepted ?? null") == expected
    assert page.evaluate("document.documentElement.dataset.usCookies || null") == (label and "texto:" + label)

def test_aviso_tardio_e_parada_aos_15s(make_ctx):
    page = page_for(make_ctx, "cookies-late.html", "https://loja.exemplo.com/?ms=3000", clock=True)
    inject(page, S)
    page.clock.run_for(3600)
    assert page.evaluate("window.accepted") == "late"

    page = page_for(make_ctx, "cookies-late.html", "https://loja.exemplo.com/?ms=16000", clock=True)
    inject(page, S)
    page.clock.run_for(17000)
    assert page.evaluate("!!document.querySelector('.lgpd')"), "aviso apareceu"
    page.clock.run_for(2000)
    assert page.evaluate("window.accepted") is None, "após 15 s o script já parou"


@pytest.mark.parametrize("fixture,expected", [("cookies-generic.html", None), ("cookies-onetrust.html", "onetrust")])
def test_iframe_so_plataformas_conhecidas(make_ctx, fixture, expected):

    ctx = make_ctx()
    serve(ctx, "https://www.exemplo-noticias.com.br/*", "frame-host.html")
    serve(ctx, "https://widget.exemplo-terceiro.com/*", fixture)
    page = ctx.new_page()
    page.goto("https://www.exemplo-noticias.com.br/", wait_until="load")
    frame = page.frame(url="https://widget.exemplo-terceiro.com/frame")
    frame.add_script_tag(content=source(S))
    page.wait_for_timeout(1500)
    assert frame.evaluate("window.accepted || null") == expected


def test_nao_mexer_neste_site(make_ctx):
    page = page_for(make_ctx, "cookies-onetrust.html", "https://www.exemplo-noticias.com.br/", off="www.exemplo-noticias.com.br")
    inject(page, S)
    page.wait_for_timeout(300)
    assert page.evaluate("window.accepted") is None
    page = page_for(make_ctx, "cookies-onetrust.html", "https://www.exemplo-noticias.com.br/")
    inject(page, S)
    assert page.evaluate("window.__menu.map(m => m.t)") == ["Não mexer nos cookies deste site"]
