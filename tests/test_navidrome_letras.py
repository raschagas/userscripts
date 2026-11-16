"""navidrome-letras: conversão para o formato nativo, patch das respostas /api/song e cache (sem rede)."""
import json
from urllib.parse import parse_qs, urlsplit

import pytest

from conftest import FIX, SRC, open_page, serve, source
from matchpattern import metadata, runs_on

S = "navidrome-letras.user.js"
APP = "https://music.georritmo.com/app/"
SESSION = ("localStorage.setItem('username', 'ouvinte'); localStorage.setItem('subsonic-salt', 'sal123');"
           "localStorage.setItem('subsonic-token', 'tok456');")
LYR = {"s1": "navidrome-lyrics-synced.json", "p1": "navidrome-lyrics-plain.json", "n1": "navidrome-lyrics-none.json"}
EMB = json.dumps([{"lang": "kor", "synced": True, "line": [{"start": 1000, "value": "embutida"}]}])
SONGS = [
    {"id": "e1", "title": "Embutida", "duration": 180, "lyrics": EMB},
    {"id": "s1", "title": "Sidecar sincronizada", "duration": 200, "lyrics": "[]"},
    {"id": "p1", "title": "Só texto", "duration": 100, "lyrics": "[]"},
    {"id": "n1", "title": "Instrumental", "duration": 90, "lyrics": ""},
]
TRACKS = [{"id": "pt-1", "mediaFileId": "s1", "title": "Na playlist", "duration": 200, "lyrics": "[]"}]
FETCH = """async ([u, m]) => { const r = await fetch(u, m ? { method: m } : undefined);
  return { status: r.status, total: r.headers.get('x-total-count'), body: await r.json() }; }"""


def app(make_ctx, session=True, init="", songs_status=200, fail_once=(), big=0):
    ctx = make_ctx()
    serve(ctx, APP + "*", "navidrome-app.html")
    reqs, api, failed = [], [], set()

    def lyrics(route):
        q = parse_qs(urlsplit(route.request.url).query)
        reqs.append(q)
        i = q["id"][0]
        if i in fail_once and i not in failed:  # primeira vez: erro do servidor
            failed.add(i)
            kind, how = fail_once[i] if isinstance(fail_once, dict) else ("http", None)
            if kind == "http":
                return route.fulfill(status=500, body=b"erro", content_type="text/plain")
            return route.fulfill(status=200, body=b'{"subsonic-response":{"status":"failed","error":{"code":0}}}', content_type="application/json")
        key = i if i in LYR else {"s": "s1", "p": "p1", "n": "n1"}.get(i[:1])
        body = (FIX / LYR[key]).read_bytes() if key else b'{"subsonic-response":{"status":"failed"}}'
        route.fulfill(status=200, body=body, content_type="application/json")

    def songs(route):
        api.append((route.request.method, urlsplit(route.request.url).path))
        path = urlsplit(route.request.url).path
        if path == "/api/song":
            data = [{"id": f"s{k}", "title": f"Faixa {k}", "lyrics": "[]"} for k in range(big)] if big else SONGS
        elif path.startswith("/api/song/"):
            data = next(s for s in SONGS if s["id"] == path.rsplit("/", 1)[1])
        elif path.endswith("/tracks"):
            data = TRACKS
        else:
            data = {"id": "x", "lyrics": "[]"}
        route.fulfill(status=songs_status, body=json.dumps(data), content_type="application/json; charset=utf-8",
                      headers={"X-Total-Count": str(len(data) if isinstance(data, list) else 1)})
    ctx.route("**/rest/getLyricsBySongId*", lyrics)
    ctx.route("https://music.georritmo.com/api/**", songs)
    ctx.add_init_script("localStorage.setItem('__gm:debug', 'true');" + (SESSION if session else "") + init)
    ctx.add_init_script(source(S))  # document-start, como no gerenciador
    page = open_page(ctx, APP + "#/album/x/show")
    page.reqs, page.api = reqs, api
    return page


def get(page, url, method=None):
    return page.evaluate(FETCH, [url, method])


# ---------- conversão (lógica pura, no contexto da página) ----------

def native(make_ctx, fixture):
    data = json.loads((FIX / fixture).read_text())
    raw = app(make_ctx).evaluate(f"__usNavidromeLetras.toNative({json.dumps(data)})")
    return None if raw is None else json.loads(raw)


