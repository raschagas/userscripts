"""zotero-salvar: captura local, pílula, painel e a ordem casa → desktop → Web API com destinos simulados."""
import json
import re
from urllib.parse import parse_qs, urlparse

import pytest

from conftest import FIX, SRC, inject, open_page, serve

S = "zotero-salvar.user.js"
ART = "https://revista.exemplo.org/artigo/42"
LIVRO = "https://livros.exemplo.org/manual"
VAZIA = "https://blog.exemplo.org/post"
PDF = "https://repositorio.exemplo.org/relatorio-final.pdf"
CHAVE = "k" * 24

ABNT_CASA = ('<div class="csl-bib-body"><div class="csl-entry">EXEMPLO, Ana Maria; MODELO FILHO, Bruno. '
             'Um estudo de caso fictício: método e resultados. <b>Revista Exemplo de Testes</b>, v. 12, n. 3, p. 45-67, 2024.'
             '<script>window.__xss = 1</script><img src="x" onerror="window.__xss = 2"></div></div>')

ABNT_CASA_TXT = ("EXEMPLO, Ana Maria; MODELO FILHO, Bruno. Um estudo de caso fictício: método e resultados. "
                 "Revista Exemplo de Testes, v. 12, n. 3, p. 45-67, 2024.")

# GM_xmlhttpRequest ligado ao Python: cada teste decide o que cada destino responde.
GMX = """(() => {
  window.GM_xmlhttpRequest = (d) => { window.__gmx({method: d.method || 'GET', url: d.url, headers: d.headers || {}, data: d.data || null,
    anonymous: !!d.anonymous}).then((r) => setTimeout(() => {
      if (r.erro === 'tempo') d.ontimeout && d.ontimeout({});
      else if (r.erro) d.onerror && d.onerror({});
      else d.onload && d.onload({status: r.status, responseText: r.text}); }, r.atraso || 0)); };
})();"""


class Destinos:
    """Simula o Zotero de casa, o Zotero desktop e a Web API; registra cada requisição."""

    def __init__(self, casa="ok", desktop="fechado", web="ok", duplicata=False, existente=None, filhos="ok", bib="ok", web_cols=None, casa_duplicata=False,
                 criar="ok", busca="ok", existente_q=None, cols_falha_start=None):
        self.casa_duplicata = casa_duplicata
        # casa="rede_save"/desktop="rede_save": /health ou ping respondem e a gravação cai por erro de rede;
        # filhos="rede": POST dos filhos sem resposta; criar="tempo"/"rede": POST do item sem resposta; busca="erro": items/top falha; existente_q: só a busca com esse q acha o item;
        # cols_falha_start: a página de coleções com esse start falha.
        self.criar, self.busca, self.existente_q, self.cols_falha_start = criar, busca, existente_q, cols_falha_start
        self.casa, self.desktop, self.web, self.duplicata = casa, desktop, web, duplicata
        self.existente, self.filhos, self.bib = existente, filhos, bib
        self.web_cols = web_cols if web_cols is not None else [{"key": "WCOL1", "data": {"name": "Testes", "parentCollection": False}}]
        self.reqs = []

    def corpo(self, trecho):
        for r in self.reqs:
            if trecho in r["url"] and r["data"]:
                return json.loads(r["data"])
        return None

    def urls(self):
        return [f'{r["method"]} {r["url"]}' for r in self.reqs]

    def __call__(self, source, d):
        self.reqs.append(d)
        u = d["url"]
        if u.startswith("http://zotero.raschagas.lan"):
            if self.casa == "fora":
                return {"erro": "rede"}
            if u.endswith("/health"):
                return {"status": 200, "text": '{"ok": true}'}
            if u.endswith("/collections"):
                return {"status": 200, "text": json.dumps({"colecoes": [{"key": "COL1", "name": "Testes", "parent": ""}, {"key": "COL2", "name": "Sub", "parent": "COL1"}]})}
            if u.endswith("/save"):
                if self.casa == "erro":
                    return {"status": 500, "text": "falhou"}
                if self.casa == "tempo":
                    return {"erro": "tempo"}
                if self.casa == "rede_save":
                    return {"erro": "rede"}
                if self.casa == "lento":
                    return {"status": 200, "atraso": 1500, "text": json.dumps({"key": "CASA0001", "abnt": ABNT_CASA_TXT, "abnt_html": ABNT_CASA,
                                                                                "faltando": [], "duplicata": False, "destino": {}})}
                return {"status": 200, "text": json.dumps({"key": "CASA0001", "abnt": ABNT_CASA_TXT, "abnt_html": ABNT_CASA,
                                                           "faltando": [{"campo": "issue", "rotulo": "número"}],
                                                           "fontes": [], "duplicata": self.casa_duplicata,
                                                           "destino": {"via": "bridge", "biblioteca": "zotero-web-api", "colecao": "", "pdf": None}})}
        if u.startswith("http://127.0.0.1:23119/connector/"):
            if self.desktop == "fechado":
                return {"erro": "rede"}
            if u.endswith("/ping"):
                return {"status": 200, "text": '{"prefs": {}}'}
            if u.endswith("/getSelectedCollection"):
                return {"status": 200, "text": json.dumps({"targets": [{"id": "L1", "name": "Minha biblioteca", "level": 0},
                                                                       {"id": "C7", "name": "Testes", "level": 1}]})}
            if u.endswith("/saveItems"):
                if self.desktop == "tempo":
                    return {"erro": "tempo"}
                if self.desktop == "rede_save":
                    return {"erro": "rede"}
                return {"status": 201, "text": ""}
            if u.endswith("/updateSession"):
                return {"status": 200, "text": "{}"}
        if u.startswith("https://api.zotero.org/"):
            if self.web == "rede":
                return {"erro": "rede"}
            if self.web == "recusa":
                return {"status": 403, "text": "Forbidden"}
            if "/keys/current" in u:
                return {"status": 200, "text": '{"userID": 999, "username": "usuario-teste"}'}
            if "/collections" in u:
                start = int(re.search(r"start=(\d+)", u).group(1)) if "start=" in u else 0
                if start == self.cols_falha_start:
                    return {"status": 500, "text": "falhou"}
                return {"status": 200, "text": json.dumps(self.web_cols[start:start + 100])}
            if "/items/top" in u:
                if self.busca == "erro":
                    return {"status": 503, "text": "indisponível"}
                if self.existente_q is not None and parse_qs(urlparse(u).query).get("q") != [self.existente_q]:
                    return {"status": 200, "text": "[]"}
                dados = {"itemType": "journalArticle", "title": "x", "DOI": "10.5555/exemplo.2024.042",
                         "creators": [{"lastName": "A"}], "publicationTitle": "R", "volume": "1",
                         "issue": "1", "pages": "1", "date": "2024"}
                if self.existente is not None:
                    dados = {"itemType": "book", "title": "x", **self.existente}
                hit = [{"key": "DUP00001", "data": dados}]
                return {"status": 200, "text": json.dumps(hit if self.duplicata or self.existente is not None else [])}
            if "format=bib" in u:
                if self.bib == "vazio":
                    return {"status": 200, "text": ""}
                return {"status": 200, "text": '<div class="csl-entry">TESTE, Carla. <b>Manual fictício de referências</b>. [<i>S. l.</i>]: Editora Fictícia, 2021.</div>'}
            if d["method"] == "POST" and u.endswith("/items"):
                if '"parentItem"' in (d["data"] or ""):
                    if self.filhos == "erro":
                        return {"status": 500, "text": "falhou"}
                    if self.filhos == "rede":
                        return {"erro": "rede"}
                    n = len(json.loads(d["data"]))
                    return {"status": 200, "text": json.dumps({"successful": {str(i): {"key": f"F{i}"} for i in range(n)}, "failed": {}})}
                if self.criar == "tempo":
                    return {"erro": "tempo"}
                if self.criar == "rede":
                    return {"erro": "rede"}
                return {"status": 200, "text": '{"successful": {"0": {"key": "WEB00001"}}, "failed": {}}'}
        return {"erro": "rede"}


