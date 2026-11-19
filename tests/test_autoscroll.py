"""autoscroll: Ctrl+Shift+H liga, setas mudam a velocidade, Esc para, bloco sob o mouse, velocidade por site."""
from conftest import inject

S = "autoscroll.user.js"
PAGE = ("<!doctype html><html><body style='margin:0'>"
        "<div id='box' style='position:fixed;left:0;top:0;width:300px;height:200px;overflow:auto'>"
        "<div style='height:3000px'>caixa</div></div>"
        "<div style='height:20000px'>página</div><input id='campo'></body></html>")


def setup(make_ctx, body=PAGE, before=None):
    ctx = make_ctx()
    ctx.route("https://exemplo.com.br/**", lambda r: r.fulfill(status=200, body=body, content_type="text/html; charset=utf-8"))
    page = ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.goto("https://exemplo.com.br/", wait_until="load")
    if before:
        page.evaluate(before)
    inject(page, S)
    return page


def hud(page):
    return page.evaluate("() => { const h = document.querySelector('[data-us-autoscroll]'); return h ? h.textContent : null; }")


def test_liga_rola_e_para(make_ctx):
    page = setup(make_ctx)
    page.mouse.move(800, 400)
    page.keyboard.press("Control+Shift+H")
    assert "60 px/s" in hud(page)
    page.wait_for_timeout(1000)
    assert page.evaluate("scrollY") > 20
    page.keyboard.press("Escape")
    assert hud(page) is None
    y1 = page.evaluate("scrollY")
    page.wait_for_timeout(300)
    assert page.evaluate("scrollY") == y1
    assert not page.errors


def test_setas_velocidade_e_inversao(make_ctx):
    page = setup(make_ctx)
    page.evaluate("scrollTo(0, 5000)")
    page.mouse.move(800, 400)
    page.keyboard.press("Control+Shift+H")
    page.keyboard.press("ArrowDown")
    assert "▼ 70 px/s" in hud(page)
    page.keyboard.press("ArrowRight")
    assert "▼ 140 px/s" in hud(page)
    page.keyboard.press("ArrowLeft")
    assert "▼ 70 px/s" in hud(page)
    page.keyboard.press("r")
    assert "▲ 70 px/s" in hud(page)
    y0 = page.evaluate("scrollY")
    page.wait_for_timeout(800)
    assert page.evaluate("scrollY") < y0
    page.keyboard.press(" ")
    assert "pausado" in hud(page)
    page.keyboard.press("Escape")
    # velocidade lembrada no site, sempre positiva (ao religar começa para baixo)
    assert page.evaluate("JSON.parse(localStorage.getItem('__gm:velocidades'))['exemplo.com.br']") == 70


def test_rola_o_bloco_sob_o_mouse(make_ctx):
    page = setup(make_ctx)
    page.mouse.move(100, 100)
    page.keyboard.press("Control+Shift+H")
    page.wait_for_timeout(800)
    page.keyboard.press("Escape")
    assert page.evaluate("document.getElementById('box').scrollTop") > 10
    assert page.evaluate("scrollY") == 0


def test_campo_de_texto_mantem_as_setas(make_ctx):
    page = setup(make_ctx)
    page.mouse.move(800, 400)
    page.keyboard.press("Control+Shift+H")
    page.evaluate("document.getElementById('campo').focus()")
    page.keyboard.press("ArrowDown")
    assert "60 px/s" in hud(page)
    page.keyboard.press("Control+Shift+H")
    assert hud(page) is None


def test_pilula_some_e_volta(make_ctx):
    page = setup(make_ctx)
    page.mouse.move(800, 400)
    page.keyboard.press("Control+Shift+H")
    op = "() => document.querySelector('[data-us-autoscroll]').style.opacity"
    assert page.evaluate(op) == "1"
    page.wait_for_timeout(1700)
    assert page.evaluate(op) == "0"
    page.keyboard.press("ArrowDown")
    assert page.evaluate(op) == "1"
    page.keyboard.press("Escape")


def test_outras_abas_nao_sao_sobrescritas(make_ctx):
    page = setup(make_ctx)
    page.mouse.move(800, 400)
    page.keyboard.press("Control+Shift+H")
    # outra aba grava a velocidade de outro site enquanto esta rola
    page.evaluate("GM_setValue('velocidades', { 'outro.com': 300 })")
    page.keyboard.press("Escape")
    v = page.evaluate("JSON.parse(localStorage.getItem('__gm:velocidades'))")
    assert v == {"outro.com": 300, "exemplo.com.br": 60}


def test_scroll_behavior_smooth_continua_rolando(make_ctx):
    body = PAGE.replace("<body", "<head><style>:root{scroll-behavior:smooth}</style></head><body", 1)
    page = setup(make_ctx, body)
    page.mouse.move(800, 400)
    page.keyboard.press("Control+Shift+H")
    page.wait_for_timeout(1000)
    y1 = page.evaluate("scrollY")
    assert y1 > 20
    # passa do prazo de 8 s de "sem progresso": continua ativo e andando
    page.wait_for_timeout(8000)
    assert hud(page) is not None
    assert page.evaluate("scrollY") > y1 + 300
    page.keyboard.press("Escape")
    assert not page.errors