def test_sincronizada_vira_formato_nativo(make_ctx):
    got = native(make_ctx, "navidrome-lyrics-synced.json")
    assert got == [{"lang": "por", "synced": True, "line": [
        {"start": 5000, "value": "primeira linha"}, {"start": 12000, "value": "segunda linha"},
        {"start": 20000, "value": ""}, {"start": 25000, "value": "terceira <b>linha</b>"},
        {"start": 30000, "value": "quebra de linha"}]}]


def test_so_texto_fica_de_fora(make_ctx):
    assert native(make_ctx, "navidrome-lyrics-plain.json") is None


def test_instrumental_e_falha_sem_letra(make_ctx):
    assert native(make_ctx, "navidrome-lyrics-none.json") is None
    p = app(make_ctx)
    assert p.evaluate("[__usNavidromeLetras.toNative({'subsonic-response': {status: 'failed'}}),"
                      " __usNavidromeLetras.toNative(null)]") == [None, None]


def test_tem_sincronizada(make_ctx):
    p = app(make_ctx)
    assert p.evaluate(f"""[__usNavidromeLetras.hasSynced({json.dumps(EMB)}), __usNavidromeLetras.hasSynced('[]'),
      __usNavidromeLetras.hasSynced(''), __usNavidromeLetras.hasSynced('não é json'),
      __usNavidromeLetras.hasSynced('[{{"synced":false,"line":[{{"value":"x"}}]}}]')]""") == [True, False, False, False, False]


# ---------- patch das respostas ----------

def test_lista_preenche_so_o_que_falta_e_preserva_cabecalhos(make_ctx):
    p = app(make_ctx)
    r = get(p, "/api/song?album_id=x&_start=0&_end=15")
    assert r["status"] == 200 and r["total"] == "4"
    by = {s["id"]: s for s in r["body"]}
    assert by["e1"]["lyrics"] == EMB  # embutida intocada
    assert json.loads(by["s1"]["lyrics"])[0]["line"][0] == {"start": 5000, "value": "primeira linha"}
    assert by["p1"]["lyrics"] == "[]" and by["n1"]["lyrics"] == ""
    assert sorted(q["id"][0] for q in p.reqs) == ["n1", "p1", "s1"]  # nunca pede a que já tem sincronizada
    q = p.reqs[0]
    assert (q["u"], q["t"], q["s"], q["c"], q["f"]) == (["ouvinte"], ["tok456"], ["sal123"], ["NavidromeUI"], ["json"])
    assert p.errors == []


def test_uma_requisicao_por_faixa(make_ctx):
    p = app(make_ctx)
    get(p, "/api/song?album_id=x")
    get(p, "/api/song?album_id=x")
    r = get(p, "/api/song/s1")
    assert json.loads(r["body"]["lyrics"])[0]["synced"] is True
    p.evaluate("Promise.all([fetch('/api/song/p1'), fetch('/api/song/p1')])")
    assert len(p.reqs) == 3, [q["id"] for q in p.reqs]


def test_concorrentes_compartilham_a_mesma_busca(make_ctx):
    p = app(make_ctx)
    p.evaluate("Promise.all([fetch('/api/song?a=1'), fetch('/api/song?a=2'), fetch('/api/song/s1')])")
    assert sorted(q["id"][0] for q in p.reqs) == ["n1", "p1", "s1"]


def test_tarefa_que_lanca_sincronamente_libera_vaga(make_ctx):
    # fetch original lança de forma síncrona nas primeiras CONCURRENCY consultas; as seguintes ainda precisam rodar
    init = ("const f = window.fetch; let n = 0; window.fetch = function (u, o) {"
            "if (String(u).includes('getLyricsBySongId') && n++ < 4) throw new Error('boom');"
            "return f.call(this, u, o); };")
    p = app(make_ctx, init=init, big=4)
    get(p, "/api/song?album_id=x")
    p.evaluate("Promise.all([fetch('/api/song/s1'), fetch('/api/song/p1'), fetch('/api/song/n1')])")
    assert sorted(q["id"][0] for q in p.reqs) == ["n1", "p1", "s1"], [q["id"] for q in p.reqs]


def test_faixas_de_playlist_usam_media_file_id(make_ctx):
    p = app(make_ctx)
    r = get(p, "/api/playlist/abc/tracks?_start=0&_end=50")
    assert r["body"][0]["id"] == "pt-1" and json.loads(r["body"][0]["lyrics"])[0]["line"][1]["value"] == "segunda linha"
    assert [q["id"][0] for q in p.reqs] == ["s1"]


@pytest.mark.parametrize("url,method", [("/api/album/x", None), ("/api/song/s1", "PUT"), ("/api/songs", None),
                                        ("/rest/getSong?id=s1", None)])