# Só nos testes: o script fecha o shadow root; aqui ele é forçado a abrir para inspecionar o painel.
ABRE_SHADOW = """(() => { const a = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (o) { return a.call(this, Object.assign({}, o, { mode: 'open' })); }; })();"""


def abre(make_ctx, url, fixture, dest, mobile=False, valores=None, pdf=False, inspeciona=True):
    ctx = make_ctx(mobile=mobile)
    ctx.add_init_script(GMX)
    if inspeciona:
        ctx.add_init_script(ABRE_SHADOW)
    if pdf:
        ctx.add_init_script("Object.defineProperty(Document.prototype, 'contentType', {get: () => 'application/pdf'});")
    ctx.expose_binding("__gmx", dest)
    serve(ctx, url.split("/", 3)[0] + "//" + url.split("/", 3)[2] + "/**", fixture)
    page = open_page(ctx, url)
    if valores:
        page.evaluate("v => { for (const [k, x] of Object.entries(v)) localStorage.setItem('__gm:' + k, JSON.stringify(x)); }", valores)
    inject(page, S)
    page.wait_for_timeout(100)
    return page


def sh(page, js):
    return page.evaluate(f"(() => {{ const h = document.querySelector('zotero-salvar'); const r = h && h.shadowRoot; {js} }})()")


def salva(page, via="atalho"):
    if via == "atalho":
        page.keyboard.press("Alt+Shift+KeyZ")
    else:  # a pílula abre a prévia; o botão da prévia salva
        page.locator("zotero-salvar").locator(".pill").click()
        page.locator("zotero-salvar").locator(".salvar").click()
    page.wait_for_function("() => { const h = document.querySelector('zotero-salvar'); const s = h && h.shadowRoot.querySelector('.saida'); return s && s.textContent.trim().length > 0; }", timeout=10000)
    return sh(page, "return r.querySelector('.saida').innerText")


def gm(page, k):
    return page.evaluate(f"() => JSON.parse(localStorage.getItem('__gm:{k}') || 'null')")


# ------------------------------------------------------------------ pílula: só em página acadêmica


@pytest.mark.parametrize("url,fixture,pdf,tipo", [
    (ART, "zotero-artigo.html", False, "Artigo de periódico"),
    (LIVRO, "zotero-livro.html", False, "Livro"),
    (PDF, "zotero-pdf.html", True, "Documento"),
])
def test_pilula_em_pagina_academica(make_ctx, url, fixture, pdf, tipo):
    page = abre(make_ctx, url, fixture, Destinos(), pdf=pdf)
    assert sh(page, "return r.querySelector('.pill').getAttribute('aria-label')").startswith(f"Salvar no Zotero · {tipo}")
    assert page.errors == []


def test_sem_pilula_sem_metadados_e_sem_rede(make_ctx):
    d = Destinos()
    page = abre(make_ctx, VAZIA, "zotero-vazia.html", d)
    assert sh(page, "return r ? r.querySelector('.pill') : null") is None
    assert d.reqs == [], "nada acontece antes de o dono acionar"
    assert page.errors == []


def test_pilula_some_por_site(make_ctx):
    page = abre(make_ctx, ART, "zotero-artigo.html", Destinos(), valores={"sem_pilula": {"revista.exemplo.org": True}})
    assert sh(page, "return r ? r.querySelector('.pill') : null") is None


def test_previa_antes_de_salvar(make_ctx):
    d = Destinos(casa="ok")
    page = abre(make_ctx, LIVRO, "zotero-livro.html", d)
    page.locator("zotero-salvar").locator(".pill").click()
    txt = sh(page, "return r.querySelector('.painel').innerText")
    assert "Manual fictício de referências" in txt and "Teste · 2021" in txt
    assert "local" in sh(page, "return r.querySelector('.falta').innerText")
    assert not any(u.endswith("/save") or "saveItems" in u for u in d.urls()), "a prévia não salva"
    assert sh(page, "return [...r.querySelectorAll('select option')].map(o => o.textContent.trim())") == ["Biblioteca (sem coleção)", "Testes", "Sub"]
    page.locator("zotero-salvar").locator(".salvar").click()
    page.wait_for_function("() => document.querySelector('zotero-salvar').shadowRoot.querySelector('.saida')?.textContent")
    assert d.corpo("/save")["isbn"] == "9788533302273"


def test_alvo_de_toque(make_ctx):
    page = abre(make_ctx, ART, "zotero-artigo.html", Destinos(), mobile=True)
    box = page.locator("zotero-salvar").locator(".pill").bounding_box()
    assert box["height"] >= 44 and box["width"] >= 44
    page.locator("zotero-salvar").locator(".pill").click()
    for sel in ("select", ".salvar", ".x"):
        assert page.locator("zotero-salvar").locator(sel).bounding_box()["height"] >= 44, sel


