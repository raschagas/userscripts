"""musica-links: leitura por site, links do Lidarr e do MusicBrainz e MBID por URL (rede simulada). Sem Navidrome."""
import json
from urllib.parse import quote

from conftest import inject, open_page, serve

S = "musica-links.user.js"
RG = "11111111-2222-3333-4444-555555555555"
AR = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
REL = "99999999-2222-3333-4444-555555555555"
LI = "https://lidarr.georritmo.com"

LINKS = """() => { const h = document.getElementById('us-musica-links'); if (!h) return null; const r = h.shadowRoot;
  return { links: [...r.querySelectorAll('a')].map(a => [a.dataset.svc, a.textContent, a.href]) }; }"""

# GM_xmlhttpRequest simulado: responde por trecho da URL (1ª chave que casar) após `delay` ms e registra
# cada chamada em window.__gmx (URL), window.__gmxT (instante) e window.__gmxO (opções sem callbacks).
GMX = """(() => { window.__gmx = []; window.__gmxT = []; window.__gmxO = []; window.__gmxResp = %s; window.__gmxDelay = %d;
  window.GM_xmlhttpRequest = o => { window.__gmx.push(o.url); window.__gmxT.push(Date.now());
    window.__gmxO.push(Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v !== 'function')));
    const k = Object.keys(window.__gmxResp).find(k => o.url.includes(k));
    setTimeout(() => { if (!k) return o.onload({ status: 404, response: null, responseText: '' });
      const r = window.__gmxResp[k]; o.onload({ status: r[0], response: r[1], responseText: JSON.stringify(r[1]) }); }, window.__gmxDelay); };
})();"""

CACHE = "(() => { try { return JSON.parse(localStorage.getItem('__gm:mbCache')) || {}; } catch (e) { return {}; } })()"


def run(make_ctx, fixture, url, resp=None, values=None, mobile=False, delay=10):
    ctx = make_ctx(mobile=mobile)
    ctx.add_init_script(GMX % (json.dumps(resp or {}), delay))
    if values:
        ctx.add_init_script("(() => { const v = %s; for (const k in v) localStorage.setItem('__gm:' + k, JSON.stringify(v[k])); })();" % json.dumps(values))
    serve(ctx, url.split("?")[0].split("#")[0] + "*", fixture)
    page = open_page(ctx, url)
    inject(page, S)
    page.wait_for_timeout(400)
    return page


def lid(term):
    return f"{LI}/add/search?term={quote(term, safe='')}"


def mb_url(resource):
    return ("https://musicbrainz.org/ws/2/url?resource=" + quote(resource, safe="")
            + "&inc=release-group-rels+release-rels+artist-rels&fmt=json")


def wait_gmx(p, n, timeout=8000):
    p.wait_for_function(f"window.__gmx.length >= {n}", timeout=timeout)


def wait_link(p, i, href, timeout=8000):
    p.wait_for_function("""([i, href]) => { const h = document.getElementById('us-musica-links');
      const a = h && h.shadowRoot.querySelectorAll('a')[i]; return !!a && a.href === href; }""", arg=[i, href], timeout=timeout)


LF_ALBUM = "https://www.last.fm/music/Banda+Exemplo/Mar+de+Vidro"
LF_ARTIST = "https://www.last.fm/music/Banda+Exemplo"


def test_musicbrainz_release_group_sem_rede(make_ctx):
    p = run(make_ctx, "musica-mb-rg.html", f"https://musicbrainz.org/release-group/{RG}")
    r = p.evaluate(LINKS)
    assert r["links"] == [
        ["lidarr", "+ Lidarr", lid(f"lidarr:{RG}")],
        ["lidarr", "+ artista", lid(f"lidarr:{AR}")],
    ]
    assert p.evaluate("window.__gmx") == []
    assert p.errors == []


def test_musicbrainz_release_acha_release_group(make_ctx):
    p = run(make_ctx, "musica-mb-release.html", f"https://musicbrainz.org/release/{REL}")
    assert p.evaluate(LINKS)["links"][0] == ["lidarr", "+ Lidarr", lid(f"lidarr:{RG}")]


