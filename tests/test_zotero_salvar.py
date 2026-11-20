"""zotero-salvar: captura local, pílula, painel e a ordem casa → desktop → Web API com destinos simulados."""
import json
import re

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

# GM_xmlhttpRequest ligado ao Python: cada teste decide o que cada destino responde.
GMX = """(() => {
  window.GM_xmlhttpRequest = (d) => { window.__gmx({method: d.method || 'GET', url: d.url, headers: d.headers || {}, data: d.data || null,
    anonymous: !!d.anonymous}).then((r) => {
      if (r.erro === 'tempo') d.ontimeout && d.ontimeout({});
      else if (r.erro) d.onerror && d.onerror({});
      else d.onload && d.onload({status: r.status, responseText: r.text}); }); };
})();"""


class Destinos:
    """Simula o Zotero de casa, o Zotero desktop e a Web API; registra cada requisição."""

    def __init__(self, casa="ok", desktop="fechado", web="ok", duplicata=False):
        self.casa, self.desktop, self.web, self.duplicata = casa, desktop, web, duplicata
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
                return {"status": 200, "text": json.dumps({"key": "CASA0001", "abnt": ABNT_CASA, "faltando": [{"campo": "issue", "rotulo": "número"}],
                                                           "fontes": [], "duplicata": False,
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
                return {"status": 201, "text": ""}
            if u.endswith("/updateSession"):
                return {"status": 200, "text": "{}"}
        if u.startswith("https://api.zotero.org/"):
            if self.web == "recusa":
                return {"status": 403, "text": "Forbidden"}
            if "/keys/current" in u:
                return {"status": 200, "text": '{"userID": 999, "username": "usuario-teste"}'}
            if "/collections" in u:
                return {"status": 200, "text": json.dumps([{"key": "WCOL1", "data": {"name": "Testes", "parentCollection": False}}])}
            if "/items/top" in u:
                hit = [{"key": "DUP00001", "data": {"itemType": "journalArticle", "title": "x", "DOI": "10.5555/exemplo.2024.042",
                                                    "creators": [{"lastName": "A"}], "publicationTitle": "R", "volume": "1",
                                                    "issue": "1", "pages": "1", "date": "2024"}}]
                return {"status": 200, "text": json.dumps(hit if self.duplicata else [])}
            if "format=bib" in u:
                return {"status": 200, "text": '<div class="csl-entry">TESTE, Carla. <b>Manual fictício de referências</b>. [<i>S. l.</i>]: Editora Fictícia, 2021.</div>'}
            if d["method"] == "POST" and u.endswith("/items"):
                return {"status": 200, "text": '{"successful": {"0": {"key": "WEB00001"}}, "failed": {}}'}
        return {"erro": "rede"}


def abre(make_ctx, url, fixture, dest, mobile=False, valores=None, pdf=False):
    ctx = make_ctx(mobile=mobile)
    ctx.add_init_script(GMX)
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
    sh(page, "const s = r.querySelector('select'); s.value = 'Sub'; s.dispatchEvent(new Event('change'));")
    assert gm(page, "colecoes") == {"revista.exemplo.org": "Sub"}


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


def test_web_api_duplicata_nao_cria(make_ctx):
    d = Destinos(casa="fora", desktop="fechado", duplicata=True)
    page = abre(make_ctx, ART, "zotero-artigo.html", d, valores={"zotero_key": CHAVE})
    txt = salva(page)
    assert "Já estava na biblioteca" in txt and "nada foi criado" in txt
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


def test_codigo_sem_vigia_e_sem_segredo():
    code = (SRC / S).read_text(encoding="utf-8")
    assert not re.search(r"\b(MutationObserver|setInterval|requestIdleCallback)\b", code)
    hosts = set(re.findall(r"https?://([a-z0-9.\-]+(?::\d+)?)", code))
    assert hosts == {"zotero.raschagas.lan", "127.0.0.1:23119", "api.zotero.org", "www.zotero.org", "raw.githubusercontent.com"}, hosts
    assert not re.search(r"users/\d", code) and not re.search(r"['\"][A-Za-z0-9]{24}['\"]", code)
    for f in FIX.glob("zotero-*.html"):
        assert "raschagas" not in f.read_text(encoding="utf-8")