# ------------------------------------------------------------------ 1. Zotero de casa


def test_casa_recebe_captura_completa(make_ctx):
    d = Destinos(casa="ok")
    page = abre(make_ctx, ART, "zotero-artigo.html", d)
    txt = salva(page, "pilula")
    assert "Salvo no Zotero de casa" in txt and "número" in txt and "object" not in txt
    b = d.corpo("/save")
    assert b["url"] == ART and b["doi"] == "10.5555/exemplo.2024.042"
    assert b["pdf_url"] == "https://revista.exemplo.org/artigo/42.pdf"
    assert b["html_meta"]["citation"]["citation_author"] == ["Exemplo, Ana Maria", "Bruno Modelo Filho"]
    assert b["title"].startswith("Um estudo de caso fictício")
    # Nenhum outro destino foi tentado, e a chave da Web API nunca sai para outro host.
    assert not any("127.0.0.1" in u or "api.zotero.org" in u for u in d.urls())
    assert all("Zotero-API-Key" not in r["headers"] for r in d.reqs)
    assert page.errors == []


def test_abnt_de_fora_e_sanitizada(make_ctx):
    page = abre(make_ctx, ART, "zotero-artigo.html", Destinos(casa="ok"))
    salva(page)
    html = sh(page, "return r.querySelector('.ref').innerHTML")
    assert "<script" not in html and "<img" not in html and "onerror" not in html
    assert "<b>Revista Exemplo de Testes</b>" in html
    assert "__xss" not in html and "__xss" not in sh(page, "return r.querySelector('.ref').textContent")
    assert page.evaluate("() => window.__xss") is None


def test_selecao_vai_junto(make_ctx):
    d = Destinos(casa="ok")
    page = abre(make_ctx, ART, "zotero-artigo.html", d)
    page.evaluate("() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('trecho')); getSelection().addRange(r); }")
    salva(page)
    assert d.corpo("/save")["selection"] == "Este trecho existe para testar a seleção de texto."


def test_pagina_sem_metadados_salva_pelo_atalho(make_ctx):
    d = Destinos(casa="ok")
    page = abre(make_ctx, VAZIA, "zotero-vazia.html", d)
    salva(page)
    b = d.corpo("/save")
    assert b["url"] == VAZIA and b["title"] == "Página comum sem metadados" and "doi" not in b


def test_colecao_lembrada_por_site(make_ctx):
    d = Destinos(casa="ok")
    page = abre(make_ctx, ART, "zotero-artigo.html", d, valores={"colecoes": {"revista.exemplo.org": "Testes"}})
    salva(page)
    b = d.corpo("/save")
    assert b["collection"] == "COL1" and b["collection_name"] == "Testes"
    assert not any("127.0.0.1" in u for u in d.urls()), "lista de coleções vem do Zotero de casa"
    assert sh(page, "return r.querySelector('select').value") == "COL1", "valor antigo em texto casa pelo nome"
    sh(page, "const s = r.querySelector('select'); s.value = 'COL2'; s.dispatchEvent(new Event('change'));")
    assert gm(page, "colecoes") == {"revista.exemplo.org": {"key": "COL2", "name": "Sub", "origem": "casa"}}


def test_colecao_com_chave_vai_por_origem(make_ctx):
    # Chave escolhida na lista do Zotero de casa: vai direto para o bridge.
    d = Destinos(casa="ok")
    col = {"revista.exemplo.org": {"key": "COL2", "name": "Sub", "origem": "casa"}}
    page = abre(make_ctx, ART, "zotero-artigo.html", d, valores={"colecoes": col})
    salva(page)
    assert d.corpo("/save")["collection"] == "COL2" and d.corpo("/save")["collection_name"] == "Sub"
    # Chave da Web API guardada: o bridge recebe o nome resolvido na lista dele, nunca a chave da Web API.
    d2 = Destinos(casa="ok")
    page2 = abre(make_ctx, ART, "zotero-artigo.html", d2, valores={"colecoes": {"revista.exemplo.org": {"key": "WCOL1", "name": "Testes", "origem": "web"}}})
    salva(page2)
    assert d2.corpo("/save")["collection"] == "COL1"
    # Na Web API, a chave da Web API vale; a do Zotero de casa é resolvida pelo nome; o desktop usa o nome.
    cols = [{"key": "WCOL1", "data": {"name": "Testes", "parentCollection": False}}, {"key": "WCOL2", "data": {"name": "Testes", "parentCollection": False}}]
    d3 = Destinos(casa="fora", desktop="fechado", web_cols=cols)
    page3 = abre(make_ctx, LIVRO, "zotero-livro.html", d3, valores={"zotero_key": CHAVE, "colecoes": {"livros.exemplo.org": {"key": "WCOL2", "name": "Testes", "origem": "web"}}})
    salva(page3)
    post = [json.loads(r["data"]) for r in d3.reqs if r["method"] == "POST" and r["url"].endswith("/items")][0]
    assert post[0]["collections"] == ["WCOL2"]
    d4 = Destinos(casa="fora", desktop="fechado")
    page4 = abre(make_ctx, LIVRO, "zotero-livro.html", d4, valores={"zotero_key": CHAVE, "colecoes": {"livros.exemplo.org": {"key": "COL1", "name": "Testes", "origem": "casa"}}})
    salva(page4)
    post = [json.loads(r["data"]) for r in d4.reqs if r["method"] == "POST" and r["url"].endswith("/items")][0]
    assert post[0]["collections"] == ["WCOL1"]
    d5 = Destinos(casa="fora", desktop="aberto")
    page5 = abre(make_ctx, ART, "zotero-artigo.html", d5, valores={"colecoes": {"revista.exemplo.org": {"key": "COL1", "name": "Testes", "origem": "casa"}}})
    salva(page5)
    assert d5.corpo("/connector/updateSession")["target"] == "C7"
    for p in (page, page2, page3, page4, page5):
        assert p.errors == []


# ------------------------------------------------------------------ 2. Zotero desktop


