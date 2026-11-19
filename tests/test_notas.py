"""notas-integradas: notas do News Reader (endpoint simulado, dados fictícios) nas páginas de cada site."""
import json
from urllib.parse import parse_qs, urlsplit

from conftest import inject, open_page, serve, source

S = "notas-integradas.user.js"
API = "https://reader.georritmo.com/api/reviews/notes*"
# GM_xmlhttpRequest de teste: repassa ao route() do Playwright (com CORS da resposta simulada).
GM_XHR = """window.__req = []; window.GM_xmlhttpRequest = (o) => { window.__req.push(o);
  fetch(o.url).then(async r => o.onload({ status: r.status, responseText: await r.text() }), () => o.onerror()); };"""
R = lambda src, raw, n, url=None, self_=False, kind="critic": {"source": src, "label": src, "kind": kind, "raw_score": raw,
                                                                "normalized": n, "url": url, "self": self_}
FOUND = {"found": True, "site": None, "self_sources": [], "matched_by": "imdb_id", "candidates": [],
         "title": {"id": 1, "title": "Filme Exemplo", "media_type": "movie", "release_date": "2026-01-01"},
         "compound": "61.5", "contributors": 2,
         "ratings": [R("imdb_user", "6.4/10", 64, "https://www.imdb.com/title/tt0900001/", kind="user"),
                     R("letterboxd_user", "3.1", 62, kind="user"),
                     R("rt", "58%", 58, "https://www.rottentomatoes.com/search?search=Filme%20Exemplo"),
                     R("rt_audience", "70%", 70, kind="user"),
                     R("metacritic", "65/100", 65, "javascript:alert(1)")],
         "providers": [{"id": 1, "name": "Serviço Um"}, {"id": 2, "name": "Serviço Dois"}],
         "watch_link": "https://www.themoviedb.org/movie/900001/watch?locale=BR"}
ITEMS = """() => { const h = document.getElementById('us-notas-integradas'); if (!h) return null;
  return [...h.shadowRoot.querySelectorAll('[data-src]')].map(e => [e.dataset.src, (e.querySelector('b,.sc')||{}).textContent, e.getAttribute('href')]); }"""


def payload(site):
    d = json.loads(json.dumps(FOUND))
    selfs = {"letterboxd": ["letterboxd_user"], "rottentomatoes": ["rt", "rt_audience"], "imdb": ["imdb_user"],
             "tmdb": ["tmdb_user"], "metacritic": ["metacritic"]}.get(site, [])
    d["site"], d["self_sources"] = site, selfs
    for r in d["ratings"]:
        r["self"] = r["source"] in selfs
    return d


def run(make_ctx, url, fixture="notas-blank.html", data=None, mobile=False, dark=False, vals=None, before=None, raw=None):
    ctx = make_ctx(mobile=mobile, dark=dark)
    ctx.add_init_script(GM_XHR)
    if vals:
        ctx.add_init_script("".join(f"localStorage.setItem('__gm:{k}', {json.dumps(json.dumps(v))});" for k, v in vals.items()))
    seen = []

    def api(route):
        seen.append(route.request.url)
        site = parse_qs(urlsplit(route.request.url).query).get("url", [""])[0]
        host = urlsplit(site).hostname or ""
        s = next((v for k, v in {"letterboxd": "letterboxd", "rottentomatoes": "rottentomatoes", "imdb": "imdb",
                                 "themoviedb": "tmdb", "metacritic": "metacritic"}.items() if k in host), None)
        status, body = raw if raw is not None else (200, json.dumps(data if data is not None else payload(s)))
        route.fulfill(status=status, body=body, content_type="application/json",
                      headers={"Access-Control-Allow-Origin": "*"})
    ctx.route(API, api)
    serve(ctx, url.split("?")[0] + "*", fixture)
    page = open_page(ctx, url)
    if before:
        before(page)
    inject(page, S)
    page.seen = seen
    return page


def wait_chip(p):
    p.wait_for_function("document.getElementById('us-notas-integradas')", timeout=5000)


