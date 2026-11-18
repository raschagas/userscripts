"""instagram-ux: barra de progresso nativa, atalhos, volume lembrado, limpeza e Seguindo."""
import json

import pytest

from conftest import FIX, inject

S = "instagram-ux.user.js"
FEED = "https://www.instagram.com/"
STORY = "https://www.instagram.com/stories/conta_exemplo/1234567890/"
VIDEO = (FIX / "instagram-video.webm").read_bytes()
# page.evaluate do Playwright conta como gesto do usuário (navigator.userActivation sempre ativo).
# Os testes controlam o "gesto" por window.__gesto.
FAKE_GESTURE = """Object.defineProperty(Navigator.prototype, 'userActivation', { configurable: true,
  get: () => ({ get hasBeenActive() { return !!window.__gesto; }, get isActive() { return !!window.__gesto; } }) });"""
# Menu vivo como o do gerenciador: `window.__menu` é o que o usuário vê agora. Modo "vm" (Violentmonkey):
# o item é identificado pelo texto e o id devolvido é o texto; "tm" (Tampermonkey): pelo `id` das opções.
# Re-registrar sem tirar o anterior deixa o item duplicado, e o teste vê.
MENU_SHIM = """(mode => {
  window.__menu = []; let n = 0;
  window.GM_registerMenuCommand = (t, f, o) => {
    const id = mode === 'tm' ? ((o && o.id) || 'm' + (++n)) : t;
    const i = window.__menu.findIndex(m => m.id === id);
    if (i >= 0) window.__menu[i] = { id, t, f }; else window.__menu.push({ id, t, f });
    return id;
  };
  window.GM_unregisterMenuCommand = id => { window.__menu = window.__menu.filter(m => m.id !== id); };
})(%s);"""


def fulfill_video(route):
    """Responde com suporte a Range (206): sem isso o vídeo não é "seekable" e currentTime não muda."""
    rng = route.request.headers.get("range", "")
    n = len(VIDEO)
    start, end = 0, n - 1
    if rng.startswith("bytes="):
        a, _, b = rng[6:].partition("-")
        start = int(a or 0)
        end = min(int(b), n - 1) if b else n - 1
    route.fulfill(status=206, body=VIDEO[start:end + 1], headers={
        "Content-Type": "video/webm", "Accept-Ranges": "bytes",
        "Content-Range": f"bytes {start}-{end}/{n}", "Content-Length": str(end - start + 1)})


def route_ig(ctx, fixture, host="https://www.instagram.com"):
    html = (FIX / fixture).read_bytes()

    def handle(route):
        if route.request.url.endswith(".webm"):
            fulfill_video(route)
        else:
            route.fulfill(status=200, body=html, content_type="text/html; charset=utf-8")
    ctx.route(host + "/**", handle)


def open_ig(make_ctx, fixture="instagram-feed.html", url=FEED, prefs=None, som=None, mobile=False, inject_now=True,
            menu="vm"):
    ctx = make_ctx(mobile=mobile)
    ctx.add_init_script(FAKE_GESTURE)
    ctx.add_init_script(MENU_SHIM % json.dumps(menu))
    route_ig(ctx, fixture)
    if prefs is not None:
        ctx.add_init_script(f"localStorage.setItem('__gm:ajustes', {json.dumps(json.dumps(prefs))})")
    if som is not None:
        ctx.add_init_script(f"localStorage.setItem('__gm:som', {json.dumps(json.dumps(som))})")
    page = ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.goto(url, wait_until="load")
    page.wait_for_function("[...document.querySelectorAll('video')].every(v => v.readyState >= 1 && isFinite(v.duration))")
    if inject_now:
        inject(page, S)
        settle(page)
    return page


def settle(page, ms=350):
    page.wait_for_timeout(ms)


def show(page, sel):
    page.evaluate(f"document.querySelector('{sel}').scrollIntoView({{block: 'center'}})")
    settle(page)


def rect(page, sel):
    return page.evaluate(f"(() => {{ const r = document.querySelector('{sel}').getBoundingClientRect(); "
                         "return {x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right}; })()")


def hit(page, x, y):
    return page.evaluate(f"(() => {{ const e = document.elementFromPoint({x}, {y}); return e && (e.id || e.dataset.tap || e.className || e.tagName); }})()")


VIS = "s => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }"


def vis(page, sels):
    return {s: page.evaluate(VIS, s) for s in sels}


# ---------- Barra de progresso (controles nativos) ----------