@pytest.mark.parametrize("casa", ["fora", "erro"])
def test_desktop_quando_casa_falha(make_ctx, casa):
    d = Destinos(casa=casa, desktop="aberto")
    page = abre(make_ctx, ART, "zotero-artigo.html", d, valores={"colecoes": {"revista.exemplo.org": "Testes"}})
    txt = salva(page)
    assert "Salvo no Zotero desktop" in txt
    assert ("fora do ar" if casa == "fora" else "respondeu 500") in sh(page, "return r.querySelector('li[data-d=casa]').innerText")
    ping = [r for r in d.reqs if r["url"].endswith("/connector/ping")][0]
    assert ping["method"] == "POST" and ping["headers"]["X-Zotero-Connector-API-Version"] == "3"
    b = d.corpo("/connector/saveItems")
    it = b["items"][0]
    assert it["itemType"] == "journalArticle" and it["DOI"] == "10.5555/exemplo.2024.042"
    assert (it["volume"], it["issue"], it["pages"], it["date"]) == ("12", "3", "45-67", "2024-05-10")
    assert it["creators"][1] == {"creatorType": "author", "firstName": "Bruno", "lastName": "Modelo Filho"}
    assert it["attachments"] == [{"url": "https://revista.exemplo.org/artigo/42.pdf", "title": "PDF", "mimeType": "application/pdf"}]
    assert it["tags"] == [], "artigo completo: sem a tag abnt-incompleto"
    assert d.corpo("/connector/updateSession")["target"] == "C7"
    ref = sh(page, "return r.querySelector('.ref').textContent")
    assert ref.startswith("EXEMPLO, Ana Maria; MODELO FILHO, Bruno. Um estudo de caso fictício: método e resultados. Revista Exemplo de Testes, v. 12, n. 3, p. 45-67, 2024.")
    assert "DOI: 10.5555/exemplo.2024.042" in ref and "Acesso em:" in ref
    assert "referência completa" in txt
    assert not any("api.zotero.org" in u for u in d.urls())


# ------------------------------------------------------------------ 3. Web API


def test_web_api_quando_casa_e_desktop_falham(make_ctx):
    d = Destinos(casa="fora", desktop="fechado")
    page = abre(make_ctx, LIVRO, "zotero-livro.html", d, valores={"zotero_key": CHAVE, "colecoes": {"livros.exemplo.org": "Testes"}})
    txt = salva(page)
    assert "Salvo pela Web API" in txt
    assert "fechado" in sh(page, "return r.querySelector('li[data-d=desktop]').innerText")
    post = [r for r in d.reqs if r["method"] == "POST" and r["url"] == "https://api.zotero.org/users/999/items"][0]
    assert post["headers"]["Zotero-API-Key"] == CHAVE and post["anonymous"] and re.fullmatch(r"[0-9a-f]{32}", post["headers"]["Zotero-Write-Token"])
    it = json.loads(post["data"])[0]
    assert it["itemType"] == "book" and it["ISBN"] == "9788533302273" and it["publisher"] == "Editora Fictícia"
    assert it["creators"] == [{"creatorType": "author", "lastName": "Teste", "firstName": "Carla"}]
    assert it["collections"] == ["WCOL1"] and it["tags"] == [{"tag": "abnt-incompleto"}]
    assert "local" in txt and "Manual fictício de referências" in sh(page, "return r.querySelector('.ref').textContent")
    assert gm(page, "zotero_user") == "999"
    assert sh(page, "return r.querySelector('.acoes a').href") == "https://www.zotero.org/usuario-teste/items/WEB00001"
    assert "formatada pelo Zotero" in txt


def test_web_api_duplicata_nao_cria(make_ctx):
    d = Destinos(casa="fora", desktop="fechado", duplicata=True)
    page = abre(make_ctx, ART, "zotero-artigo.html", d, valores={"zotero_key": CHAVE})
    txt = salva(page)
    assert "Já existia na biblioteca do zotero.org: nada foi criado." in txt
    assert not any(r["method"] == "POST" for r in d.reqs if "api.zotero.org" in r["url"])


def test_web_api_anexo_pdf_como_link(make_ctx):
    d = Destinos(casa="fora", desktop="fechado")
    page = abre(make_ctx, ART, "zotero-artigo.html", d, valores={"zotero_key": CHAVE})
    salva(page)
    posts = [json.loads(r["data"]) for r in d.reqs if r["method"] == "POST" and r["url"].endswith("/items")]
    assert len(posts) == 2
    assert posts[1] == [{"itemType": "attachment", "parentItem": "WEB00001", "linkMode": "linked_url", "title": "PDF",
                         "url": "https://revista.exemplo.org/artigo/42.pdf", "contentType": "application/pdf", "tags": []}]
    assert "DOI" in posts[0][0] and "tags" in posts[0][0] and posts[0][0]["tags"] == []


def test_nenhum_destino(make_ctx):
    d = Destinos(casa="erro", desktop="fechado")
    page = abre(make_ctx, ART, "zotero-artigo.html", d)
    txt = salva(page)
    assert "Não salvou em nenhum destino" in txt
    assert "sem chave" in sh(page, "return r.querySelector('li[data-d=web]').innerText")
    assert not any("api.zotero.org" in u for u in d.urls())


# ------------------------------------------------------------------ PDF e layout


def test_pdf_sem_metadados(make_ctx):
    d = Destinos(casa="fora", desktop="aberto")
    page = abre(make_ctx, PDF, "zotero-pdf.html", d, pdf=True)
    salva(page)
    it = d.corpo("/connector/saveItems")["items"][0]
    assert it["itemType"] == "document" and it["attachments"][0]["url"] == PDF


def test_gaveta_no_celular(make_ctx):
    page = abre(make_ctx, ART, "zotero-artigo.html", Destinos(casa="ok"), mobile=True)
    salva(page, "pilula")
    box = page.locator("zotero-salvar").locator(".painel").bounding_box()
    assert box["x"] == 0 and box["width"] == 412 and abs(box["y"] + box["height"] - 915) < 1
    for b in page.locator("zotero-salvar").locator(".x, .acoes button").all():
        assert b.bounding_box()["height"] >= 44
    page.keyboard.press("Escape")
    assert sh(page, "return r.querySelector('.painel').hidden") is True


# ------------------------------------------------------------------ robustez e página hostil


def test_shadow_fechado_sem_o_gancho_de_teste(make_ctx):
    page = abre(make_ctx, ART, "zotero-artigo.html", Destinos(), inspeciona=False)
    assert page.evaluate("() => !!document.querySelector('zotero-salvar')")
    assert page.evaluate("() => document.querySelector('zotero-salvar').shadowRoot") is None
    assert page.errors == []