def test_lastfm_resolve_mbid_pela_url(make_ctx):
    # Álbum pela URL do álbum; artista pela URL do artista (é a que o MusicBrainz costuma ligar).
    resp = {quote("Mar+de+Vidro", safe=""): [200, {"relations": [{"release_group": {"id": RG}}]}],
            quote("Banda+Exemplo", safe="") + "&inc": [200, {"relations": [{"artist": {"id": AR}}]}]}
    p = run(make_ctx, "musica-blank.html", LF_ALBUM, resp)
    wait_link(p, 1, lid(f"lidarr:{AR}"))
    r = p.evaluate(LINKS)
    assert r["links"][0] == ["lidarr", "+ Lidarr", lid(f"lidarr:{RG}")]
    assert r["links"][1] == ["lidarr", "+ artista", lid(f"lidarr:{AR}")]
    assert r["links"][2] == ["musicbrainz", "MusicBrainz", f"https://musicbrainz.org/release-group/{RG}"]
    assert p.evaluate("window.__gmx") == [mb_url(LF_ALBUM), mb_url(LF_ARTIST)]
    ts = p.evaluate("window.__gmxT")
    assert ts[1] - ts[0] >= 1095, ts  # 1 req/s também entre álbum e artista (o stub marca a hora 1-2 ms depois)
    # segunda visita: vem do cache, sem nova consulta
    p.reload(); inject(p, S); wait_link(p, 1, lid(f"lidarr:{AR}"))
    assert p.evaluate("window.__gmx") == []
    assert p.evaluate(LINKS)["links"][0][2] == lid(f"lidarr:{RG}")


def test_lastfm_mais_recomendados_nao_e_artista(make_ctx):
    for url in ("https://www.last.fm/music/+recommended", "https://www.last.fm/pt/music/+releases/out-now"):
        p = run(make_ctx, "musica-blank.html", url)
        assert p.evaluate(LINKS) is None, url
        assert p.evaluate("window.__gmx") == [], url


def test_fechar_durante_consulta_nao_volta(make_ctx):
    resp = {"ws/2/url": [200, {"relations": [{"release_group": {"id": RG}}]}]}
    p = run(make_ctx, "musica-blank.html", LF_ALBUM, resp, delay=1500)
    p.evaluate("document.getElementById('us-musica-links').shadowRoot.querySelector('button').click()")
    assert p.evaluate("document.getElementById('us-musica-links')") is None
    wait_gmx(p, 1)
    p.evaluate("document.body.appendChild(document.createElement('div')); document.title = 'outro'")
    p.wait_for_timeout(2600)  # passa da resposta (1,5 s) e do debounce do observador (0,8 s)
    assert p.evaluate("document.getElementById('us-musica-links')") is None
    assert p.evaluate("window.__gmx.length") == 1  # nada mais foi pedido depois de fechar


def test_esconder_no_site_durante_consulta(make_ctx):
    resp = {"ws/2/url": [200, {"relations": [{"release_group": {"id": RG}}]}]}
    p = run(make_ctx, "musica-blank.html", LF_ALBUM, resp, delay=1500)
    p.evaluate("window.__menu.find(m => m.t === 'Esconder o chip neste site').f()")
    p.wait_for_timeout(2000)
    assert p.evaluate("document.getElementById('us-musica-links')") is None
    assert p.evaluate("JSON.parse(localStorage.getItem('__gm:esconder'))") == "www.last.fm"


def test_sem_cache_se_release_group_falha(make_ctx):
    resp = {"ws/2/url": [200, {"relations": [{"release": {"id": REL}}]}],
            f"ws/2/release/{REL}": [503, None]}
    url = "https://open.spotify.com/intl-pt/album/0000000000000000000002"
    p = run(make_ctx, "musica-spotify.html", url, resp)
    wait_gmx(p, 3)  # url, release, release de novo (503 = tenta uma vez mais)
    p.wait_for_timeout(200)
    assert "https://open.spotify.com/album/0000000000000000000002" not in p.evaluate(CACHE)
    assert p.evaluate(LINKS)["links"][0][2] == lid("Banda Exemplo Mar de Vidro")
    ts = p.evaluate("window.__gmxT")
    assert ts[2] - ts[1] >= 2000, ts