def test_liga_controles_e_libera_so_a_faixa_inferior(make_ctx):
    page = open_ig(make_ctx)
    assert page.evaluate("document.documentElement.hasAttribute('data-us-ig-barra')")
    on_screen = "[...document.querySelectorAll('video')].map(v => { const r = v.getBoundingClientRect(); return [v.id, r.bottom > 0 && r.top < innerHeight, v.controls]; })"
    st = page.evaluate(on_screen)
    assert any(c for _, _, c in st) and all(c == vis_ for _, vis_, c in st), f"controls só nos vídeos na tela: {st}"
    for vid, tap in (("#v1", "p1"), ("#v4", "p4")):  # camada irmã e camada dentro de um invólucro estático
        show(page, vid)
        r = rect(page, vid)
        b = min(r["b"], page.viewport_size["height"])
        assert hit(page, r["x"] + r["w"] / 2, b - 10) == vid[1:], "faixa inferior chega ao vídeo (barra nativa)"
        assert hit(page, r["x"] + 20, b - 30) == vid[1:]
        assert hit(page, r["x"] + r["w"] / 2, r["y"] + r["h"] / 2) == tap, "o meio continua com o Instagram"
        assert hit(page, r["x"] + r["w"] / 2, r["y"] + 10) == tap, "o topo continua com o Instagram"
        assert hit(page, r["x"] + r["w"] / 2, b - 60) == tap, "só ~48 px são liberados"
    show(page, "#v1")
    m = rect(page, "#p1 .mute")
    assert hit(page, m["x"] + m["w"] / 2, m["y"] + m["h"] / 2) == "mute1", "botão de som do Instagram na faixa continua"
    page.mouse.click(rect(page, "#v1")["x"] + 100, rect(page, "#v1")["y"] + 100)
    assert page.evaluate("igTaps") == ["p1"], "toque no meio segue para o Instagram"
    assert page.errors == []


def test_controles_so_na_tela_e_restaurados_ao_sair(make_ctx):
    page = open_ig(make_ctx, inject_now=False)
    page.evaluate("document.getElementById('v4').setAttribute('controlslist', 'nodownload')")
    inject(page, S)
    settle(page)
    got = "id => { const v = document.getElementById(id); return [v.controls, v.disablePictureInPicture, v.controlsList.value]; }"
    assert page.evaluate(got, "v1") == [True, True, "nodownload noremoteplayback noplaybackrate"]
    assert page.evaluate(got, "v4") == [False, False, "nodownload"], "fora da tela: original"
    show(page, "#v4")
    settle(page)
    assert page.evaluate(got, "v4") == [True, True, "nodownload noremoteplayback noplaybackrate"]
    assert page.evaluate(got, "v1") == [False, False, ""], "saiu da tela: volta ao original"
    show(page, "#v1")
    settle(page)
    assert page.evaluate(got, "v1")[0] is True
    assert page.evaluate(got, "v4") == [False, False, "nodownload"]


def test_story_topo_e_toques_com_o_instagram(make_ctx):
    page = open_ig(make_ctx, "instagram-story.html", STORY)
    r = rect(page, "#sv")
    assert hit(page, r["x"] + r["w"] / 2, r["b"] - 10) == "sv"
    assert hit(page, r["x"] + 10, r["y"] + r["h"] / 2) == "prev"
    assert hit(page, r["x"] + r["w"] - 10, r["y"] + r["h"] / 2) == "next"
    b = rect(page, "#bars")
    assert hit(page, b["x"] + b["w"] / 2, b["y"] + 1) != "sv", "barra do topo continua do Instagram"
    assert page.evaluate("document.getElementById('resposta').getClientRects().length") == 1


def test_nenhum_elemento_novo(make_ctx):
    page = open_ig(make_ctx, inject_now=False)
    page.evaluate("""window.__added = []; new MutationObserver(rs => { for (const r of rs) for (const n of r.addedNodes)
        if (n.nodeType === 1 && !['STYLE', 'SCRIPT'].includes(n.tagName)) window.__added.push(n.tagName + '#' + n.id); })
        .observe(document.documentElement, {childList: true, subtree: true});""")
    inject(page, S)
    show(page, "#v1")
    r = rect(page, "#v1")
    page.mouse.move(r["x"] + r["w"] / 2, r["b"] - 10)
    page.mouse.wheel(0, 400)
    settle(page)
    page.keyboard.press("ArrowRight")
    settle(page)
    assert page.evaluate("window.__added") == []
    assert page.evaluate("document.querySelectorAll('style#us-instagram-ux').length") == 1


def test_mutacoes_nao_entram_em_laco(make_ctx):
    """O script só muda atributos: a varredura não pode se realimentar."""
    page = open_ig(make_ctx)
    page.evaluate("window.__n = 0; new MutationObserver(rs => window.__n += rs.length).observe(document.documentElement, {subtree: true, attributes: true, childList: true})")
    settle(page, 800)
    assert page.evaluate("window.__n") < 20


def menu_ok(page):
    t = page.evaluate("window.__menu.map(m => m.t)")
    assert len(t) == 7 and len({x[2:] for x in t}) == 7, f"sem duplicatas no menu: {t}"


@pytest.mark.parametrize("gerenciador", ["vm", "tm"])
def test_barra_desligada_e_religada_pelo_menu_ao_vivo(make_ctx, gerenciador):
    page = open_ig(make_ctx, menu=gerenciador)
    labels = page.evaluate("window.__menu.map(m => m.t)")
    assert labels == ["✓ Barra de progresso nos vídeos", "✓ Atalhos: ←/→ 5 s · , . velocidade · M mudo",
                      "✓ Lembrar volume e mudo", '✓ Ocultar "Sugestões para você"', "✓ Ocultar patrocinados",
                      '✓ Ocultar banner "abrir no app"', "✗ Abrir direto em Seguindo"]
    page.evaluate("window.__menu[0].f()")  # desliga a barra
    settle(page)
    assert page.evaluate("document.getElementById('v1').controls") is False
    assert page.evaluate("document.querySelectorAll('[data-us-ig-cobre]').length") == 0
    assert page.evaluate("document.documentElement.hasAttribute('data-us-ig-barra')") is False
    assert page.evaluate("window.__menu[0].t") == "✗ Barra de progresso nos vídeos"
    menu_ok(page)
    page.reload(wait_until="load")
    inject(page, S)
    settle(page)
    assert page.evaluate("document.getElementById('v1').controls") is False, "desligado fica salvo"
    page.evaluate("window.__menu[0].f()")  # religa
    settle(page)
    assert page.evaluate("document.getElementById('v1').controls") is True
    for _ in range(3):
        page.evaluate("window.__menu[1].f()")
    menu_ok(page)
    assert page.evaluate("window.__menu[1].t").startswith("✗ Atalhos")


