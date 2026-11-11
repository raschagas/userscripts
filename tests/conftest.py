"""Infra comum dos testes: navegador, stub do GM e fixtures servidas em hosts reais via route()."""
import pathlib

import pytest
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
FIX = ROOT / "tests" / "fixtures"

DESK_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
           "Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0")
MOB_UA = ("Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) "
          "Chrome/141.0.0.0 Mobile Safari/537.36 EdgA/141.0.0.0")

# GM_* com persistência em localStorage do próprio site: sobrevive a recarregar a página.
GM_STUB = """(() => {
  const P = '__gm:'; window.__menu = [];
  window.GM_getValue = (k, d) => { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  window.GM_setValue = (k, v) => { localStorage.setItem(P + k, JSON.stringify(v)); };
  window.GM_registerMenuCommand = (t, f) => { window.__menu.push({ t, f }); };
})();"""


def source(name: str) -> str:
    return (SRC / name).read_text(encoding="utf-8")


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        br = p.chromium.launch()
        yield br
        br.close()


@pytest.fixture
def make_ctx(browser):
    made = []

    def make(mobile=False, dark=False):
        ctx = browser.new_context(
            viewport={"width": 412, "height": 915} if mobile else {"width": 1366, "height": 768},
            device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile,
            user_agent=MOB_UA if mobile else DESK_UA, locale="pt-BR", bypass_csp=True,
            color_scheme="dark" if dark else "light")
        ctx.add_init_script(GM_STUB)
        made.append(ctx)
        return ctx

    yield make
    for c in made:
        c.close()


def serve(ctx, pattern: str, fixture: str):
    """Responde `pattern` (glob do Playwright) com o arquivo de fixture."""
    body = (FIX / fixture).read_bytes()
    ctx.route(pattern, lambda route: route.fulfill(status=200, body=body, content_type="text/html; charset=utf-8"))


def open_page(ctx, url: str):
    page = ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.goto(url, wait_until="load")
    return page


def inject(page, name: str):
    page.add_script_tag(content=source(name))
