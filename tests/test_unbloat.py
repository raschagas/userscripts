"""unbloat: regra ligada oculta, desligada mostra, nada fora do escopo some, nada clicado, nada na Câmara."""
import json

import pytest

from conftest import inject, serve

S = "unbloat.user.js"
VIS = "id => { const e = document.getElementById(id); return !!e && e.getClientRects().length > 0; }"

SITES = {
    "youtube": ("unbloat-youtube.html", "https://www.youtube.com/",
                {"shorts": ["g-shorts", "mg-shorts", "pv-shorts", "rs-shorts", "ri-short", "gs-shorts", "reel-shelf",
                            "vr-short", "m-short", "rel-short"],
                 "lateral": ["related"],
                 "fim": ["endscreen", "endcard"],
                 "banners": ["masthead-ad", "ri-ad", "player-ads", "ep-ads", "merch"]},
                ["masthead", "g-inicio", "g-inscricoes", "mg-inicio", "pv-inicio", "ri-video", "vr-video", "m-video",
                 "movie_player", "meta", "comments", "feed"]),
    "aliexpress": ("unbloat-aliexpress.html", "https://pt.aliexpress.com/w/wholesale-suporte.html",
                   {"app": ["aec-plugin-fixed-top-bar", "app-menu"], "popups": ["pop-promo", "pop-flutuante"]},
                   ["cabecalho", "entrar", "carrinho", "search-words", "card1", "card2", "verificacao"]),
    "amazon": ("unbloat-amazon.html", "https://www.amazon.com.br/s?k=suporte",
               {"carrosseis": ["carrossel", "anuncio-rodape"], "vistos": ["rhf"], "popups": ["sparkle"]},
               ["twotabsearchtextbox", "msg", "r1", "r2", "r3", "relacionadas", "paginacao", "navFooter"]),
    "mercadolivre": ("unbloat-mercadolivre.html", "https://www.mercadolivre.com.br/",
                     {"app": ["app-banner", "rodape-app"], "anuncios": ["anuncio"]},
                     ["categorias", "pagamento", "mais", "rodape-link"]),
}


def open_site(make_ctx, site, url=None, prefs=None, off=None, mobile=False):
    fixture, base, _rules, _keep = SITES[site]
    url = url or base
    ctx = make_ctx(mobile=mobile)
    serve(ctx, url.split("?")[0].rsplit("/", 1)[0] + "/**", fixture)
    if prefs is not None:
        ctx.add_init_script(f"localStorage.setItem('__gm:regras', {json.dumps(json.dumps(prefs))})")
    if off:
        ctx.add_init_script(f"localStorage.setItem('__gm:desligado', {json.dumps(json.dumps(off))})")
    page = ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.goto(url, wait_until="load")
    return page


def vis(page, ids):
    return {i: page.evaluate(VIS, i) for i in ids}


@pytest.mark.parametrize("site", list(SITES))
def test_padrao_oculta_regras_e_preserva_o_resto(make_ctx, site):
    _f, _u, rules, keep = SITES[site]
    page = open_site(make_ctx, site)
    hidden = [i for ids in rules.values() for i in ids]
    assert all(vis(page, hidden).values()), "fixture: tudo visível antes do script"
    inject(page, S)
    assert vis(page, hidden) == {i: False for i in hidden}
    assert vis(page, keep) == {i: True for i in keep}, "nada fora do escopo some"
    assert page.evaluate("window.clicked") == [], "nunca clica"
    assert page.errors == []


# Shorts nas recomendações ficam dentro da lateral: para vê-los, a lateral também precisa estar visível.
JUNTO = {("youtube", "shorts"): "lateral"}


@pytest.mark.parametrize("site,rule", [(s, r) for s, v in SITES.items() for r in v[2]])
def test_regra_desligada_mostra(make_ctx, site, rule):
    _f, _u, rules, _keep = SITES[site]
    off = [rule] + ([JUNTO[(site, rule)]] if (site, rule) in JUNTO else [])
    page = open_site(make_ctx, site, prefs={site: {r: False for r in off}})
    inject(page, S)
    assert vis(page, rules[rule]) == {i: True for i in rules[rule]}
    others = [i for r, ids in rules.items() if r not in off for i in ids]
    assert vis(page, others) == {i: False for i in others}