def test_desligar_barra_restaura_pip_e_controlslist(make_ctx):
    page = open_ig(make_ctx, inject_now=False)
    page.evaluate("document.getElementById('v2').setAttribute('controlslist', 'nodownload')")
    inject(page, S)
    settle(page)
    got = "id => { const v = document.getElementById(id); return [v.disablePictureInPicture, v.controlsList.value]; }"
    assert page.evaluate(got, "v1") == [True, "nodownload noremoteplayback noplaybackrate"]
    page.evaluate("window.__menu[0].f()")
    settle(page)
    assert page.evaluate(got, "v1") == [False, ""]
    assert page.evaluate(got, "v2") == [False, "nodownload"], "o que já era da página fica"
    page.evaluate("window.__menu[0].f()")
    settle(page)
    assert page.evaluate(got, "v1") == [True, "nodownload noremoteplayback noplaybackrate"]


def test_story_movel_campo_de_resposta_na_faixa_continua_tocavel(make_ctx):
    page = open_ig(make_ctx, "instagram-story.html", STORY, mobile=True, inject_now=False)
    page.evaluate("""const r = document.querySelector('.reply'); r.style.cssText = 'position:absolute;left:12px;right:12px;bottom:12px;margin:0';
        document.querySelector('.ov').append(r);""")
    inject(page, S)
    settle(page)
    assert page.evaluate("document.getElementById('sv').controls") is True
    i = rect(page, "#resposta")
    assert hit(page, i["x"] + i["w"] / 2, i["y"] + i["h"] / 2) == "resposta"
    assert page.evaluate("document.querySelectorAll('[data-us-ig-cobre]').length") == 0, "sem lado livre: nenhum furo"
    page.tap("#resposta")
    assert page.evaluate("document.activeElement.id") == "resposta"


def test_reel_link_de_musica_na_faixa_continua_visivel(make_ctx):
    page = open_ig(make_ctx, inject_now=False)
    page.evaluate("""const a = document.createElement('a'); a.href = '#musica'; a.id = 'musica'; a.textContent = '♪ conta_video · Áudio original';
        a.style.cssText = 'position:absolute;left:12px;bottom:14px;color:#fff;background:#0008;padding:4px';
        document.querySelector('#p4 .tap').append(a);""")
    inject(page, S)
    show(page, "#v4")
    lk, r = rect(page, "#musica"), rect(page, "#v4")
    assert hit(page, lk["x"] + lk["w"] / 2, lk["y"] + lk["h"] / 2) == "musica", "link continua visível e clicável"
    assert hit(page, lk["x"] + 4, lk["y"] + 4) == "musica"
    assert hit(page, r["x"] + r["w"] * 0.75, r["b"] - 10) == "v4", "a faixa encolhe para o lado livre"
    assert hit(page, r["x"] + r["w"] / 2, r["y"] + r["h"] / 2) == "p4"


def test_video_reciclado_para_outro_post_desfaz_recorte(make_ctx):
    page = open_ig(make_ctx)
    show(page, "#v1")
    assert page.evaluate("document.querySelector('#p1 .tap').hasAttribute('data-us-ig-cobre')")
    page.evaluate("""const v = document.getElementById('v1'), f = document.querySelector('#p3 .foto');
        f.style.position = 'relative'; f.append(v);""")
    settle(page)
    assert page.evaluate("document.querySelector('#p1 .tap').hasAttribute('data-us-ig-cobre')") is False
    r = rect(page, "#p1 .tap")
    assert hit(page, r["x"] + r["w"] / 2, r["b"] - 10) == "p1"


def test_video_cortado_pela_borda_inferior_sem_furo(make_ctx):
    page = open_ig(make_ctx)
    show(page, "#v4")
    assert page.evaluate("document.querySelector('#p4 .tap').hasAttribute('data-us-ig-cobre')")
    page.evaluate("const r = document.getElementById('v4').getBoundingClientRect(); window.scrollBy(0, r.top - (innerHeight - r.height / 2))")
    settle(page, 700)
    r, h = rect(page, "#v4"), page.viewport_size["height"]
    assert r["b"] > h > r["y"]
    assert page.evaluate("document.querySelector('#p4 .tap').hasAttribute('data-us-ig-cobre')") is False
    assert hit(page, r["x"] + r["w"] / 2, h - 10) == "p4", "nenhum furo no meio do vídeo"


def test_varredura_com_debounce_e_teto(make_ctx):
    """Mutações contínuas adiam a varredura, mas não mais que ~500 ms."""
    page = open_ig(make_ctx)
    page.evaluate("""window.__t0 = performance.now(); window.__seen = 0;
        const a = document.createElement('article'); a.id = 'p6'; a.innerHTML = '<header><span>Patrocinado</span></header>';
        document.getElementById('feed').append(a);
        const tick = setInterval(() => { document.getElementById('feed').append(document.createComment('x'));
          if (!window.__seen && a.hasAttribute('data-us-ig-oculto')) window.__seen = performance.now() - window.__t0;
          if (performance.now() - window.__t0 > 1500) clearInterval(tick); }, 30);""")
    settle(page, 1600)
    seen = page.evaluate("window.__seen")
    assert 0 < seen < 750, seen