def test_letterboxd_manda_ids_e_omite_a_propria_nota(make_ctx):
    p = run(make_ctx, "https://letterboxd.com/film/filme-exemplo/", "notas-letterboxd.html")
    wait_chip(p)
    q = parse_qs(urlsplit(p.seen[0]).query)
    assert q == {"url": ["https://letterboxd.com/film/filme-exemplo/"], "tmdb": ["900001"], "media": ["movie"], "imdb": ["tt0900001"]}
    items = p.evaluate(ITEMS)
    assert [i[0] for i in items] == ["imdb_user", "rt", "rt_audience", "metacritic"]   # sem letterboxd_user, sem onde assistir
    assert items[0][1] == "6,4/10"
    assert items[3][2] is None, "javascript: nunca vira link"
    req = p.evaluate("window.__req.map(o => [o.method, o.anonymous])")
    assert req == [["GET", True]]
    assert p.errors == []


def test_rotten_tomatoes_mostra_onde_assistir(make_ctx):
    p = run(make_ctx, "https://www.rottentomatoes.com/m/filme_exemplo")
    wait_chip(p)
    items = p.evaluate(ITEMS)
    assert [i[0] for i in items] == ["imdb_user", "letterboxd_user", "metacritic"]
    w = p.evaluate("(() => { const w = document.getElementById('us-notas-integradas').shadowRoot.querySelector('.watch'); return [w.textContent, w.querySelector('a').href]; })()")
    assert w == ["Onde assistir no Brasil: Serviço Um, Serviço Dois · ver opções", FOUND["watch_link"]]


def test_tmdb_nao_repete_onde_assistir(make_ctx):
    p = run(make_ctx, "https://www.themoviedb.org/movie/900001-filme-exemplo")
    wait_chip(p)
    assert p.evaluate("document.getElementById('us-notas-integradas').shadowRoot.querySelector('.watch')") is None
    assert p.evaluate("document.getElementById('us-notas-integradas').shadowRoot.querySelector('.pill').textContent") == "NR 62 · 5 notas"


def test_sem_nota_sem_chip(make_ctx):
    for data in ({"found": False, "site": "imdb", "self_sources": [], "matched_by": None, "candidates": []},
                 {"found": False, "ambiguous": True, "site": "rottentomatoes", "self_sources": [], "matched_by": None,
                  "candidates": [{"id": 1}, {"id": 2}]},
                 dict(payload("imdb"), ratings=[R("imdb_user", "7/10", 70, self_=True)], providers=[]),
                 # só "onde assistir", sem nota nenhuma: também nada
                 dict(payload("imdb"), ratings=[R("imdb_user", "7/10", 70, self_=True)]),
                 dict(payload("imdb"), ratings=[])):
        p = run(make_ctx, "https://www.imdb.com/title/tt0900001/", data=data)
        p.wait_for_function("window.__req.length === 1")
        p.wait_for_timeout(300)
        assert p.evaluate(ITEMS) is None
        assert p.evaluate("document.querySelectorAll('#us-notas-integradas,#us-tokens-notas').length") == 0


def test_erro_do_servidor_ou_json_invalido_nada(make_ctx):
    for raw in ((500, json.dumps({"detail": "erro"})), (200, "{nao é json")):
        p = run(make_ctx, "https://www.imdb.com/title/tt0900001/", raw=raw)
        p.wait_for_function("window.__req.length === 1")
        p.wait_for_timeout(300)
        assert p.evaluate(ITEMS) is None
        assert p.evaluate("document.querySelectorAll('#us-notas-integradas,#us-tokens-notas').length") == 0
        assert p.errors == [], (raw, p.errors)


def test_letterboxd_serie_manda_media_tv(make_ctx):
    p = run(make_ctx, "https://letterboxd.com/film/filme-exemplo/", "notas-letterboxd.html",
            before=lambda page: page.evaluate("document.body.dataset.tmdbType = 'tv'"))
    wait_chip(p)
    q = parse_qs(urlsplit(p.seen[0]).query)
    assert q["media"] == ["tv"] and q["tmdb"] == ["900001"]