def test_evento_sintetico_nao_salva(make_ctx):
    d = Destinos(casa="ok", desktop="aberto")
    page = abre(make_ctx, ART, "zotero-artigo.html", d)
    page.evaluate("() => document.dispatchEvent(new KeyboardEvent('keydown', {altKey: true, shiftKey: true, code: 'KeyZ', key: 'Z', bubbles: true}))")
    page.evaluate("() => document.querySelector('zotero-salvar').shadowRoot.querySelector('.pill').click()")
    page.wait_for_timeout(300)
    assert sh(page, "const p = r.querySelector('.painel'); return p ? p.hidden : true") is True, "clique sintético não abre a prévia"
    page.locator("zotero-salvar").locator(".pill").click()  # clique real abre
    page.evaluate("() => document.querySelector('zotero-salvar').shadowRoot.querySelector('.salvar').click()")
    page.wait_for_timeout(300)
    assert not any(u.endswith("/save") or "/health" in u or "127.0.0.1" in u for u in d.urls()), d.urls()
    assert sh(page, "return r.querySelector('.saida')") is None
    page.locator("zotero-salvar").locator(".salvar").click()
    page.wait_for_function("() => document.querySelector('zotero-salvar').shadowRoot.querySelector('.saida')?.textContent")
    sh(page, "r.querySelector('.cp').click()")
    page.wait_for_timeout(100)
    assert sh(page, "return r.querySelector('.cp').textContent") == "Copiar ABNT", "cópia só com clique real"


def test_escapes_invalidos_nao_quebram(make_ctx):
    url = "https://revista.exemplo.org/doi/10.5555/%zz"
    d = Destinos(casa="erro", desktop="fechado")
    page = abre(make_ctx, url, "zotero-percent.html", d)
    assert sh(page, "return r.querySelector('.pill').getAttribute('aria-label')").startswith("Salvar no Zotero")
    assert "Não salvou em nenhum destino" in salva(page)
    d.casa = "ok"
    sh(page, "r.querySelector('.saida').textContent = ''")
    assert "Salvo no Zotero de casa" in salva(page), "segundo atalho depois de uma falha"
    assert d.corpo("/save")["doi"] == "10.5555/%zz"
    assert page.errors == []


def test_erro_inesperado_nao_trava_o_atalho(make_ctx):
    d = Destinos(casa="ok")
    page = abre(make_ctx, ART, "zotero-artigo.html", d)
    page.evaluate("() => { window.__gs = window.getSelection; window.getSelection = () => { throw new Error('x'); }; }")
    assert "Erro inesperado" in salva(page)
    page.evaluate("() => { window.getSelection = window.__gs; }")
    sh(page, "r.querySelector('.saida').textContent = ''")
    assert "Salvo no Zotero de casa" in salva(page)
    assert page.errors == []


def test_casa_sem_resposta_a_tempo_nao_tenta_outro(make_ctx):
    d = Destinos(casa="tempo", desktop="aberto")
    page = abre(make_ctx, ART, "zotero-artigo.html", d, valores={"zotero_key": CHAVE})
    txt = salva(page)
    assert "O Zotero de casa não respondeu a tempo; confira a biblioteca antes de salvar de novo." in txt
    assert not any("127.0.0.1" in u or "api.zotero.org" in u for u in d.urls()), d.urls()
    assert "sem resposta a tempo" in sh(page, "return r.querySelector('li[data-d=casa]').innerText")


@pytest.mark.parametrize("fixture,esperado", [
    ("zotero-pdf-js.html", "https://revista.exemplo.org/pdf/42.pdf"),
    ("zotero-pdf-rel.html", "https://revista.exemplo.org/artigo/arquivos/42.pdf"),
    ("zotero-pdf-sem.html", None),
])
def test_pdf_so_http(make_ctx, fixture, esperado):
    d = Destinos(casa="ok")
    page = abre(make_ctx, "https://revista.exemplo.org/artigo/42", fixture, d)
    salva(page)
    assert d.corpo("/save").get("pdf_url") == esperado


@pytest.mark.parametrize("existente", [
    {"ISBN": "9788533302273 8533302275"},
    {"ISBN": "85-333-0227-4"},
    {"url": "https://www.livros.exemplo.org/manual/"},
])
def test_web_api_duplicata_por_isbn_e_url(make_ctx, existente):
    d = Destinos(casa="fora", desktop="fechado", existente=existente)
    page = abre(make_ctx, LIVRO, "zotero-livro.html", d, valores={"zotero_key": CHAVE})
    assert "Já existia na biblioteca do zotero.org: nada foi criado." in salva(page)
    assert not any(r["method"] == "POST" for r in d.reqs if "api.zotero.org" in r["url"])


def test_web_api_duplicata_por_doi_em_url(make_ctx):
    d = Destinos(casa="fora", desktop="fechado", existente={"itemType": "journalArticle", "DOI": "https://doi.org/10.5555/EXEMPLO.2024.042"})
    page = abre(make_ctx, ART, "zotero-artigo.html", d, valores={"zotero_key": CHAVE})
    assert "Já existia na biblioteca do zotero.org" in salva(page)
    assert not any(r["method"] == "POST" for r in d.reqs if "api.zotero.org" in r["url"])


def test_web_api_isbn_diferente_cria(make_ctx):
    d = Destinos(casa="fora", desktop="fechado", existente={"ISBN": "9780306406157"})
    page = abre(make_ctx, LIVRO, "zotero-livro.html", d, valores={"zotero_key": CHAVE})
    assert "Salvo pela Web API" in salva(page)


# ------------------------------------------------------------------ coleções


def test_cache_de_colecoes_separado_por_origem(make_ctx):
    # Chave do Zotero de casa em cache não vai para a Web API.
    d = Destinos(casa="fora", desktop="fechado")
    page = abre(make_ctx, LIVRO, "zotero-livro.html", d, valores={
        "zotero_key": CHAVE, "colecoes": {"livros.exemplo.org": "Testes"},
        "colecoes_cache_casa": [{"key": "COL1", "name": "Testes", "parent": ""}]})
    salva(page)
    post = [json.loads(r["data"]) for r in d.reqs if r["method"] == "POST" and r["url"].endswith("/items")][0]
    assert post[0]["collections"] == ["WCOL1"]
    # E a chave da Web API em cache não vai para o Zotero de casa.
    d2 = Destinos(casa="ok")
    page2 = abre(make_ctx, ART, "zotero-artigo.html", d2, valores={
        "colecoes": {"revista.exemplo.org": "Testes"}, "colecoes_cache_web": [{"key": "WCOL1", "name": "Testes", "parent": ""}]})
    salva(page2)
    assert d2.corpo("/save")["collection"] == "COL1"
    assert gm(page2, "colecoes_cache_casa")[0]["key"] == "COL1"


