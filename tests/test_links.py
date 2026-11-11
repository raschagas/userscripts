"""georritmo-links: links gerados para Jellyfin, Seerr, Mealie e Google Voos ⇄ Skyscanner (sem rede)."""
import base64
from urllib.parse import quote

from conftest import inject, open_page, serve

S = "georritmo-links.user.js"
LINKS = "() => { const h = document.getElementById('us-georritmo-links'); return h ? [h.shadowRoot.querySelector('.lbl').textContent, ...[...h.shadowRoot.querySelectorAll('a')].map(a => [a.dataset.svc, a.href])] : null; }"


def run(make_ctx, fixture, url, mobile=False):
    ctx = make_ctx(mobile=mobile)
    serve(ctx, url.split("?")[0].split("#")[0] + "*", fixture)
    page = open_page(ctx, url)
    inject(page, S)
    return page


def test_letterboxd_tmdb(make_ctx):
    p = run(make_ctx, "links-letterboxd.html", "https://letterboxd.com/film/central-station/")
    assert p.evaluate(LINKS) == ["homelab",
                                 ["jellyfin", "https://jellyfin.georritmo.com/web/#/search?query=Central%20Station"],
                                 ["seerr", "https://seerr.georritmo.com/movie/666"]]
    assert p.errors == []


def test_imdb_sem_tmdb_busca(make_ctx):
    p = run(make_ctx, "links-imdb.html", "https://www.imdb.com/title/tt0140888/")
    assert p.evaluate(LINKS)[2] == ["seerr", "https://seerr.georritmo.com/search?query=Central%20do%20Brasil"]


def test_receita_graph_e_lista(make_ctx):
    url = "https://www.tudogostoso.com.br/receita/2384-pao-de-queijo-de-liquidificador.html"
    p = run(make_ctx, "links-recipe.html", url)
    assert p.evaluate(LINKS) == ["homelab", ["mealie", f"https://receitas.georritmo.com/g/home/r/create/url?recipe_import_url={quote(url, safe='')}"]]
    p = run(make_ctx, "links-recipe-array.html", "https://www.allrecipes.com/recipe/1/bolo/")
    assert p.evaluate(LINKS)[1][0] == "mealie"


def test_sem_receita_sem_chip(make_ctx):
    p = run(make_ctx, "links-norecipe.html", "https://www.tudogostoso.com.br/categorias/bolos")
    assert p.evaluate(LINKS) is None
    assert p.evaluate("document.querySelectorAll('#us-georritmo-links, #us-tokens-links').length") == 0


def test_google_voos_q_para_skyscanner(make_ctx):
    q = quote("Flights from CNF to SSA on 2027-03-10 through 2027-03-17")
    p = run(make_ctx, "links-blank.html", f"https://www.google.com/travel/flights?q={q}&hl=pt-BR&curr=BRL")
    assert p.evaluate(LINKS) == ["comparar", ["skyscanner", "https://www.skyscanner.com.br/transporte/passagens-aereas/cnf/ssa/270310/270317/"]]


def test_google_voos_tfs_para_skyscanner(make_ctx):
    # Duas pernas no formato protobuf do tfs: data (campo 2), origem e destino (campo 2 = código IATA).
    leg = lambda d, o, t: b"\x1a\x1e\x12\x0a" + d.encode() + b"j\x07\x08\x01\x12\x03" + o.encode() + b"r\x07\x08\x01\x12\x03" + t.encode()
    raw = b"\x08\x1c\x10\x02" + leg("2027-03-10", "CNF", "GRU") + leg("2027-03-24", "GRU", "CNF")
    tfs = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    p = run(make_ctx, "links-blank.html", f"https://www.google.com/travel/flights/search?tfs={tfs}&hl=pt-BR")
    assert p.evaluate(LINKS)[1] == ["skyscanner", "https://www.skyscanner.com.br/transporte/passagens-aereas/cnf/gru/270310/270324/"]


def test_skyscanner_para_google_voos(make_ctx):
    p = run(make_ctx, "links-blank.html", "https://www.skyscanner.com.br/transporte/passagens-aereas/cnf/ssa/270310/270317/?adultsv2=1")
    lbl, (svc, href) = p.evaluate(LINKS)
    assert (lbl, svc) == ("comparar", "gflights")
    assert href == "https://www.google.com/travel/flights?q=" + quote("Flights from CNF to SSA on 2027-03-10 through 2027-03-17", safe="") + "&hl=pt-BR&curr=BRL"


def test_spa_muda_rota(make_ctx):
    q = quote("Flights from CNF to SSA on 2027-03-10")
    p = run(make_ctx, "links-blank.html", f"https://www.google.com/travel/flights?q={q}")
    p.evaluate("history.pushState({}, '', '/travel/flights?q=' + encodeURIComponent('Flights from GRU to POA on 2027-02-01')); document.getElementById('app').textContent = 'nova busca';")
    p.wait_for_timeout(1200)
    assert p.evaluate(LINKS)[1][1] == "https://www.skyscanner.com.br/transporte/passagens-aereas/gru/poa/270201/"


SIZES = "[...document.getElementById('us-georritmo-links').shadowRoot.querySelectorAll('a,button')].map(e => { const r = e.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); })"


def test_esconder_e_toque_celular(make_ctx):
    p = run(make_ctx, "links-letterboxd.html", "https://letterboxd.com/film/central-station/", mobile=True)
    assert min(p.evaluate(SIZES)) >= 44, p.evaluate(SIZES)
    p.locator("#us-georritmo-links button").tap()
    assert p.evaluate(LINKS) is None


def test_alvo_44px_no_pc_com_visual_compacto(make_ctx):
    p = run(make_ctx, "links-letterboxd.html", "https://letterboxd.com/film/central-station/")
    assert min(p.evaluate(SIZES)) >= 44, p.evaluate(SIZES)
    vis = p.evaluate("[...document.getElementById('us-georritmo-links').shadowRoot.querySelectorAll('a > span')].map(e => Math.round(e.getBoundingClientRect().height))")
    assert vis == [32, 32]


def test_voos_sem_rota_na_url_nao_le_o_texto(make_ctx):
    p = run(make_ctx, "links-blank.html", "https://www.google.com/travel/flights")
    p.evaluate("document.getElementById('app').textContent = 'Câmbio BRL - USD hoje'")
    p.wait_for_timeout(1000)
    assert p.evaluate(LINKS) is None


def test_enderecos_configuraveis(make_ctx):
    ctx = make_ctx()
    serve(ctx, "https://letterboxd.com/film/*", "links-letterboxd.html")
    ctx.add_init_script("localStorage.setItem('__gm:jellyfin', JSON.stringify('https://jellyfin.casa.example/'))")
    p = open_page(ctx, "https://letterboxd.com/film/central-station/")
    inject(p, S)
    assert p.evaluate(LINKS)[1][1].startswith("https://jellyfin.casa.example/web/#/search?query=")
