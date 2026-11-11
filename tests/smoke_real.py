"""Smoke em páginas reais (rede necessária; falhas de rede ficam registradas, não abortam).

Uso: python3 tests/smoke_real.py [nome ...]   — prints em docs/screenshots/, resumo em
docs/screenshots/smoke-resultados.json. Sem argumentos roda tudo.
"""
import json
import re
import sys
import time

from playwright.sync_api import sync_playwright

from conftest import DESK_UA, GM_STUB, MOB_UA, ROOT, source

OUT = ROOT / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
ONLY = set(sys.argv[1:])

# Rola até a 2ª fileira de cartões ficar inteira abaixo do cabeçalho fixo.
SCROLL_ROW = """sel => {
  let hb = 0;
  for (const y of [2, 30, 60, 90, 120]) {
    for (let e = document.elementFromPoint(innerWidth / 2, y); e && e !== document.body; e = e.parentElement) {
      const p = getComputedStyle(e).position;
      const b = e.getBoundingClientRect().bottom;
      if ((p === 'fixed' || p === 'sticky') && b < 250) { hb = Math.max(hb, b); break; }  // ignora camadas de página inteira
    }
  }
  const c = [...document.querySelectorAll(sel)].filter(e => e.getBoundingClientRect().height > 60);
  const tops = [...new Set(c.map(e => Math.round(e.getBoundingClientRect().top + scrollY)))].sort((a, b) => a - b);
  const row = tops.find(t => t > (tops[0] || 0) + 40) || tops[0] || 300;
  scrollTo(0, Math.max(0, row - hb - 12)); return {header: Math.round(hb), row, rows: tops.length};
}"""
STATS = "() => Object.assign({}, document.getElementById('us-shop-filter')?.dataset || {})"


def context(br, mobile):
    ctx = br.new_context(viewport={"width": 412, "height": 915} if mobile else {"width": 1366, "height": 768},
                         device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile,
                         user_agent=MOB_UA if mobile else DESK_UA, locale="pt-BR", bypass_csp=True)
    ctx.add_init_script(GM_STUB)
    return ctx


def goto(pg, url, wait=5000):
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
    r = pg.goto(url, wait_until="domcontentloaded", timeout=45000)
    pg.wait_for_timeout(wait)
    return (r.status if r else None), errs