def test_casa_sem_lista_manda_o_nome(make_ctx):
    d = Destinos(casa="ok")
    orig = d.__call__

    def sem_lista(source, req):
        if req["url"].endswith("/collections") and "raschagas" in req["url"]:
            d.reqs.append(req)
            return {"status": 500, "text": "x"}
        return orig(source, req)
    page = abre(make_ctx, ART, "zotero-artigo.html", sem_lista, valores={"colecoes": {"revista.exemplo.org": "Nova"}})
    page.keyboard.press("Alt+Shift+KeyZ")
    page.wait_for_function("() => document.querySelector('zotero-salvar').shadowRoot.querySelector('.saida')?.textContent.trim()")
    txt = sh(page, "return r.querySelector('.saida').innerText")
    assert d.corpo("/save")["collection"] == "Nova"
    assert "coleção “Nova” não encontrada; item salvo na biblioteca" in txt


def test_casa_duplicata_nao_avisa_colecao(make_ctx):
    d = Destinos(casa="ok", casa_duplicata=True)
    page = abre(make_ctx, ART, "zotero-artigo.html", d, valores={"colecoes": {"revista.exemplo.org": "Sumiu"}})
    txt = salva(page)
    assert "não encontrada" not in txt
    assert "nada foi criado" in txt


def test_colecoes_web_paginadas_e_aviso(make_ctx):
    cols = [{"key": f"W{i:03d}", "data": {"name": f"Col {i:03d}", "parentCollection": False}} for i in range(150)]
    cols.append({"key": "WFIM", "data": {"name": "Última", "parentCollection": False}})
    d = Destinos(casa="fora", desktop="fechado", web_cols=cols)
    page = abre(make_ctx, LIVRO, "zotero-livro.html", d, valores={"zotero_key": CHAVE, "colecoes": {"livros.exemplo.org": "Última"}})
    salva(page)
    post = [json.loads(r["data"]) for r in d.reqs if r["method"] == "POST" and r["url"].endswith("/items")][0]
    assert post[0]["collections"] == ["WFIM"]
    assert any("start=100" in u for u in d.urls()) and not any("start=200" in u for u in d.urls())
    d2 = Destinos(casa="fora", desktop="fechado")
    page2 = abre(make_ctx, LIVRO, "zotero-livro.html", d2, valores={"zotero_key": CHAVE, "colecoes": {"livros.exemplo.org": "Sumiu"}})
    assert "coleção “Sumiu” não encontrada; item salvo na biblioteca" in salva(page2)


def test_desktop_colecao_inexistente_avisa(make_ctx):
    d = Destinos(casa="fora", desktop="aberto")
    page = abre(make_ctx, ART, "zotero-artigo.html", d, valores={"colecoes": {"revista.exemplo.org": "Sumiu"}})
    assert "coleção “Sumiu” não encontrada" in salva(page)
    assert d.corpo("/connector/updateSession") is None


# ------------------------------------------------------------------ mensagens


@pytest.mark.parametrize("web,msg", [("rede", "zotero.org sem resposta"), ("recusa", "chave recusada")])
def test_web_api_rede_ou_chave(make_ctx, web, msg):
    d = Destinos(casa="fora", desktop="fechado", web=web)
    page = abre(make_ctx, ART, "zotero-artigo.html", d, valores={"zotero_key": CHAVE})
    salva(page)
    assert msg in sh(page, "return r.querySelector('li[data-d=web]').innerText")


def test_web_api_filhos_falham(make_ctx):
    d = Destinos(casa="fora", desktop="fechado", filhos="erro")
    page = abre(make_ctx, ART, "zotero-artigo.html", d, valores={"zotero_key": CHAVE})
    txt = salva(page)
    assert "Salvo pela Web API" in txt and "item salvo; o anexo PDF não foi gravado" in txt


def test_web_api_abnt_vazia_montada_aqui(make_ctx):
    d = Destinos(casa="fora", desktop="fechado", bib="vazio")
    page = abre(make_ctx, LIVRO, "zotero-livro.html", d, valores={"zotero_key": CHAVE})
    txt = salva(page)
    assert "montada aqui" in txt and "formatada pelo Zotero" not in txt
    assert "Manual fictício de referências" in sh(page, "return r.querySelector('.ref').textContent")


def test_casa_duplicata_sem_link(make_ctx):
    d = Destinos(casa="ok")
    orig = d.__call__

    def dup(source, req):
        r = orig(source, req)
        if req["url"].endswith("/save"):
            j = json.loads(r["text"]); j["duplicata"] = True; j["abnt"] = ""; j["abnt_html"] = ""
            r = {"status": 200, "text": json.dumps(j)}
        return r
    page = abre(make_ctx, ART, "zotero-artigo.html", dup, valores={"zotero_username": "usuario-teste"})
    page.keyboard.press("Alt+Shift+KeyZ")
    page.wait_for_function("() => document.querySelector('zotero-salvar').shadowRoot.querySelector('.saida')?.textContent.trim()")
    txt = sh(page, "return r.querySelector('.saida').innerText")
    assert "Já existia no Zotero de casa: nada foi criado." in txt
    assert "montada aqui" in txt
    assert sh(page, "return r.querySelector('.acoes a')") is None, "link só para a Web API"


def test_desktop_sem_resposta_a_tempo_nao_tenta_web(make_ctx):
    d = Destinos(casa="fora", desktop="tempo")
    page = abre(make_ctx, ART, "zotero-artigo.html", d, valores={"zotero_key": CHAVE})
    txt = salva(page)
    assert "O Zotero desktop não respondeu a tempo; confira a biblioteca antes de salvar de novo." in txt
    assert "Não salvou" not in txt
    # Só a lista de coleções do painel toca o zotero.org; nada de busca ou criação.
    assert not any("api.zotero.org" in u and ("/items" in u or u.startswith("POST")) for u in d.urls()), d.urls()
    assert "sem resposta a tempo" in sh(page, "return r.querySelector('li[data-d=desktop]').innerText")


