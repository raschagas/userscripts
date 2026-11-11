"""Sintaxe, cabeçalho e escopo (@match/@exclude) de todos os userscripts."""
import re
import shutil
import subprocess

import pytest

from conftest import SRC
from matchpattern import _match_one, metadata, runs_on

SCRIPTS = sorted(p.name for p in SRC.glob("*.user.js"))
RAW = "https://raw.githubusercontent.com/raschagas/userscripts/main/src/{}"
VERSIONS = {"shop-filter.user.js": "1.1.0"}  # demais scripts: 1.0.0


def meta_of(name):
    return metadata((SRC / name).read_text(encoding="utf-8"))


def test_quatro_scripts():
    assert SCRIPTS == ["cookies-aceitar.user.js", "dados-pessoais.user.js",
                       "georritmo-links.user.js", "shop-filter.user.js"]


@pytest.mark.parametrize("name", SCRIPTS)
def test_node_check(name):
    node = shutil.which("node")
    assert node, "node ausente"
    r = subprocess.run([node, "--check", str(SRC / name)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


@pytest.mark.parametrize("name", SCRIPTS)
def test_cabecalho(name):
    m = meta_of(name)
    d = {}
    for k, v in m:
        d.setdefault(k, []).append(v)
    assert d["namespace"] == ["raschagas/userscripts"]
    assert d["version"] == [VERSIONS.get(name, "1.0.0")]
    assert d["downloadURL"] == [RAW.format(name)]
    assert d["updateURL"] == [RAW.format(name)]
    assert d["name"] and d["description"]
    assert "require" not in d, "sem @require remoto"
    assert set(d["grant"]) <= {"GM_getValue", "GM_setValue", "GM_registerMenuCommand"}, d["grant"]
    assert "connect" not in d, "nenhum script faz rede"
    for k, v in m:  # comentário no fim da linha vira parte do valor
        assert "//" not in v or k in ("downloadURL", "updateURL", "match", "exclude", "namespace"), (k, v)
        if k in ("match", "exclude"):
            assert " " not in v and "//" not in v.split("://", 1)[1], (k, v)
    for p in d.get("match", []):
        _match_one(p, "https://example.com/")  # valida a sintaxe de todo @match


def test_sem_rede_no_codigo():
    for name in SCRIPTS:
        code = (SRC / name).read_text(encoding="utf-8")
        assert not re.search(r"\b(fetch|XMLHttpRequest|GM_xmlhttpRequest|sendBeacon|WebSocket)\s*\(", code), name


DP = "dados-pessoais.user.js"


@pytest.mark.parametrize("url", [
    "https://mail.google.com/mail/u/0/#inbox",
    "https://contacts.google.com/",
    "https://outlook.live.com/mail/0/",
    "https://outlook.office.com/mail/",
    "https://outlook.office365.com/mail/",
    "https://web.whatsapp.com/",
    "https://web.telegram.org/a/",
    "https://teams.microsoft.com/v2/",
    "https://teams.cloud.microsoft/",
])
def test_dados_pessoais_casa(url):
    assert runs_on(meta_of(DP), url), url


@pytest.mark.parametrize("url", [
    "https://pt.wikipedia.org/wiki/Brasil",
    "https://www.google.com/search?q=mail.google.com",
    "https://evil.com/?u=https://mail.google.com/",
    "https://mail.google.com.evil.com/",
    "https://outlook.office.com.evil.com/",
    "http://mail.google.com/",
    "https://intranet.example/",
    "http://192.0.2.15/",
])
def test_dados_pessoais_nao_casa(url):
    assert not runs_on(meta_of(DP), url), url


def test_dados_pessoais_so_sites_genericos():
    """Repositório público: nenhum endereço interno no @match (entram por regra personalizada no gerenciador)."""
    hosts = {v.split("://", 1)[1].split("/", 1)[0] for k, v in meta_of(DP) if k == "match"}
    assert hosts == {"mail.google.com", "contacts.google.com", "outlook.live.com", "outlook.office.com",
                     "outlook.office365.com", "web.whatsapp.com", "web.telegram.org", "teams.microsoft.com",
                     "teams.cloud.microsoft"}, hosts


@pytest.mark.parametrize("url,expected", [
    ("https://letterboxd.com/film/central-station/", True),
    ("https://www.imdb.com/title/tt0140888/", True),
    ("https://www.imdb.com/pt/title/tt0140888/", True),
    ("https://www.google.com/travel/flights?q=x", True),
    ("https://www.tudogostoso.com.br/receita/2384-pao-de-queijo.html", True),
    ("https://x.camara.leg.br/", False),
    ("https://camara.leg.br/", False),
    ("https://www.camara.leg.br/", False),
    ("https://x.camara.gov.br/", False),
    ("https://www.google.com/search?q=x", False),
])
def test_links_escopo(url, expected):
    assert runs_on(meta_of("georritmo-links.user.js"), url) is expected


def test_links_excludes_camara():
    ex = [v for k, v in meta_of("georritmo-links.user.js") if k == "exclude"]
    assert ex == ["*://camara.leg.br/*", "*://*.camara.leg.br/*", "*://camara.gov.br/*", "*://*.camara.gov.br/*"]


@pytest.mark.parametrize("url,expected", [
    ("https://pt.aliexpress.com/w/wholesale-suporte-monitor.html", True),
    ("https://m.aliexpress.com/w/wholesale-x.html", True),
    ("https://www.amazon.com.br/s?k=suporte", True),
    ("https://www.kabum.com.br/busca/suporte", True),
    ("https://lista.mercadolivre.com.br/suporte", True),
    ("https://shopee.com.br/search?keyword=x", True),
    ("https://br.shein.com/x", True),
    ("https://www.amazon.com/s?k=x", False),
    ("https://loja-exemplo.invalid/", False),
])
def test_shop_escopo(url, expected):
    assert runs_on(meta_of("shop-filter.user.js"), url) is expected


def test_cookies_casa_tudo():
    m = meta_of("cookies-aceitar.user.js")
    assert runs_on(m, "https://www.gov.br/pt-br") and runs_on(m, "http://exemplo.com.br/x")
    assert not runs_on(m, "file:///tmp/x.html")


@pytest.mark.parametrize("url", [
    "https://sso.acesso.gov.br/login?client_id=x",
    "https://www.camara.leg.br/",
    "https://camara.leg.br/",
    "https://x.camara.leg.br/x",
    "https://sistema.camara.gov.br/",
])
def test_cookies_nunca_em_login_gov_e_sistemas_de_trabalho(url):
    assert not runs_on(meta_of("cookies-aceitar.user.js"), url), url


def test_cookies_excludes():
    ex = [v for k, v in meta_of("cookies-aceitar.user.js") if k == "exclude"]
    assert ex == ["*://sso.acesso.gov.br/*", "*://*.camara.leg.br/*", "*://camara.leg.br/*", "*://*.camara.gov.br/*"]