def test_sem_cache_em_erro_de_rede(make_ctx):
    resp = {"ws/2/url": [503, None]}
    p = run(make_ctx, "musica-spotify.html", "https://open.spotify.com/album/0000000000000000000002", resp)
    wait_gmx(p, 2)
    p.wait_for_timeout(300)
    assert p.evaluate("window.__gmx.length") == 2  # sem terceira tentativa
    assert p.evaluate(CACHE) == {}
    assert p.evaluate(LINKS)["links"][0][2] == lid("Banda Exemplo Mar de Vidro")


def test_consulta_em_voo_e_reaproveitada(make_ctx):
    # SPA re-renderiza com a consulta ainda em voo: a mesma promessa serve aos dois renders.
    resp = {"ws/2/url": [200, {"relations": [{"release_group": {"id": RG}, "artist": {"id": AR}}]}]}
    p = run(make_ctx, "musica-spotify.html", "https://open.spotify.com/album/0000000000000000000002", resp, delay=1500)
    p.evaluate("document.title = document.title + ' '; document.body.appendChild(document.createElement('div'))")
    wait_link(p, 0, lid(f"lidarr:{RG}"))
    p.wait_for_timeout(300)
    assert len([u for u in p.evaluate("window.__gmx") if "ws/2/url" in u]) == 1


def test_gm_request_anonimo(make_ctx):
    p = run(make_ctx, "musica-blank.html", LF_ARTIST)
    wait_gmx(p, 1)
    o = p.evaluate("window.__gmxO[0]")
    assert o["method"] == "GET" and o["anonymous"] is True, o


def test_lastfm_artista(make_ctx):
    p = run(make_ctx, "musica-blank.html", "https://www.last.fm/pt/music/Banda+Exemplo/+wiki")
    r = p.evaluate(LINKS)
    assert [x[0] for x in r["links"]] == ["lidarr", "musicbrainz"]
    assert r["links"][0] == ["lidarr", "+ Lidarr", lid("Banda Exemplo")]


def test_spotify_release_para_release_group(make_ctx):
    resp = {"ws/2/url": [200, {"relations": [{"release": {"id": REL}}]}],
            f"ws/2/release/{REL}": [200, {"release-group": {"id": RG}, "artist-credit": [{"artist": {"id": AR}}]}]}
    p = run(make_ctx, "musica-spotify.html", "https://open.spotify.com/intl-pt/album/0000000000000000000002", resp)
    wait_link(p, 1, lid(f"lidarr:{AR}"))  # 1 req/s entre as duas consultas
    r = p.evaluate(LINKS)
    assert r["links"][0][2] == lid(f"lidarr:{RG}") and r["links"][1][2] == lid(f"lidarr:{AR}")


def test_deezer_titulo_da_aba_nao_engana(make_ctx):
    p = run(make_ctx, "musica-deezer.html", "https://www.deezer.com/br/album/123")
    assert p.evaluate(LINKS)["links"][0][2] == lid("Banda Exemplo Mar de Vidro")


def test_listenbrainz_album_pelo_titulo(make_ctx):
    p = run(make_ctx, "musica-listenbrainz.html", f"https://listenbrainz.org/album/{RG}/")
    r = p.evaluate(LINKS)
    assert r["links"] == [
        ["lidarr", "+ Lidarr", lid(f"lidarr:{RG}")],
        ["lidarr", "+ artista", lid("Banda Exemplo")],
        ["musicbrainz", "MusicBrainz", f"https://musicbrainz.org/release-group/{RG}"],
    ]
    assert p.evaluate("window.__gmx") == []  # MBID já está na URL