def test_web_api_criacao_sem_resposta_a_tempo(make_ctx):
    d = Destinos(casa="fora", desktop="fechado", criar="tempo")
    page = abre(make_ctx, ART, "zotero-artigo.html", d, valores={"zotero_key": CHAVE})
    txt = salva(page)
    assert "A Web API (zotero.org) não respondeu a tempo; confira a biblioteca antes de salvar de novo." in txt
    assert "Não salvou em nenhum destino" not in txt
    assert "sem resposta a tempo" in sh(page, "return r.querySelector('li[data-d=web]').innerText")
    assert len([r for r in d.reqs if r["method"] == "POST" and r["url"].endswith("/items")]) == 1, "sem anexo depois da dúvida"


def test_casa_save_sem_resposta_por_rede_e_incerto(make_ctx):
    d = Destinos(casa="rede_save", desktop="aberto")
    page = abre(make_ctx, ART, "zotero-artigo.html", d, valores={"zotero_key": CHAVE})
    txt = salva(page)
    assert "O Zotero de casa não respondeu a tempo; confira a biblioteca antes de salvar de novo." in txt
    assert any(u.endswith("/health") for u in d.urls()) and any(u.endswith("/save") for u in d.urls())
    assert not any("127.0.0.1" in u or "api.zotero.org" in u for u in d.urls()), d.urls()
    assert "sem resposta a tempo" in sh(page, "return r.querySelector('li[data-d=casa]').innerText")
    assert page.errors == []


def test_desktop_saveitems_sem_resposta_por_rede_e_incerto(make_ctx):
    d = Destinos(casa="fora", desktop="rede_save")
    page = abre(make_ctx, ART, "zotero-artigo.html", d, valores={"zotero_key": CHAVE})
    txt = salva(page)
    assert "O Zotero desktop não respondeu a tempo; confira a biblioteca antes de salvar de novo." in txt
    assert any(u.endswith("/connector/ping") for u in d.urls()) and any(u.endswith("/connector/saveItems") for u in d.urls())
    # Só a lista de coleções do painel toca o zotero.org; nada de busca ou criação.
    assert not any("api.zotero.org" in u and ("/items" in u or u.startswith("POST")) for u in d.urls()), d.urls()
    assert "sem resposta a tempo" in sh(page, "return r.querySelector('li[data-d=desktop]').innerText")


def test_web_api_criacao_sem_resposta_por_rede(make_ctx):
    d = Destinos(casa="fora", desktop="fechado", criar="rede")
    page = abre(make_ctx, ART, "zotero-artigo.html", d, valores={"zotero_key": CHAVE})
    txt = salva(page)
    assert "A Web API (zotero.org) não respondeu a tempo; confira a biblioteca antes de salvar de novo." in txt
    assert len([r for r in d.reqs if r["method"] == "POST" and r["url"].endswith("/items")]) == 1, "sem anexo depois da dúvida"


@pytest.mark.parametrize("fixture,sel,esperado", [
    ("zotero-artigo.html", False, "item salvo; o anexo PDF pode não ter sido gravado"),
    ("zotero-livro.html", True, "item salvo; a nota com a seleção pode não ter sido gravada"),
])
def test_web_api_filhos_sem_resposta(make_ctx, fixture, sel, esperado):
    d = Destinos(casa="fora", desktop="fechado", filhos="rede")
    url = ART if fixture == "zotero-artigo.html" else LIVRO
    page = abre(make_ctx, url, fixture, d, valores={"zotero_key": CHAVE})
    if sel:
        page.evaluate("() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('h1') || document.body); getSelection().removeAllRanges(); getSelection().addRange(r); }")
    txt = salva(page)
    assert "Salvo pela Web API" in txt and esperado in txt
    assert " não foi grava" not in txt


def test_reabrir_apos_erro_mostra_o_erro(make_ctx):
    d = Destinos(casa="ok")
    page = abre(make_ctx, ART, "zotero-artigo.html", d)
    page.evaluate("() => { window.__gs = window.getSelection; window.getSelection = () => { throw new Error('x'); }; }")
    assert "Erro inesperado" in salva(page)
    page.evaluate("() => { window.getSelection = window.__gs; }")
    page.keyboard.press("Escape")
    assert sh(page, "return r.querySelector('.painel').hidden") is True
    page.locator("zotero-salvar").locator(".pill").click()
    assert "Erro inesperado" in _espera_saida(page)
    assert sh(page, "return r.querySelector('.salvar')") is None, "o erro, não a prévia"
    assert page.errors == []


def _espera_saida(page):
    page.wait_for_function("() => document.querySelector('zotero-salvar').shadowRoot.querySelector('.saida')?.textContent.trim()", timeout=10000)
    return sh(page, "return r.querySelector('.saida').innerText")


def test_reabrir_durante_o_salvamento_mostra_progresso(make_ctx):
    d = Destinos(casa="lento")
    page = abre(make_ctx, ART, "zotero-artigo.html", d)
    page.keyboard.press("Alt+Shift+KeyZ")
    page.wait_for_function("() => document.querySelector('zotero-salvar').shadowRoot.querySelector('li[data-d=casa] .st.run')")
    page.keyboard.press("Escape")
    assert sh(page, "return r.querySelector('.painel').hidden") is True
    page.locator("zotero-salvar").locator(".pill").click()
    assert sh(page, "return !!r.querySelector('.passos') && !r.querySelector('.salvar')") is True, "progresso, não a prévia"
    assert "tentando" in sh(page, "return r.querySelector('li[data-d=casa]').innerText")
    txt = _espera_saida(page)
    assert "Salvo no Zotero de casa" in txt and "Erro inesperado" not in txt and "nada foi salvo" not in txt
    assert "salvo" in sh(page, "return r.querySelector('li[data-d=casa]').innerText")
    assert len([u for u in d.urls() if u.endswith("/save")]) == 1
    assert page.errors == []


def test_fechado_ate_o_fim_reabre_com_o_resultado(make_ctx):
    d = Destinos(casa="lento")
    page = abre(make_ctx, ART, "zotero-artigo.html", d)
    page.keyboard.press("Alt+Shift+KeyZ")
    page.keyboard.press("Escape")
    page.wait_for_function("() => document.querySelector('zotero-salvar').shadowRoot.querySelector('.saida')?.textContent.trim()", timeout=10000)
    assert sh(page, "return r.querySelector('.painel').hidden") is True, "o fim não reabre o painel sozinho"
    page.locator("zotero-salvar").locator(".pill").click()
    txt = _espera_saida(page)
    assert "Salvo no Zotero de casa" in txt and sh(page, "return r.querySelector('.salvar')") is None
    assert page.errors == []