# ---------- Atalhos ----------

def test_atalhos(make_ctx):
    page = open_ig(make_ctx)
    page.evaluate("document.getElementById('v1').pause(); document.getElementById('v1').currentTime = 6")
    page.keyboard.press("ArrowRight")
    assert abs(page.evaluate("document.getElementById('v1').currentTime") - 11) < 0.3
    page.keyboard.press("ArrowRight")
    assert page.evaluate("document.getElementById('v1').currentTime") <= 12
    page.keyboard.press("ArrowLeft")
    page.keyboard.press("ArrowLeft")
    page.keyboard.press("ArrowLeft")
    assert page.evaluate("document.getElementById('v1').currentTime") < 1
    page.keyboard.press(".")
    assert page.evaluate("document.getElementById('v1').playbackRate") == 1.25
    for _ in range(12):
        page.keyboard.press(".")
    assert page.evaluate("document.getElementById('v1').playbackRate") == 3
    for _ in range(20):
        page.keyboard.press(",")
    assert page.evaluate("document.getElementById('v1').playbackRate") == 0.25
    assert page.evaluate("document.getElementById('v1').muted") is True
    page.keyboard.press("m")
    assert page.evaluate("document.getElementById('v1').muted") is False
    page.keyboard.press("M")
    assert page.evaluate("document.getElementById('v1').muted") is True
    assert page.evaluate("document.getElementById('v2').playbackRate") == 1, "só o vídeo ativo"
    assert page.evaluate("window.igKeys || []") == [], "atalho tratado não chega ao Instagram"


@pytest.mark.parametrize("campo", ["#busca", "#nota"])
def test_atalhos_ignoram_campos_editaveis(make_ctx, campo):
    page = open_ig(make_ctx)
    page.evaluate("document.getElementById('v1').currentTime = 6")
    page.click(campo)
    page.keyboard.press("ArrowRight")
    page.keyboard.press("m")
    page.keyboard.press(".")
    assert page.evaluate("document.getElementById('v1').playbackRate") == 1
    assert page.evaluate("document.getElementById('v1').muted") is True
    assert abs(page.evaluate("document.getElementById('v1').currentTime") - 6) < 1.5


def test_atalhos_no_story_usam_o_video_do_dialogo(make_ctx):
    page = open_ig(make_ctx, "instagram-story.html", STORY)
    page.evaluate("document.getElementById('sv').pause(); document.getElementById('sv').currentTime = 2")
    page.keyboard.press("ArrowRight")
    assert abs(page.evaluate("document.getElementById('sv').currentTime") - 7) < 0.3


def test_atalhos_com_post_de_foto_aberto_nao_mexem_no_feed(make_ctx):
    page = open_ig(make_ctx)
    page.evaluate("""const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.id = 'post';
        d.style.cssText = 'position:fixed;inset:40px;background:#000c;z-index:9';
        d.innerHTML = '<article><header><b>conta</b><span>Patrocinado</span></header><div class=foto></div></article>';
        document.body.append(d); document.getElementById('v1').pause(); document.getElementById('v1').currentTime = 6;""")
    settle(page)
    for k in ("ArrowRight", ".", "m"):
        page.keyboard.press(k)
    v = page.evaluate("(() => { const v = document.getElementById('v1'); return [v.currentTime, v.playbackRate, v.muted]; })()")
    assert abs(v[0] - 6) < 0.3 and v[1:] == [1, True], "o vídeo do feed escondido não é tocado"
    assert page.evaluate("window.igKeys") == ["ArrowRight", ".", "m"], "tecla não é engolida"
    assert vis(page, ["#post article"]) == {"#post article": True}, "nada dentro de diálogo é ocultado"


def test_atalhos_desligados_pelo_menu(make_ctx):
    page = open_ig(make_ctx, prefs={"atalhos": False})
    page.keyboard.press("m")
    assert page.evaluate("document.getElementById('v1').muted") is True
    assert page.evaluate("window.igKeys") == ["m"]


# ---------- Volume ----------

def gesto_no_video(page, vid):
    """Gesto real (isTrusted) com o próprio <video> como alvo, como nos controles nativos: foco + tecla neutra."""
    page.evaluate(f"window.__gesto = true; const v = document.getElementById('{vid}'); v.tabIndex = -1; v.focus()")
    page.keyboard.press("Shift")


def count_som_sets(page):
    page.evaluate("""window.__sets = 0; const o = window.GM_setValue;
        window.GM_setValue = (k, v) => { if (k === 'som') window.__sets++; o(k, v); };""")