def test_texto_da_resposta_nao_vira_html(make_ctx):
    d = payload("imdb")
    d["ratings"][1]["raw_score"] = "<img src=x onerror=alert(1)>"
    p = run(make_ctx, "https://www.imdb.com/title/tt0900001/", data=d)
    wait_chip(p)
    assert p.evaluate("document.getElementById('us-notas-integradas').shadowRoot.querySelectorAll('img').length") == 0


def test_endereco_vazio_desliga(make_ctx):
    p = run(make_ctx, "https://www.imdb.com/title/tt0900001/", vals={"newsReader": ""})
    p.wait_for_timeout(500)
    assert p.seen == [] and p.evaluate(ITEMS) is None


def test_endereco_da_rede_local(make_ctx):
    ctx_url = "https://www.imdb.com/title/tt0900001/"
    p = run(make_ctx, ctx_url, vals={"newsReader": "https://outro-endereco.example/"})
    p.wait_for_function("window.__req.length === 1")
    assert p.evaluate("window.__req[0].url").startswith("https://outro-endereco.example/api/reviews/notes?")


def test_sobe_acima_do_chip_homelab(make_ctx):
    def links(page):
        page.add_script_tag(content=source("georritmo-links.user.js"))
    p = run(make_ctx, "https://letterboxd.com/film/filme-exemplo/", "notas-letterboxd.html", before=links)
    wait_chip(p)
    rects = p.evaluate("""() => ['us-notas-integradas', 'us-georritmo-links'].map(id => {
      const r = document.getElementById(id).shadowRoot.querySelector(id === 'us-notas-integradas' ? '.pill' : '.chip').getBoundingClientRect(); return [r.top, r.bottom]; })""")
    assert rects[0][1] <= rects[1][0], rects


def test_painel_abre_e_fecha_e_alvos(make_ctx):
    for mobile in (False, True):
        p = run(make_ctx, "https://www.rottentomatoes.com/m/filme_exemplo", mobile=mobile)
        wait_chip(p)
        root = "document.getElementById('us-notas-integradas').shadowRoot"
        assert p.evaluate(f"{root}.querySelector('.panel').hidden")
        assert p.evaluate(f"{root}.querySelector('.pill').textContent") == "NR 62 · 3 notas · onde assistir"
        p.locator("#us-notas-integradas .pill").click()
        assert p.evaluate(f"{root}.activeElement && {root}.activeElement.classList.contains('close')"), "foco no fechar"
        box = p.evaluate(f"{root}.querySelector('.panel').getBoundingClientRect().toJSON()")
        vw = p.viewport_size["width"]
        assert box["right"] <= vw and box["bottom"] <= p.viewport_size["height"] + 1
        if mobile:
            assert box["left"] == 0 and box["width"] == vw   # gaveta inferior
        sizes = p.evaluate(f"[...{root}.querySelectorAll('.row,.pill,button,.watch a')].map(e => [e.className || e.tagName, e.getBoundingClientRect().height])")
        assert any(k == "A" for k, _ in sizes), "link de onde assistir medido"
        assert min(h for _, h in sizes) >= 44, sizes
        p.keyboard.press("Escape")
        assert p.evaluate(f"{root}.querySelector('.panel').hidden")
        assert p.evaluate(f"{root}.activeElement && {root}.activeElement.classList.contains('pill')"), "foco volta à pílula"


def test_spa_troca_de_pagina_consulta_de_novo(make_ctx):
    p = run(make_ctx, "https://www.metacritic.com/game/jogo-um/")
    wait_chip(p)
    # A resposta da segunda página demora: as notas da primeira não podem ficar na tela enquanto isso.
    p.evaluate("""(() => { const real = window.GM_xmlhttpRequest; window.GM_xmlhttpRequest = (o) => {
      window.__req.push(o); setTimeout(() => fetch(o.url).then(async r => o.onload({ status: r.status, responseText: await r.text() })), 1500); };
      void real; })()""")
    p.evaluate("history.pushState({}, '', '/game/jogo-dois/'); document.title = 'Jogo dois'")
    p.wait_for_function("window.__req.length === 2", timeout=4000)
    assert "jogo-dois" in p.evaluate("window.__req[1].url")
    assert p.evaluate(ITEMS) is None, "notas do item anterior removidas"
    wait_chip(p)