def test_colecoes_web_pagina_falha_nao_vira_cache(make_ctx):
    cols = [{"key": f"W{i:03d}", "data": {"name": f"Col {i:03d}", "parentCollection": False}} for i in range(150)]
    d = Destinos(casa="fora", desktop="fechado", web_cols=cols, cols_falha_start=100)
    page = abre(make_ctx, LIVRO, "zotero-livro.html", d, valores={"zotero_key": CHAVE, "colecoes": {"livros.exemplo.org": "Col 001"}})
    txt = salva(page)
    page.wait_for_timeout(200)
    assert gm(page, "colecoes_cache_web") is None, "lista incompleta não vira cache"
    assert "coleção “Col 001” não encontrada" in txt
    post = [json.loads(r["data"]) for r in d.reqs if r["method"] == "POST" and r["url"].endswith("/items")][0]
    assert post[0]["collections"] == []


def test_web_api_duplicata_por_cada_identificador(make_ctx):
    d = Destinos(casa="fora", desktop="fechado", existente={"ISBN": "9788533302273"}, existente_q="9788533302273")
    page = abre(make_ctx, "https://livros.exemplo.org/doi-isbn", "zotero-doi-isbn.html", d, valores={"zotero_key": CHAVE})
    assert "Já existia na biblioteca do zotero.org: nada foi criado." in salva(page)
    qs = [parse_qs(urlparse(r["url"]).query)["q"][0] for r in d.reqs if "/items/top" in r["url"]]
    assert qs == ["10.5555/livro.2021.7", "9788533302273"], "DOI primeiro, depois ISBN; para no que casou"
    assert not any(r["method"] == "POST" for r in d.reqs if "api.zotero.org" in r["url"])


def test_web_api_busca_falha_cria_com_aviso(make_ctx):
    d = Destinos(casa="fora", desktop="fechado", busca="erro")
    page = abre(make_ctx, LIVRO, "zotero-livro.html", d, valores={"zotero_key": CHAVE})
    txt = salva(page)
    assert "Salvo pela Web API" in txt and "não deu para conferir duplicata" in txt
    assert len([r for r in d.reqs if "/items/top" in r["url"]]) == 2, "ISBN e URL"


def test_web_api_busca_sem_duplicata_nao_avisa(make_ctx):
    d = Destinos(casa="fora", desktop="fechado")
    page = abre(make_ctx, LIVRO, "zotero-livro.html", d, valores={"zotero_key": CHAVE})
    assert "não deu para conferir" not in salva(page)


def test_sanitiza_remove_style_com_conteudo(make_ctx):
    d = Destinos(casa="ok")
    orig = d.__call__

    def com_style(source, req):
        r = orig(source, req)
        if req["url"].endswith("/save"):
            j = json.loads(r["text"])
            j["abnt_html"] = '<style>.csl-entry{color:red}</style><div class="csl-entry">TESTE, Ana. <b>Obra</b>. 2024.</div>'
            r = {"status": 200, "text": json.dumps(j)}
        return r
    page = abre(make_ctx, ART, "zotero-artigo.html", com_style)
    _ = salva(page)
    html = sh(page, "return r.querySelector('.ref').innerHTML")
    assert "<style" not in html and "color:red" not in html and "csl-entry" not in html
    assert sh(page, "return r.querySelector('.ref').textContent") == "TESTE, Ana. Obra. 2024."


# ------------------------------------------------------------------ ABNT local


def test_tese_e_particula(make_ctx):
    d = Destinos(casa="fora", desktop="aberto")
    page = abre(make_ctx, "https://teses.exemplo.org/t/1", "zotero-tese.html", d)
    salva(page)
    it = d.corpo("/connector/saveItems")["items"][0]
    assert it["itemType"] == "thesis"
    assert it["creators"] == [{"creatorType": "author", "firstName": "João da", "lastName": "Silva"}]
    assert it["tags"] == [{"tag": "abnt-incompleto"}], "falta o local"
    ref = sh(page, "return r.querySelector('.ref').textContent")
    # NBR 6023 (7.9): ano de depósito e, depois da vinculação acadêmica, a data da defesa; nunca o mesmo ano em sequência.
    assert ref.startswith("SILVA, João da. Uma tese fictícia: estudo de exemplo. 2019. Universidade Fictícia, 2019."), ref
    assert "2019. 2019" not in ref and "2019, 2019" not in ref


def test_json_ld_em_lista_ou_objeto(make_ctx):
    d = Destinos(casa="fora", desktop="aberto")
    page = abre(make_ctx, "https://livros.exemplo.org/lista", "zotero-ld.html", d)
    txt = salva(page)
    it = d.corpo("/connector/saveItems")["items"][0]
    assert it["title"] == "Título em lista" and it["publisher"] == "Editora Lista"
    assert it["creators"] == [{"creatorType": "author", "lastName": "Teste", "firstName": "Carla"}]
    assert "object" not in txt and "Título em lista,Outro" not in txt


def test_cabecalho_mundo_isolado():
    code = (SRC / S).read_text(encoding="utf-8")
    assert re.search(r"^// @inject-into\s+content$", code, re.M) and re.search(r"^// @sandbox\s+DOM$", code, re.M)
    assert "mode: 'closed'" in code and code.count("isTrusted") >= 4


def test_codigo_sem_vigia_e_sem_segredo():
    code = (SRC / S).read_text(encoding="utf-8")
    assert not re.search(r"\b(MutationObserver|setInterval|requestIdleCallback)\b", code)
    hosts = set(re.findall(r"https?://([a-z0-9.\-]+(?::\d+)?)", code))
    assert hosts == {"zotero.raschagas.lan", "127.0.0.1:23119", "api.zotero.org", "www.zotero.org", "raw.githubusercontent.com"}, hosts
    assert not re.search(r"users/\d", code) and not re.search(r"['\"][A-Za-z0-9]{24}['\"]", code)
    for f in FIX.glob("zotero-*.html"):
        assert "raschagas" not in f.read_text(encoding="utf-8")