def test_aoty_album(make_ctx):
    p = run(make_ctx, "musica-aoty.html", "https://www.albumoftheyear.org/album/123-banda-exemplo-mar-de-vidro.php")
    r = p.evaluate(LINKS)
    assert r["links"][0] == ["lidarr", "+ Lidarr", lid("Banda Exemplo Mar de Vidro")]
    assert r["links"][1] == ["lidarr", "+ artista", lid("Banda Exemplo")]
    assert p.evaluate("window.__gmx") == []


def test_discogs_prefixo_de_idioma(make_ctx):
    for url in ("https://www.discogs.com/pt_BR/master/42-Banda-Exemplo-Mar-de-Vidro",
                "https://www.discogs.com/de/master/42-Banda-Exemplo-Mar-de-Vidro"):
        p = run(make_ctx, "musica-discogs.html", url)
        assert p.evaluate(LINKS)["links"][0][2] == lid("Banda Exemplo Mar de Vidro"), url
        wait_gmx(p, 1)
        assert p.evaluate("window.__gmx")[0] == mb_url("https://www.discogs.com/master/42"), url


def test_pagina_estatica_para_de_observar(make_ctx):
    # MusicBrainz não é SPA: depois do primeiro desenho, mudanças no DOM não re-renderizam.
    p = run(make_ctx, "musica-mb-rg.html", f"https://musicbrainz.org/release-group/{RG}")
    other = "22222222-2222-3333-4444-555555555555"
    p.evaluate(f"history.pushState(null, '', '/release-group/{other}'); document.title = 'x'; document.body.appendChild(document.createElement('div'))")
    p.wait_for_timeout(1200)
    assert p.evaluate(LINKS)["links"][0][2] == lid(f"lidarr:{RG}")


def test_spa_reve_ao_navegar(make_ctx):
    p = run(make_ctx, "musica-spotify.html", "https://open.spotify.com/album/0000000000000000000002")
    p.evaluate("history.pushState(null, '', '/search/banda'); document.body.appendChild(document.createElement('div'))")
    p.wait_for_function("!document.getElementById('us-musica-links')", timeout=3000)


def test_rym_bandcamp_apple_discogs(make_ctx):
    casos = [("musica-rym.html", "https://rateyourmusic.com/release/album/banda-exemplo/mar-de-vidro/"),
             ("musica-bandcamp.html", "https://bandaexemplo.bandcamp.com/album/mar-de-vidro"),
             ("musica-apple.html", "https://music.apple.com/br/album/mar-de-vidro/42"),
             ("musica-discogs.html", "https://www.discogs.com/master/42-Banda-Exemplo-Mar-de-Vidro")]
    for fx, url in casos:
        p = run(make_ctx, fx, url)
        assert p.evaluate(LINKS)["links"][0][2] == lid("Banda Exemplo Mar de Vidro"), url


def test_apple_tenta_paises(make_ctx):
    p = run(make_ctx, "musica-apple.html", "https://music.apple.com/br/album/mar-de-vidro/42")
    wait_gmx(p, 3)
    mb = [u for u in p.evaluate("window.__gmx") if "ws/2/url" in u]
    assert [u.split("resource=")[1].split("&")[0] for u in mb] == [
        quote(f"https://music.apple.com/{c}/album/42", safe="") for c in ("br", "us", "gb")]


def test_lidarr_vazio_some(make_ctx):
    p = run(make_ctx, "musica-blank.html", "https://www.last.fm/music/Banda+Exemplo", values={"lidarr": ""})
    assert [x[0] for x in p.evaluate(LINKS)["links"]] == ["musicbrainz"]


def test_nunca_consulta_o_navidrome(make_ctx):
    # Valores antigos de uma versão de teste não podem reativar consulta passiva à biblioteca.
    old = {"navidrome": "https://music.georritmo.com", "navidromeConta": {"u": "ouvinte", "t": "0" * 32, "s": "abc"}}
    p = run(make_ctx, "musica-blank.html", LF_ALBUM, values=old)
    wait_gmx(p, 2)
    assert all("musicbrainz.org/ws/2/" in u for u in p.evaluate("window.__gmx"))
    assert "navidrome" not in [x[0] for x in p.evaluate(LINKS)["links"]]