def test_volume_lembrado_entre_videos(make_ctx):
    page = open_ig(make_ctx)
    gesto_no_video(page, "v1")
    page.evaluate("const v = document.getElementById('v1'); v.volume = 0.3; v.muted = false")
    settle(page, 200)
    assert page.evaluate("JSON.parse(localStorage.getItem('__gm:som'))") == {"volume": 0.3, "mudo": False}
    page.evaluate("""const f = document.createElement('article'); f.id = 'p9';
        f.innerHTML = '<div class=m><video id=v9 src=instagram-video.webm muted autoplay loop playsinline></video></div>';
        document.getElementById('feed').append(f);""")
    settle(page)
    assert page.evaluate("[document.getElementById('v9').volume, document.getElementById('v9').muted]") == [0.3, False]
    assert page.evaluate("JSON.parse(localStorage.getItem('__gm:som'))") == {"volume": 0.3, "mudo": False}, \
        "a mudança feita pelo script não é gravada como do usuário"
    gesto_no_video(page, "v9")
    # o usuário muda de novo no vídeo novo: o script não briga
    page.evaluate("document.getElementById('v9').volume = 0.8")
    settle(page)
    assert page.evaluate("document.getElementById('v9').volume") == 0.8
    assert page.evaluate("JSON.parse(localStorage.getItem('__gm:som')).volume") == 0.8


def test_volume_aplicado_ao_abrir_mas_sem_tirar_mudo_sem_gesto(make_ctx):
    page = open_ig(make_ctx, som={"volume": 0.5, "mudo": False})
    assert page.evaluate("document.getElementById('v1').volume") == 0.5
    assert page.evaluate("document.getElementById('v1').muted") is True, "sem gesto, tirar o mudo pausaria o autoplay"
    assert page.evaluate("document.getElementById('v1').paused") is False


def test_volume_invalido_salvo_nao_zera(make_ctx):
    page = open_ig(make_ctx, som={"volume": None, "mudo": True})
    assert page.evaluate("document.getElementById('v1').volume") == 1


def test_volume_igual_nao_regrava(make_ctx):
    page = open_ig(make_ctx, som={"volume": 0.4, "mudo": True})
    count_som_sets(page)
    for js in ("v.muted = false", "v.muted = true", "v.volume = 0.5; v.volume = 0.4"):
        gesto_no_video(page, "v1")
        page.evaluate("const v = document.getElementById('v1'); " + js)
        settle(page, 150)
    assert page.evaluate("window.__sets") == 2, "a última mudança volta ao valor já gravado: não regrava"
    assert page.evaluate("JSON.parse(localStorage.getItem('__gm:som'))") == {"volume": 0.4, "mudo": True}


def test_mudanca_sem_gesto_nao_e_gravada(make_ctx):
    page = open_ig(make_ctx)
    page.evaluate("document.getElementById('v1').volume = 0.1")
    settle(page, 200)
    assert page.evaluate("localStorage.getItem('__gm:som')") is None


def test_clique_fora_do_video_e_mudanca_por_codigo_nao_grava(make_ctx):
    page = open_ig(make_ctx)
    page.evaluate("window.__gesto = true")  # ativação de página ligada, como logo após um clique real
    page.click("#busca")
    page.evaluate("const v = document.getElementById('v1'); v.muted = false; v.volume = 0.2")
    settle(page, 200)
    assert page.evaluate("localStorage.getItem('__gm:som')") is None, "mudança do Instagram após clique fora"


def test_gesto_vence_depois_de_um_segundo(make_ctx):
    page = open_ig(make_ctx)
    gesto_no_video(page, "v1")
    page.wait_for_timeout(1200)
    page.evaluate("document.getElementById('v1').volume = 0.2")
    settle(page, 200)
    assert page.evaluate("localStorage.getItem('__gm:som')") is None


def test_gesto_em_outro_video_nao_grava(make_ctx):
    page = open_ig(make_ctx)
    gesto_no_video(page, "v2")
    page.evaluate("document.getElementById('v1').volume = 0.2")
    settle(page, 200)
    assert page.evaluate("localStorage.getItem('__gm:som')") is None


def test_tecla_m_do_script_grava(make_ctx):
    page = open_ig(make_ctx)
    page.evaluate("window.__gesto = true")
    page.keyboard.press("m")
    settle(page, 200)
    assert page.evaluate("JSON.parse(localStorage.getItem('__gm:som'))") == {"volume": 1, "mudo": False}


def test_volume_desligado_nao_grava_nem_aplica(make_ctx):
    page = open_ig(make_ctx, prefs={"volume": False}, som={"volume": 0.5, "mudo": True})
    assert page.evaluate("document.getElementById('v1').volume") == 1, "não aplica"
    count_som_sets(page)
    gesto_no_video(page, "v1")
    page.evaluate("document.getElementById('v1').volume = 0.2")
    page.keyboard.press("m")
    settle(page, 200)
    assert page.evaluate("window.__sets") == 0, "não grava"
    assert page.evaluate("JSON.parse(localStorage.getItem('__gm:som'))") == {"volume": 0.5, "mudo": True}


def test_video_reinserido_restaura_controls_e_um_so_listener(make_ctx):
    page = open_ig(make_ctx)
    assert page.evaluate("document.getElementById('v1').controls") is True
    page.evaluate("const v = document.getElementById('v1'); window.__v1 = v; window.__pai = v.parentElement; v.remove()")
    settle(page)
    page.evaluate("window.__pai.prepend(window.__v1)")
    settle(page)
    # Conta sem gravar: um listener duplicado não veria o valor já gravado e gravaria de novo.
    page.evaluate("window.__sets = 0; window.GM_setValue = k => { if (k === 'som') window.__sets++; }")
    gesto_no_video(page, "v1")
    page.evaluate("document.getElementById('v1').volume = 0.3")
    settle(page, 200)
    assert page.evaluate("window.__sets") == 1, "um só listener de volumechange"
    page.evaluate("window.__menu[0].f()")  # desliga a barra
    settle(page)
    assert page.evaluate("document.getElementById('v1').controls") is False, "controls volta ao original"
    assert page.errors == []