def test_outras_rotas_e_metodos_intactos(make_ctx, url, method):
    p = app(make_ctx)
    p.evaluate(FETCH.replace("await r.json()", "await r.text()"), [url, method])
    assert p.reqs == []


def test_lista_grande_nao_espera_e_busca_em_segundo_plano(make_ctx):
    p = app(make_ctx, big=40)
    r = get(p, "/api/song?_start=0&_end=40")
    assert r["total"] == "40" and all(s["lyrics"] == "[]" for s in r["body"])  # não esperou
    p.wait_for_function("() => window.__usNavidromeLetras.done.size === 40")
    assert len(p.reqs) == 40
    r = get(p, "/api/song?_start=0&_end=40")
    assert all(json.loads(s["lyrics"])[0]["synced"] for s in r["body"])  # já guardadas
    assert len(p.reqs) == 40  # nenhuma nova


def test_aleatoria_nao_espera(make_ctx):
    p = app(make_ctx)
    r = get(p, "/api/song?_sort=random&_order=ASC&_start=0&_end=4")
    assert {s["id"]: s["lyrics"] for s in r["body"]}["s1"] == "[]"
    p.wait_for_function("() => window.__usNavidromeLetras.done.size === 3")
    r = get(p, "/api/song?_sort=random&_order=ASC&_start=0&_end=4")
    assert json.loads({s["id"]: s["lyrics"] for s in r["body"]}["s1"])[0]["synced"] is True
    assert len(p.reqs) == 3


@pytest.mark.parametrize("kind", ["http", "subsonic"])
def test_falha_nao_fica_guardada(make_ctx, kind):
    p = app(make_ctx, fail_once={"s1": (kind, None)})
    assert get(p, "/api/song/s1")["body"]["lyrics"] == "[]"
    assert json.loads(get(p, "/api/song/s1")["body"]["lyrics"])[0]["synced"] is True
    get(p, "/api/song/s1")
    assert len(p.reqs) == 2  # falha + sucesso; depois, cache


def test_sem_letra_fica_guardada(make_ctx):
    p = app(make_ctx)
    get(p, "/api/song/p1")
    get(p, "/api/song/p1")
    assert len(p.reqs) == 1


def test_erro_http_intacto(make_ctx):
    p = app(make_ctx, songs_status=500)
    r = get(p, "/api/song/s1")
    assert r["status"] == 500 and r["body"]["lyrics"] == "[]" and p.reqs == []


def test_sem_sessao_nao_pede_e_tenta_depois(make_ctx):
    p = app(make_ctx, session=False)
    assert get(p, "/api/song/s1")["body"]["lyrics"] == "[]" and p.reqs == []
    p.evaluate(SESSION)
    assert json.loads(get(p, "/api/song/s1")["body"]["lyrics"])[0]["synced"] is True
    assert len(p.reqs) == 1


def test_menu_e_desligar(make_ctx):
    p = app(make_ctx)
    assert p.evaluate("window.__menu.map(m => m.t)") == ["Desligar letras neste site"]
    p = app(make_ctx, init="localStorage.setItem('__gm:desligado', '\"music.georritmo.com\"');")
    assert p.evaluate("window.__usNavidromeLetrasOn === undefined") is True
    assert get(p, "/api/song/s1")["body"]["lyrics"] == "[]" and p.reqs == []
    assert p.evaluate("window.__menu.map(m => m.t)") == ["Ligar letras neste site"]


# ---------- escopo ----------

META = metadata((SRC / S).read_text(encoding="utf-8"))


@pytest.mark.parametrize("url,expected", [
    ("https://music.georritmo.com/app/", True),
    ("https://music.georritmo.com/app/#/album/AlbumIdExemplo123/show", True),
    ("https://music.georritmo.com/", False),
    ("https://music.georritmo.com/rest/stream?id=x", False),
    ("http://music.georritmo.com/app/", False),
    ("https://music.georritmo.com.evil.com/app/", False),
    ("https://evil.com/app/?u=https://music.georritmo.com/app/", False),
    ("http://navidrome.example.invalid/app/", False),  # host interno: regra @match por aparelho no gerenciador
    ("https://www.camara.leg.br/app/", False),
])
def test_escopo(url, expected):
    assert runs_on(META, url) is expected, url


def test_cabecalho_document_start_sem_frames_e_excludes():
    d = dict(META)
    assert d["run-at"] == "document-start"
    assert any(k == "noframes" for k, _ in META)
    assert [v for k, v in META if k == "exclude"] == ["*://camara.leg.br/*", "*://*.camara.leg.br/*",
                                                      "*://camara.gov.br/*", "*://*.camara.gov.br/*"]