def shop(br, name, url, mobile, sel, panel=False):
    ctx = context(br, mobile)
    pg = ctx.new_page()
    res = {"url": url, "mobile": mobile}
    try:
        status, errs = goto(pg, url)
        res["http"] = status
        base_errs = len(errs)
        t0 = time.perf_counter()
        pg.add_script_tag(content=source("shop-filter.user.js"))
        res["inject_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        res["first_scan"] = pg.evaluate(STATS)
        res["scroll"] = pg.evaluate(SCROLL_ROW, sel)
        pg.wait_for_timeout(2500)
        res["after_scroll"] = pg.evaluate(STATS)
        if panel:
            pg.locator("#us-shop-filter .pill").click()
            pg.wait_for_timeout(300)
        pg.screenshot(path=str(OUT / f"{name}.png"))
        res["screenshot"] = f"docs/screenshots/{name}.png"
        res["page_errors_before_inject"] = base_errs
        res["page_errors_after_inject"] = len(errs) - base_errs
        res["errors_sample"] = errs[base_errs:base_errs + 3]
    except Exception as e:  # rede, captcha, timeout
        res["error"] = str(e)[:200]
    ctx.close()
    return res


def links(br, name, url, scroll=0, mask_credits=False):
    ctx = context(br, False)
    pg = ctx.new_page()
    res = {"url": url}
    try:
        res["http"], errs = goto(pg, url)
        for s in ["button:has-text('Aceitar tudo')", "button:has-text('Accept all')", "button:has-text('OK')"]:
            try:
                pg.locator(s).first.click(timeout=1200)
            except Exception:
                pass
        if scroll:
            pg.mouse.wheel(0, scroll)
            pg.wait_for_timeout(800)
        pg.add_script_tag(content=source("georritmo-links.user.js"))
        pg.wait_for_timeout(400)
        res["links"] = pg.evaluate("() => { const h = document.getElementById('us-georritmo-links'); return h ? [...h.shadowRoot.querySelectorAll('a')].map(a => a.href) : []; }")
        # Crédito de foto de terceiro ("@ Nome") fica coberto no print.
        mask = [pg.get_by_text(re.compile(r"^\s*@\s*\S"))] if mask_credits else []
        res["masked"] = mask[0].count() if mask else 0
        pg.screenshot(path=str(OUT / f"{name}.png"), mask=mask, mask_color="#6b7280")
        res["screenshot"] = f"docs/screenshots/{name}.png"
    except Exception as e:
        res["error"] = str(e)[:200]
    ctx.close()
    return res


def cookies(br, name, url):
    ctx = context(br, False)
    pg = ctx.new_page()
    res = {"url": url}
    try:
        res["http"], errs = goto(pg, url, 4000)
        pg.screenshot(path=str(OUT / f"cookies-{name}-antes.png"))
        c0 = len(ctx.cookies())
        # Registra o clique pelo console: alguns sites (gov.br) recarregam a página ao aceitar.
        clicks = []
        pg.on("console", lambda m: clicks.append((time.perf_counter(), m.text)) if m.text.startswith("US_CLICK") else None)
        pg.evaluate("""() => { const o = HTMLElement.prototype.click; HTMLElement.prototype.click = function () {
          console.log('US_CLICK ' + (this.id ? '#' + this.id : '') + ' ' + (this.innerText || this.value || '').trim().slice(0, 40)); return o.call(this); }; }""")
        pg.evaluate("localStorage.setItem('__gm:debug', 'true')")
        t0 = time.perf_counter()
        pg.add_script_tag(content=source("cookies-aceitar.user.js"))
        for _ in range(70):
            if clicks:
                break
            pg.wait_for_timeout(100)
        pg.wait_for_timeout(300)
        try:
            how = pg.evaluate("document.documentElement.dataset.usCookies || null")
        except Exception:
            how = "(a página recarregou depois do clique)"
        res["clicked"] = how or None
        res["click"] = clicks[0][1] if clicks else None
        res["ms_to_click"] = round((clicks[0][0] - t0) * 1000) if clicks else None
        pg.wait_for_timeout(2500)
        pg.screenshot(path=str(OUT / f"cookies-{name}-depois.png"))
        res["cookies"] = [c0, len(ctx.cookies())]
        res["screenshots"] = [f"docs/screenshots/cookies-{name}-antes.png", f"docs/screenshots/cookies-{name}-depois.png"]
    except Exception as e:
        res["error"] = str(e)[:200]
    ctx.close()
    return res


ALI = "https://pt.aliexpress.com/w/wholesale-suporte-monitor.html"
AMZ = "https://www.amazon.com.br/s?k=suporte+monitor"
KABUM = "https://www.kabum.com.br/busca/suporte-monitor"
ALI_SEL = 'a[class*="cards--card--"], [class^="galleryItem--"]'
AMZ_SEL = '[data-component-type="s-search-result"]'
JOBS = {
    "shop-ali-pc": lambda b: shop(b, "shop-ali-pc", ALI, False, ALI_SEL),
    "shop-ali-cel": lambda b: shop(b, "shop-ali-cel", ALI, True, ALI_SEL),
    "shop-ali-cel-gaveta": lambda b: shop(b, "shop-ali-cel-gaveta", ALI, True, ALI_SEL, panel=True),
    "shop-amazon-pc": lambda b: shop(b, "shop-amazon-pc", AMZ, False, AMZ_SEL, panel=True),
    "shop-amazon-cel": lambda b: shop(b, "shop-amazon-cel", AMZ, True, AMZ_SEL),
    "shop-kabum-pc": lambda b: shop(b, "shop-kabum-pc", KABUM, False, 'a[href*="/produto/"].group'),
    "links-letterboxd": lambda b: links(b, "links-letterboxd", "https://letterboxd.com/film/central-station/"),
    "links-google-voos": lambda b: links(b, "links-google-voos", "https://www.google.com/travel/flights?q=Flights%20from%20GRU%20to%20SSA%20on%202027-03-10%20through%202027-03-17&hl=pt-BR&curr=BRL"),
    "links-receita": lambda b: links(b, "links-receita", "https://www.tudogostoso.com.br/receita/2384-pao-de-queijo-de-liquidificador.html", 500, True),
    "cookies-kabum": lambda b: cookies(b, "kabum", "https://www.kabum.com.br/"),
    "cookies-tudogostoso": lambda b: cookies(b, "tudogostoso", "https://www.tudogostoso.com.br/"),
    "cookies-govbr": lambda b: cookies(b, "govbr", "https://www.gov.br/pt-br"),
    "cookies-ge": lambda b: cookies(b, "ge", "https://ge.globo.com/"),
}

if __name__ == "__main__":
    out_file = OUT / "smoke-resultados.json"
    results = json.loads(out_file.read_text()) if out_file.exists() and ONLY else {}
    with sync_playwright() as p:
        br = p.chromium.launch()
        for k, job in JOBS.items():
            if ONLY and k not in ONLY:
                continue
            t0 = time.perf_counter()
            results[k] = job(br)
            results[k]["total_s"] = round(time.perf_counter() - t0, 1)
            print(k, json.dumps(results[k], ensure_ascii=False))
        br.close()
    out_file.write_text(json.dumps(results, ensure_ascii=False, indent=1))