# ---------- Limpeza ----------

KEEP = ["#p1", "#p3", "#acoes3", "#perfil", "#rodape-lateral", "#feed", "#lateral", "#cabecalho-movel", "#entrar"]
GONE = ["#sug", "#p2", "#app-banner", "#sug-lateral", "#abrir-aplicativo"]


def test_limpeza_padrao(make_ctx):
    page = open_ig(make_ctx)
    assert vis(page, GONE) == {s: False for s in GONE}
    assert vis(page, KEEP) == {s: True for s in KEEP}
    assert page.evaluate("igTaps") == [], "nunca clica"


def test_limpeza_em_conteudo_novo(make_ctx):
    page = open_ig(make_ctx)
    page.evaluate("""const a = document.createElement('article'); a.id = 'p8';
        a.innerHTML = '<header><b>loja</b><br><span>Sponsored</span></header><div class=foto></div>';
        document.getElementById('feed').append(a);
        const b = document.createElement('article'); b.id = 'p7'; b.innerHTML = '<header><b>normal</b></header>';
        document.getElementById('feed').append(b);""")
    settle(page)
    assert vis(page, ["#p8", "#p7"]) == {"#p8": False, "#p7": True}


def test_patrocinado_so_no_cabecalho(make_ctx):
    page = open_ig(make_ctx)
    page.evaluate("""const a = document.createElement('article'); a.id = 'p5';
        a.innerHTML = '<header><b>pessoa</b></header><div class=m><video src=instagram-video.webm muted></video></div>'
          + '<div class=acoes><b>pessoa</b> <span>Patrocinado</span></div>';
        const b = document.createElement('article'); b.id = 'p51';
        b.innerHTML = '<div><img alt=av width=32 height=32><b>marca</b> <span>Sponsored</span></div><img alt=foto width=400 height=400>';
        document.getElementById('feed').append(a, b);""")
    settle(page)
    assert vis(page, ["#p5", "#p51"]) == {"#p5": True, "#p51": False}, "legenda não oculta; perto do autor oculta"


def test_marca_reavaliada_quando_o_post_e_reciclado(make_ctx):
    page = open_ig(make_ctx)
    assert vis(page, ["#p2"]) == {"#p2": False}
    page.evaluate("document.querySelector('#p2 header span').textContent = 'Seguir'")
    settle(page)
    assert vis(page, ["#p2"]) == {"#p2": True}
    page.evaluate("document.querySelector('#p2 header span').remove()")
    page.evaluate("document.querySelector('#p2 header').insertAdjacentHTML('beforeend', '<span>Patrocinado</span>')")
    settle(page)
    assert vis(page, ["#p2"]) == {"#p2": False}
    page.evaluate("document.querySelector('#p2 header span:last-child').remove()")
    settle(page)
    assert vis(page, ["#p2"]) == {"#p2": True}, "rótulo removido: o post volta"


@pytest.mark.parametrize("chave,ids", [("sugestoes", ["#sug", "#sug-lateral"]), ("patrocinados", ["#p2"]),
                                       ("app", ["#app-banner", "#abrir-aplicativo"])])
def test_limpeza_desligada_mostra(make_ctx, chave, ids):
    page = open_ig(make_ctx, prefs={chave: False})
    assert vis(page, ids) == {s: True for s in ids}
    others = [g for g in GONE if g not in ids]
    assert vis(page, others) == {s: False for s in others}


def test_limpeza_menu_ao_vivo(make_ctx):
    page = open_ig(make_ctx)
    page.evaluate("window.__menu.find(m => m.t.includes('patrocinados')).f()")
    assert vis(page, ["#p2"]) == {"#p2": True}
    page.evaluate("window.__menu.find(m => m.t.includes('patrocinados')).f()")
    assert vis(page, ["#p2"]) == {"#p2": False}


# ---------- Seguindo ----------

def test_seguindo_desligado_por_padrao(make_ctx):
    page = open_ig(make_ctx)
    assert page.url == FEED


def test_seguindo_redireciona(make_ctx):
    page = open_ig(make_ctx, prefs={"seguindo": True}, inject_now=False)
    with page.expect_navigation():
        inject(page, S)
    assert page.url == "https://www.instagram.com/?variant=following"
    inject(page, S)
    settle(page)
    assert page.url == "https://www.instagram.com/?variant=following", "sem laço"


def test_seguindo_sem_laco_quando_o_instagram_tira_o_variant(make_ctx):
    page = open_ig(make_ctx, prefs={"seguindo": True}, inject_now=False)
    with page.expect_navigation():
        inject(page, S)
    inject(page, S)
    settle(page)
    page.evaluate("history.replaceState({}, '', '/')")  # o Instagram volta para o início sem o variant
    settle(page, 600)
    assert page.url == FEED, "uma vez por aba na janela de tempo; sem redirecionar de novo"