def test_body_como_conteiner_de_rolagem(make_ctx):
    body = ("<!doctype html><html><head><style>html,body{height:100%;margin:0;overflow:hidden}"
            "body{overflow-y:auto}</style></head><body><div style='height:20000px'>conteúdo</div></body></html>")
    page = setup(make_ctx, body)
    page.mouse.move(800, 400)
    page.keyboard.press("Control+Shift+H")
    page.wait_for_timeout(1000)
    assert page.evaluate("document.body.scrollTop") > 20
    page.keyboard.press("Escape")
    assert not page.errors


def test_esc_em_campo_para(make_ctx):
    page = setup(make_ctx)
    page.mouse.move(800, 400)
    page.keyboard.press("Control+Shift+H")
    page.evaluate("document.getElementById('campo').focus()")
    page.keyboard.press("Escape")
    assert hud(page) is None


def test_esc_parado_nao_e_engolido(make_ctx):
    page = setup(make_ctx)
    page.evaluate("window.__esc = 0; addEventListener('keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented) __esc++; })")
    page.keyboard.press("Escape")
    assert page.evaluate("__esc") == 1


def test_campo_em_shadow_dom_recebe_teclas(make_ctx):
    page = setup(make_ctx)
    page.evaluate("""() => {
      const h = document.createElement('div'); h.id = 'host'; document.body.prepend(h);
      h.attachShadow({ mode: 'open' }).innerHTML = '<input id="sombra">';
    }""")
    page.mouse.move(800, 400)
    page.keyboard.press("Control+Shift+H")
    page.evaluate("document.getElementById('host').shadowRoot.getElementById('sombra').focus()")
    page.keyboard.type("r ")
    assert page.evaluate("document.getElementById('host').shadowRoot.getElementById('sombra').value") == "r "
    assert "▼ 60 px/s" in hud(page)
    assert "pausado" not in hud(page)
    page.keyboard.press("Escape")


def test_pilula_esmaecida_nao_bloqueia_clique(make_ctx):
    page = setup(make_ctx)
    page.evaluate("""() => {
      const b = document.createElement('button'); b.id = 'canto'; b.textContent = 'ok';
      b.style.cssText = 'position:fixed;right:0;bottom:0;width:200px;height:80px';
      document.body.appendChild(b);
    }""")
    page.mouse.move(400, 300)
    page.keyboard.press("Control+Shift+H")
    pt = "() => { const r = document.querySelector('[data-us-autoscroll]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }"
    x, y = page.evaluate(pt)
    hit = "([x, y]) => document.elementFromPoint(x, y).id || document.elementFromPoint(x, y).hasAttribute('data-us-autoscroll')"
    assert page.evaluate(hit, [x, y]) is True  # visível: a pílula está por cima
    page.wait_for_timeout(1700)
    assert page.evaluate(hit, [x, y]) == "canto"
    # o mouse perto da pílula a traz de volta
    page.mouse.move(x, y)
    assert page.evaluate("() => document.querySelector('[data-us-autoscroll]').style.opacity") == "1"
    assert page.evaluate(hit, [x, y]) is True
    page.mouse.move(400, 300)
    page.keyboard.press("Escape")


def test_desligar_neste_site_pelo_menu(make_ctx):
    page = setup(make_ctx)
    titles = page.evaluate("__menu.map(m => m.t)")
    assert "Desligar neste site" in titles
    page.evaluate("__menu.find(m => m.t === 'Desligar neste site').f()")
    page.mouse.move(800, 400)
    page.keyboard.press("Control+Shift+H")
    assert hud(page) is None
    assert page.evaluate("JSON.parse(localStorage.getItem('__gm:desligado'))") == "exemplo.com.br"


def test_site_desligado_tem_menu_para_ligar(make_ctx):
    page = setup(make_ctx, before="localStorage.setItem('__gm:desligado', JSON.stringify('exemplo.com.br'))")
    page.mouse.move(800, 400)
    page.keyboard.press("Control+Shift+H")
    assert hud(page) is None
    page.evaluate("__menu.find(m => m.t === 'Ligar neste site').f()")
    page.keyboard.press("Control+Shift+H")
    assert "60 px/s" in hud(page)
    page.keyboard.press("Escape")


def test_clique_para(make_ctx):
    page = setup(make_ctx)
    page.mouse.move(800, 400)
    page.keyboard.press("Control+Shift+H")
    page.mouse.click(800, 400)
    assert hud(page) is None


def test_auto_repeat_nao_alterna_pausa_nem_inverte(make_ctx):
    page = setup(make_ctx)
    page.mouse.move(800, 400)
    page.keyboard.press("Control+Shift+H")
    send = ("(k) => window.dispatchEvent(new KeyboardEvent('keydown', "
            "{key: k, repeat: true, bubbles: true, cancelable: true}))")
    page.evaluate(send, " ")
    page.evaluate(send, "r")
    assert "pausado" not in hud(page)
    assert "▼ 60 px/s" in hud(page)
    page.keyboard.press(" ")
    assert "pausado" in hud(page)
    assert not page.errors