def test_spa_voltar_popstate(make_ctx):
    # Cada consulta devolve o slug da página como título: o que aparece diz qual URL foi consultada.
    def por_slug(page):
        def api(route):
            site = parse_qs(urlsplit(route.request.url).query).get("url", [""])[0]
            d = payload("metacritic")
            d["title"]["title"] = site.rstrip("/").rsplit("/", 1)[-1]
            route.fulfill(status=200, body=json.dumps(d), content_type="application/json",
                          headers={"Access-Control-Allow-Origin": "*"})
        page.context.route(API, api)
    p = run(make_ctx, "https://www.metacritic.com/game/jogo-um/", before=por_slug)
    titulo = "(() => { const h = document.getElementById('us-notas-integradas'); return h && h.shadowRoot.querySelector('h2').textContent; })()"
    p.wait_for_function(f"{titulo} === 'jogo-um'", timeout=5000)
    p.evaluate("history.pushState({}, '', '/game/jogo-dois/'); document.title = 'Jogo dois'")
    p.wait_for_function(f"{titulo} === 'jogo-dois'", timeout=4000)
    p.evaluate("history.back()")   # popstate: volta a consultar a página anterior
    p.wait_for_function(f"{titulo} === 'jogo-um'", timeout=3000)
    assert p.evaluate("location.pathname") == "/game/jogo-um/"
    urls = [parse_qs(urlsplit(o).query)["url"][0] for o in p.evaluate("window.__req.map(o => o.url)")]
    assert urls[-1] == "https://www.metacritic.com/game/jogo-dois/" and urls[0] == "https://www.metacritic.com/game/jogo-um/"


def test_nota_sem_normalizada_sem_barra(make_ctx):
    d = payload("imdb")
    d["ratings"][1]["normalized"] = None   # letterboxd_user
    p = run(make_ctx, "https://www.imdb.com/title/tt0900001/", data=d)
    wait_chip(p)
    bars = p.evaluate("""[...document.getElementById('us-notas-integradas').shadowRoot.querySelectorAll('[data-src]')]
      .map(e => [e.dataset.src, !!e.querySelector('.bar')])""")
    assert dict(bars)["letterboxd_user"] is False and dict(bars)["rt"] is True, bars


def test_contraste_no_modo_escuro(make_ctx):
    p = run(make_ctx, "https://www.rottentomatoes.com/m/filme_exemplo", dark=True)
    wait_chip(p)
    p.locator("#us-notas-integradas .pill").click()
    ratios = p.evaluate("""(() => {
      const root = document.getElementById('us-notas-integradas').shadowRoot;
      const rgb = (c) => c.match(/[\\d.]+/g).slice(0, 3).map(Number);
      const lum = (c) => { const [r, g, b] = rgb(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
      const bg = getComputedStyle(root.querySelector('.panel')).backgroundColor;
      return { bg, ...Object.fromEntries(['.watch a', '.row small'].map(sel => [sel, ratio(getComputedStyle(root.querySelector(sel)).color, bg)])) };
    })()""")
    assert ratios["bg"] == "rgb(31, 41, 55)", ratios   # --us-surface escuro
    for sel in (".watch a", ".row small"):
        assert ratios[sel] >= 4.5, ratios


def test_esconder_no_site(make_ctx):
    p = run(make_ctx, "https://www.imdb.com/title/tt0900001/")
    wait_chip(p)
    p.evaluate("window.__menu.find(m => m.t.startsWith('Esconder')).f()")
    assert p.evaluate(ITEMS) is None
    # O menu de endereço não reativa as notas escondidas.
    p.evaluate("window.prompt = () => 'https://reader.georritmo.com'")
    p.evaluate("window.__menu.find(m => m.t.startsWith('Endereço')).f()")
    p.wait_for_timeout(400)
    assert p.evaluate(ITEMS) is None and p.evaluate("window.__req.length") == 1
    p.reload(wait_until="load")
    inject(p, S)
    p.wait_for_timeout(400)
    assert p.evaluate(ITEMS) is None and p.evaluate("window.__req.length") == 0