def test_seguindo_na_navegacao_spa(make_ctx):
    page = open_ig(make_ctx, url="https://www.instagram.com/explore/", prefs={"seguindo": True})
    assert page.url.endswith("/explore/")
    page.evaluate("history.pushState({}, '', '/')")
    page.wait_for_url("**/?variant=following")
    assert page.url == "https://www.instagram.com/?variant=following"


# ---------- Escopo ----------

def test_fora_do_instagram_nao_faz_nada(make_ctx):
    ctx = make_ctx()
    route_ig(ctx, "instagram-feed.html", "https://www.exemplo.com.br")
    page = ctx.new_page()
    page.goto("https://www.exemplo.com.br/", wait_until="load")
    inject(page, S)
    settle(page)
    assert page.evaluate("!!document.getElementById('us-instagram-ux')") is False
    assert page.evaluate("window.__menu.length") == 0
    assert page.evaluate("document.getElementById('v1').controls") is False


# ---------- Desempenho na rolagem infinita ----------

INFINITO = "instagram-feed-infinito.html"
COUNT_EFP = """window.__efp = 0; const f = Document.prototype.elementsFromPoint;
    Document.prototype.elementsFromPoint = function (...a) { window.__efp++; return f.apply(this, a); }; 0;"""


def test_rolagem_continua_sem_varrer_quando_nada_muda(make_ctx):
    """Rolar com o vídeo inteiro na tela não refaz o recorte (nada de elementsFromPoint/layout forçado)."""
    page = open_ig(make_ctx, INFINITO)
    show(page, "#v0")
    settle(page, 400)
    assert page.evaluate("document.querySelector('#p0 .tap').hasAttribute('data-us-ig-cobre')")
    page.evaluate(COUNT_EFP)
    r = rect(page, "#v0")
    page.mouse.move(100, 300)
    for _ in range(20):  # rolagem contínua (sem pausa de 200 ms), o vídeo continua inteiro na tela
        page.mouse.wheel(0, 3)
        page.wait_for_timeout(40)
    assert page.evaluate("window.__efp") == 0, "nenhuma varredura de camadas durante a rolagem"
    settle(page, 500)
    assert page.evaluate("window.__efp") <= 10 * page.evaluate(
        "[...document.querySelectorAll('video')].filter(v => { const r = v.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }).length"), \
        "um recálculo só quando a rolagem para"
    r = rect(page, "#v0")
    assert hit(page, r["x"] + r["w"] / 2, r["b"] - 10) == "v0", "o furo acompanha o vídeo"
    assert hit(page, r["x"] + r["w"] / 2, r["y"] + r["h"] / 2) == "p0"
    assert page.errors == []


def test_barra_desligada_pelo_menu_nao_observa_nem_varre(make_ctx):
    page = open_ig(make_ctx, INFINITO)
    show(page, "#v0")
    settle(page, 400)
    page.evaluate("window.__menu.find(m => m.t.includes('Barra')).f()")
    settle(page, 300)
    assert page.evaluate("[...document.querySelectorAll('video')].every(v => !v.controls)")
    page.evaluate(COUNT_EFP)
    page.mouse.move(100, 300)
    for _ in range(15):
        page.mouse.wheel(0, 120)
        page.wait_for_timeout(40)
    settle(page, 500)
    assert page.evaluate("[...document.querySelectorAll('video')].every(v => !v.controls)")
    assert page.evaluate("window.__efp") == 0
    page.evaluate("window.__menu.find(m => m.t.includes('Barra')).f()")  # religa
    settle(page, 500)
    assert page.evaluate("[...document.querySelectorAll('video')].some(v => v.controls)"), "religar volta a funcionar"
    assert page.errors == []


def test_carregador_do_feed_continua_com_posts_ocultos(make_ctx):
    page = open_ig(make_ctx, INFINITO)
    before = page.evaluate("igLoads.length")
    for _ in range(6):
        page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
        settle(page, 250)
    assert page.evaluate("igLoads.length") >= before + 4, "a sentinela continua disparando"
    assert page.evaluate("document.querySelectorAll('article[data-us-ig-oculto=patrocinado]').length") >= 2
    assert page.evaluate("document.querySelectorAll('.sug[data-us-ig-oculto=sugestao]').length") >= 2
    assert vis(page, ["#p5", "#sug3", "#p0"]) == {"#p5": False, "#sug3": False, "#p0": True}
    # Vídeo de um lote novo: controles e furo como nos primeiros.
    vid = page.evaluate("[...document.querySelectorAll('video')].at(-2).id")
    show(page, "#" + vid)
    settle(page, 300)
    r = rect(page, "#" + vid)
    assert page.evaluate(f"document.getElementById('{vid}').controls") is True
    assert hit(page, r["x"] + r["w"] / 2, r["b"] - 10) == vid
    assert page.errors == []


def test_plano_descartado_quando_o_video_sai_da_tela(make_ctx):
    """Botão novo no post enquanto o vídeo está fora da tela: ao voltar, o furo é recalculado, não reaproveitado."""
    page = open_ig(make_ctx, INFINITO)
    show(page, "#v0")
    settle(page, 400)
    assert page.evaluate("document.querySelector('#p0 .tap').hasAttribute('data-us-ig-cobre')")
    y0 = page.evaluate("scrollY")
    page.evaluate("scrollTo(0, scrollY + 3000)")
    settle(page, 500)
    page.evaluate("""const b = document.createElement('button'); b.id = 'novo'; b.textContent = 'Marcar';
        b.style.cssText = 'position:absolute;left:12px;bottom:12px;width:120px;height:28px';
        document.querySelector('#p0 .tap').append(b);""")
    settle(page, 500)
    page.evaluate(f"scrollTo(0, {y0})")
    settle(page, 600)
    b, r = rect(page, "#novo"), rect(page, "#v0")
    assert hit(page, b["x"] + b["w"] / 2, b["y"] + b["h"] / 2) == "novo", "o controle novo na faixa continua tocável"
    assert hit(page, r["x"] + r["w"] * 0.75, r["b"] - 10) == "v0", "o furo encolhe para o lado livre"
    assert page.errors == []