def test_menu_liga_e_desliga_ao_vivo_e_persiste(make_ctx):
    page = open_site(make_ctx, "youtube")
    inject(page, S)
    labels = page.evaluate("window.__menu.map(m => m.t)")
    assert labels == ["✓ Shorts (oculto)", "✓ Recomendações da lateral (vídeo) (oculto)",
                      "✓ Recomendações do fim do vídeo (oculto)", "✓ Banners de anúncio, Premium e loja (oculto)",
                      "✗ Feed da página inicial (visível)", "Desligar neste site (www.youtube.com)"]
    page.evaluate("window.__menu.find(m => m.t.includes('Shorts')).f()")
    assert vis(page, ["g-shorts", "rs-shorts"]) == {"g-shorts": True, "rs-shorts": True}
    assert page.evaluate("window.__menu.slice(-6)[0].t") == "✗ Shorts (visível)"
    page.evaluate("window.__menu.find(m => m.t.includes('Feed da página inicial')).f()")
    assert vis(page, ["feed"]) == {"feed": False}, "feed opcional ligado oculta"
    page.reload(wait_until="load")
    inject(page, S)
    assert vis(page, ["g-shorts", "feed", "related"]) == {"g-shorts": True, "feed": False, "related": False}


def test_desligar_neste_site(make_ctx):
    page = open_site(make_ctx, "amazon")
    inject(page, S)
    page.evaluate("window.__menu.find(m => m.t.startsWith('Desligar neste site')).f()")
    assert page.evaluate("!!document.getElementById('us-unbloat')") is False, "nenhum estilo fica na página"
    assert all(vis(page, ["carrossel", "rhf", "sparkle"]).values())
    page.reload(wait_until="load")
    inject(page, S)
    assert all(vis(page, ["carrossel", "rhf", "sparkle"]).values())
    assert page.evaluate("window.__menu.map(m => m.t).pop()") == "Ligar neste site (www.amazon.com.br)"


def test_desligado_vale_so_para_o_host(make_ctx):
    page = open_site(make_ctx, "amazon", off="pt.aliexpress.com")
    inject(page, S)
    assert vis(page, ["carrossel"]) == {"carrossel": False}


@pytest.mark.parametrize("path", ["/shorts/abcdefghijk", "/@canal/shorts"])
def test_pagina_de_shorts_nao_oculta_os_shorts(make_ctx, path):
    page = open_site(make_ctx, "youtube", url="https://www.youtube.com" + path)
    inject(page, S)
    assert vis(page, ["ri-short", "gs-shorts", "vr-short"]) == {"ri-short": True, "gs-shorts": True, "vr-short": True}
    assert vis(page, ["related", "masthead-ad"]) == {"related": False, "masthead-ad": False}, "outras regras seguem valendo"


def test_navegacao_spa_do_youtube(make_ctx):
    page = open_site(make_ctx, "youtube")
    inject(page, S)
    assert vis(page, ["ri-short"]) == {"ri-short": False}
    page.evaluate("history.pushState({}, '', '/shorts/abcdefghijk'); window.dispatchEvent(new Event('yt-navigate-finish'))")
    assert vis(page, ["ri-short"]) == {"ri-short": True}
    page.evaluate("history.pushState({}, '', '/results?search_query=x'); window.dispatchEvent(new Event('yt-navigate-finish'))")
    assert vis(page, ["ri-short"]) == {"ri-short": False}


def test_mercadolivre_devolve_a_rolagem(make_ctx):
    page = open_site(make_ctx, "mercadolivre", mobile=True)
    assert page.evaluate("getComputedStyle(document.body).overflow") == "hidden"
    inject(page, S)
    assert page.evaluate("getComputedStyle(document.body).overflow") == "auto"
    page.evaluate("scrollTo(0, 600)")
    assert page.evaluate("scrollY") > 0


def test_aliexpress_nunca_oculta_a_verificacao_de_robo(make_ctx):
    page = open_site(make_ctx, "aliexpress")
    inject(page, S)
    assert vis(page, ["verificacao"]) == {"verificacao": True}


def test_formulario_intacto(make_ctx):
    page = open_site(make_ctx, "youtube")
    page.fill("input[name=search_query]", "texto digitado")
    inject(page, S)
    assert page.input_value("input[name=search_query]") == "texto digitado"
    assert page.evaluate("window.clicked") == []


@pytest.mark.parametrize("url", ["https://www.camara.leg.br/", "https://camara.leg.br/", "https://intranet.camara.gov.br/"])
def test_nunca_na_camara(make_ctx, url):
    """Mesmo injetado por regra extra do gerenciador, o script não faz nada na Câmara."""
    ctx = make_ctx()
    serve(ctx, url + "**", "unbloat-youtube.html")
    page = ctx.new_page()
    page.goto(url, wait_until="load")
    inject(page, S)
    assert page.evaluate("!!document.getElementById('us-unbloat')") is False
    assert all(vis(page, ["g-shorts", "masthead-ad", "related"]).values())
    assert page.evaluate("window.__menu.length") == 0


def test_fora_dos_sites_nao_faz_nada(make_ctx):
    ctx = make_ctx()
    serve(ctx, "https://www.exemplo.com.br/**", "unbloat-youtube.html")
    page = ctx.new_page()
    page.goto("https://www.exemplo.com.br/", wait_until="load")
    inject(page, S)
    assert page.evaluate("!!document.getElementById('us-unbloat')") is False
    assert page.evaluate("window.__menu.length") == 0