def test_sem_chip_fora_de_album(make_ctx):
    p = run(make_ctx, "musica-blank.html", "https://open.spotify.com/search/banda")
    assert p.evaluate(LINKS) is None
    assert p.evaluate("document.querySelectorAll('#us-musica-links, #us-tokens-musica').length") == 0


def test_fechar_nao_deixa_nada(make_ctx):
    p = run(make_ctx, "musica-mb-rg.html", f"https://musicbrainz.org/release-group/{RG}")
    p.evaluate("document.getElementById('us-musica-links').shadowRoot.querySelector('button').click()")
    assert p.evaluate("document.getElementById('us-musica-links')") is None


def test_alvos_de_44px(make_ctx):
    p = run(make_ctx, "musica-mb-rg.html", f"https://musicbrainz.org/release-group/{RG}", mobile=True)
    hs = p.evaluate("[...document.getElementById('us-musica-links').shadowRoot.querySelectorAll('a, button')].map(e => e.getBoundingClientRect().height)")
    assert hs and min(hs) >= 44


def test_rym_titulo_com_by_no_meio(make_ctx):
    p = run(make_ctx, "musica-rym-standbyme.html", "https://rateyourmusic.com/release/album/banda-exemplo/stand-by-me/")
    r = p.evaluate(LINKS)
    assert r["links"][0] == ["lidarr", "+ Lidarr", lid("Banda Exemplo Stand by Me")]
    assert r["links"][1] == ["lidarr", "+ artista", lid("Banda Exemplo")]


def test_fechar_cancela_o_que_esta_na_fila(make_ctx):
    # Álbum respondeu; a consulta do artista espera a vez (1,1 s) quando o chip é fechado: não sai.
    resp = {quote("Mar+de+Vidro", safe=""): [200, {"relations": [{"release_group": {"id": RG}}]}]}
    p = run(make_ctx, "musica-blank.html", LF_ALBUM, resp)
    wait_gmx(p, 1)
    p.wait_for_function("""() => { const h = document.getElementById('us-musica-links');
      return !!h && h.shadowRoot.querySelectorAll('a')[0].href.includes('lidarr%3A'); }""", timeout=3000)
    p.evaluate("document.getElementById('us-musica-links').shadowRoot.querySelector('button').click()")
    p.wait_for_timeout(2600)
    assert p.evaluate("window.__gmx.length") == 1
    assert p.evaluate("document.getElementById('us-musica-links')") is None
    assert p.errors == []


def test_release_404_vai_ao_cache(make_ctx):
    # Release sem cadastro (404) é resposta, não erro de rede: grava e a próxima visita não consulta.
    resp = {"ws/2/url": [200, {"relations": [{"release": {"id": REL}}]}]}   # ws/2/release/… cai no 404
    url = "https://open.spotify.com/album/0000000000000000000002"
    p = run(make_ctx, "musica-spotify.html", url, resp)
    wait_gmx(p, 2)
    p.wait_for_function(f"(() => !!{CACHE}['{url}'])()", timeout=3000)
    assert p.evaluate(CACHE)[url]["v"] == {"release": REL}
    assert p.evaluate("window.__gmx.length") == 2  # 404 não repete
    p.reload(); inject(p, S); p.wait_for_timeout(400)
    assert p.evaluate("window.__gmx") == []


def test_json_inesperado_nao_quebra(make_ctx):
    resp = {"ws/2/url": [200, {"relations": 42}]}
    p = run(make_ctx, "musica-spotify.html", "https://open.spotify.com/album/0000000000000000000002", resp)
    wait_gmx(p, 1); p.wait_for_timeout(300)
    assert p.evaluate(LINKS)["links"][0][2] == lid("Banda Exemplo Mar de Vidro")
    assert p.errors == []