def wheel_steps(page, n, dy, ms=40):
    for _ in range(n):
        page.mouse.wheel(0, dy)
        page.wait_for_timeout(ms)


def test_video_mais_alto_que_a_tela_tem_furo_durante_a_rolagem(make_ctx):
    """Vídeo mais alto que a tela nunca fica 100% visível: o furo aparece quando o fundo entra, ainda
    rolando, e some quando a faixa sai pelo topo, sem esperar a rolagem parar."""
    page = open_ig(make_ctx, INFINITO)
    page.evaluate("const m = document.querySelector('#p0 .m'); m.style.aspectRatio = 'auto'; m.style.height = '1100px'")
    page.evaluate("window.scrollTo(0, document.getElementById('v0').getBoundingClientRect().top + scrollY)")
    settle(page, 500)
    cut = "document.querySelector('#p0 .tap').hasAttribute('data-us-ig-cobre')"
    assert page.evaluate(cut) is False, "fundo fora da tela: sem furo"
    page.mouse.move(100, 300)
    wheel_steps(page, 25, 20)          # o fundo entra (1100 → ~600), sem pausa de repouso
    wheel_steps(page, 6, 3)
    r = rect(page, "#v0")
    assert r["y"] < 0 and r["b"] < page.viewport_size["height"]
    assert page.evaluate(cut), "furo durante a rolagem"
    assert hit(page, r["x"] + r["w"] / 2, r["b"] - 10) == "v0"
    assert hit(page, r["x"] + r["w"] / 2, r["b"] - 80) == "p0"
    # A faixa sai pelo topo: o recorte é desfeito ainda na rolagem.
    page.evaluate("window.__cortes = []; new MutationObserver(() => window.__cortes.push(document.querySelector('#p0 .tap').hasAttribute('data-us-ig-cobre')))"
                  ".observe(document.querySelector('#p0 .tap'), {attributes: true})")
    steps = int((r["b"] - 20) // 20)
    wheel_steps(page, steps, 20)
    r = rect(page, "#v0")
    assert 0 < r["b"] < 48, r
    page.wait_for_timeout(60)
    assert page.evaluate(cut) is False, "faixa fora da tela: recorte desfeito sem esperar o repouso"
    # Entrando por cima (rolando para cima): a faixa cabe antes de o vídeo inteiro entrar.
    wheel_steps(page, 8, -20)
    wheel_steps(page, 4, -3)
    r = rect(page, "#v0")
    assert r["y"] < 0 and r["b"] > 100
    assert page.evaluate(cut), "furo ao entrar por cima, durante a rolagem"
    assert hit(page, r["x"] + r["w"] / 2, r["b"] - 10) == "v0"
    assert page.errors == []


def test_texto_mudado_no_post_recalcula_o_furo(make_ctx):
    """Só characterData (rótulo na faixa que cresce): o vídeo do post é recalculado."""
    page = open_ig(make_ctx, inject_now=False)
    page.evaluate("""const a = document.createElement('a'); a.href = '#musica'; a.id = 'musica'; a.textContent = '♪';
        a.style.cssText = 'position:absolute;left:12px;bottom:14px;color:#fff;background:#000;padding:4px;white-space:nowrap';
        document.querySelector('#p1 .tap').append(a);""")
    inject(page, S)
    show(page, "#v1")
    settle(page, 400)
    page.evaluate("document.getElementById('musica').firstChild.nodeValue = '♪ conta_video · Áudio'")
    settle(page, 500)
    lk = rect(page, "#musica")
    assert hit(page, lk["x"] + lk["w"] - 6, lk["y"] + lk["h"] / 2) == "musica", "rótulo maior continua visível"
    r = rect(page, "#v1")
    assert hit(page, r["x"] + r["w"] * 0.6, r["b"] - 10) == "v1", "furo no lado livre"


def test_marca_dentro_de_no_pendente_e_reavaliada(make_ctx):
    """Post marcado movido para um invólucro novo e rótulo trocado no mesmo lote: a marca interna é reavaliada."""
    page = open_ig(make_ctx)
    assert vis(page, ["#p2"]) == {"#p2": False}
    page.evaluate("""const p = document.getElementById('p2'), w = document.createElement('div'); w.id = 'inv';
        p.before(w); w.append(p); document.querySelector('#p2 header span').firstChild.nodeValue = 'Seguir';""")
    settle(page)
    assert vis(page, ["#p2"]) == {"#p2": True}
    page.evaluate("""const p = document.getElementById('p2'), w = document.createElement('div'); w.id = 'inv2';
        p.before(w); w.append(p); document.querySelector('#p2 header span').firstChild.nodeValue = 'Patrocinado';""")
    settle(page)
    assert vis(page, ["#p2"]) == {"#p2": False}
