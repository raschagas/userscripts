"""Prints a partir das fixtures (dados fictícios): borrão, escala 0–10 e painel escuro. Sem rede."""
from playwright.sync_api import sync_playwright

from conftest import DESK_UA, FIX, GM_STUB, MOB_UA, ROOT, source

OUT = ROOT / "docs" / "screenshots"


def page(br, host, fixture, mobile=False, dark=False, init=None):
    ctx = br.new_context(viewport={"width": 412, "height": 915} if mobile else {"width": 1366, "height": 768},
                         device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile,
                         user_agent=MOB_UA if mobile else DESK_UA, locale="pt-BR",
                         color_scheme="dark" if dark else "light")
    ctx.add_init_script(GM_STUB)
    if init:
        ctx.add_init_script(init)
    body = (FIX / fixture).read_bytes()
    ctx.route(host + "**", lambda r: r.fulfill(body=body, content_type="text/html; charset=utf-8"))
    pg = ctx.new_page()
    pg.goto(host)
    return pg


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = page(br, "https://outlook.live.com/", "pii.html",
              init="localStorage.setItem('__gm:nomes', JSON.stringify('Fulano, Fulana, Beltrano, Beltrana, Ciclano'))")
    pg.add_script_tag(content=source("dados-pessoais.user.js"))
    pg.keyboard.press("Alt+Shift+KeyP"); pg.wait_for_timeout(300)
    pg.screenshot(path=str(OUT / "dados-pessoais-fixture.png"))
    b = pg.evaluate("(() => { const d = document.querySelectorAll('#pv-layer > div')[9].getBoundingClientRect(); return [d.left + d.width / 2, d.top + d.height / 2]; })()")
    pg.mouse.move(*b); pg.wait_for_timeout(250)
    pg.screenshot(path=str(OUT / "dados-pessoais-fixture-hover.png"))
    pg = page(br, "https://web.whatsapp.com/", "whatsapp-web.html", init="localStorage.setItem('__gm:ligado', 'true')")
    pg.add_script_tag(content=source("dados-pessoais.user.js")); pg.wait_for_timeout(300)
    pg.locator("#pv-gear").click(); pg.wait_for_timeout(250)
    pg.screenshot(path=str(OUT / "dados-pessoais-ajustes-fixture.png"), clip={"x": 0, "y": 0, "width": 700, "height": 768})
    pg = page(br, "https://loja-exemplo.invalid/", "shop10.html")
    pg.add_script_tag(content=source("shop-filter.user.js"))
    pg.locator("#us-shop-filter .pill").click(); pg.wait_for_timeout(250)
    pg.screenshot(path=str(OUT / "shop-escala-10-fixture.png"))
    pg = page(br, "https://www.amazon.com.br/", "shop-amazon.html", dark=True)
    pg.add_script_tag(content=source("shop-filter.user.js"))
    pg.locator("#us-shop-filter .pill").click(); pg.wait_for_timeout(250)
    pg.screenshot(path=str(OUT / "shop-painel-escuro-fixture.png"))
    br.close()
print("ok")
