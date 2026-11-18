"""Medição de desempenho do instagram-ux na rolagem infinita (fixture instagram-feed-infinito.html).

Uso (de qualquer pasta):
    python3 tests/bench_instagram.py                  # sem script × script atual do repositório
    python3 tests/bench_instagram.py outro.user.js    # acrescenta outra versão (ex.: a publicada antes)
    python3 tests/bench_instagram.py --runs 3 --steps 160

Métricas por execução (média das rodadas):
  script_ms     tempo dentro do userscript (amostrador do CDP Profiler, inclusive: layout forçado conta)
  layouts/style  LayoutCount e RecalcStyleCount do CDP Performance.getMetrics durante a rolagem
  efp / gbcr    chamadas a document.elementsFromPoint e Element.getBoundingClientRect
  longtasks     tarefas > 50 ms (PerformanceObserver 'longtask') e soma em ms
  frame_p95     intervalo de quadro p95 (rAF) em ms
  lotes         lotes que o carregador da fixture acrescentou na mesma rolagem
  atraso_ms     atraso médio entre a sentinela ficar visível e o callback do carregador rodar
"""
import argparse
import json
import pathlib
import statistics
import sys

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
FIX = HERE / "fixtures"
SRC = HERE.parent / "src" / "instagram-ux.user.js"
URL = "https://www.instagram.com/"
MOUSE_X = 683
SCRIPT_URL = "us-instagram-ux-bench.js"

GM_STUB = """(() => { const P = '__gm:';
  window.GM_getValue = (k, d) => { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  window.GM_setValue = (k, v) => { localStorage.setItem(P + k, JSON.stringify(v)); };
  window.GM_registerMenuCommand = () => 0; window.GM_unregisterMenuCommand = () => {}; })();"""

PROBES = """(() => {
  const c = window.__probe = { efp: 0, gbcr: 0, long: 0, longMs: 0, frames: [] };
  const efp = Document.prototype.elementsFromPoint;
  Document.prototype.elementsFromPoint = function (...a) { c.efp++; return efp.apply(this, a); };
  const gb = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () { c.gbcr++; return gb.call(this); };
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) { c.long++; c.longMs += e.duration; } })
    .observe({ type: 'longtask', buffered: true }); } catch (_) {}
  let last = 0;
  const tick = t => { if (c.rec) { if (last) c.frames.push(t - last); last = t; } else last = 0; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})();"""


def handler(html, video):
    def handle(route):
        if route.request.url.endswith(".webm"):
            route.fulfill(status=200, body=video, headers={"Content-Type": "video/webm"})
        else:
            route.fulfill(status=200, body=html, content_type="text/html; charset=utf-8")
    return handle


def profile_ms(profile):
    nodes = {n["id"]: n for n in profile["nodes"]}
    dt = {}
    times = profile.get("timeDeltas", [])
    for sid, d in zip(profile.get("samples", []), times):
        dt[sid] = dt.get(sid, 0) + d
    total = 0.0
    per = {}

    def walk(nid, stack):
        nonlocal total
        n = nodes[nid]
        cf = n["callFrame"]
        if cf.get("url", "").endswith(SCRIPT_URL):
            stack = stack | {cf.get("functionName") or "(anônima)"}
        if stack:
            d = dt.get(nid, 0)
            total += d
            for f in stack:
                per[f] = per.get(f, 0) + d
        for ch in n.get("children", []):
            walk(ch, stack)
    walk(profile["nodes"][0]["id"], frozenset())
    return total / 1000.0, {k: v / 1000.0 for k, v in per.items()}


def run_once(browser, script, steps, html, video, cpu, prefs=None, delta=250, interval=40):
    ctx = browser.new_context(viewport={"width": 1366, "height": 768}, locale="pt-BR", bypass_csp=True)
    try:
        ctx.add_init_script(GM_STUB)
        if prefs:
            ctx.add_init_script(f"localStorage.setItem('__gm:ajustes', {json.dumps(json.dumps(prefs))})")
        ctx.add_init_script(PROBES)
        if script is not None:
            ctx.add_init_script(script + f"\n//# sourceURL={SCRIPT_URL}\n")
        ctx.route("https://www.instagram.com/**", handler(html, video))
        page = ctx.new_page()
        cdp = ctx.new_cdp_session(page)
        cdp.send("Performance.enable")
        cdp.send("Profiler.enable")
        if cpu > 1:
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": cpu})
        cdp.send("Profiler.setSamplingInterval", {"interval": 100})
        page.goto(URL, wait_until="load")
        page.wait_for_timeout(800)
        page.mouse.move(MOUSE_X, 400)
        m0 = {m["name"]: m["value"] for m in cdp.send("Performance.getMetrics")["metrics"]}
        page.evaluate("Object.assign(window.__probe, { efp: 0, gbcr: 0, long: 0, longMs: 0, frames: [], rec: true }); window.igLoads.length = 0")
        cdp.send("Profiler.start")
        for _ in range(steps):
            page.mouse.wheel(0, delta)
            page.wait_for_timeout(interval)
        page.wait_for_timeout(600)
        prof = cdp.send("Profiler.stop")["profile"]
        m1 = {m["name"]: m["value"] for m in cdp.send("Performance.getMetrics")["metrics"]}
        p = page.evaluate("(() => { const c = window.__probe; c.rec = false; return {efp: c.efp, gbcr: c.gbcr, long: c.long, longMs: c.longMs,"
                          " frames: c.frames, loads: window.igLoads, hidden: document.querySelectorAll('[data-us-ig-oculto]').length}; })()")
        fr = sorted(p["frames"]) or [0]
        sms, per = profile_ms(prof)
        top = sorted(per.items(), key=lambda kv: -kv[1])[:6]
        out = {
            "script_ms": sms,
            "layouts": m1["LayoutCount"] - m0["LayoutCount"],
            "style": m1["RecalcStyleCount"] - m0["RecalcStyleCount"],
            "layout_ms": (m1["LayoutDuration"] - m0["LayoutDuration"]) * 1000,
            "style_ms": (m1["RecalcStyleDuration"] - m0["RecalcStyleDuration"]) * 1000,
            "js_ms": (m1["ScriptDuration"] - m0["ScriptDuration"]) * 1000,
            "efp": p["efp"], "gbcr": p["gbcr"], "longtasks": p["long"], "long_ms": p["longMs"],
            "frame_p95": fr[int(0.95 * (len(fr) - 1))], "lotes": len(p["loads"]),
            "atraso_ms": statistics.mean([x["delay"] for x in p["loads"]]) if p["loads"] else 0,
            "ocultos": p["hidden"],
        }
    finally:
        ctx.close()
    return out, top


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scripts", nargs="*", help="versões extras do userscript para comparar")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--steps", type=int, default=120)
    ap.add_argument("--cpu", type=float, default=4, help="desaceleração de CPU do CDP (1 = sem)")
    ap.add_argument("--delta", type=int, default=250, help="px por passo da roda")
    ap.add_argument("--interval", type=int, default=40, help="ms entre passos")
    ap.add_argument("--prefs", default="", help='ajustes do script em JSON, ex.: {"barra": false}')
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    html = (FIX / "instagram-feed-infinito.html").read_bytes()
    video = (FIX / "instagram-video.webm").read_bytes()
    variants = [("sem script", None)] + [(pathlib.Path(s).name, pathlib.Path(s).read_text(encoding="utf-8")) for s in a.scripts] \
        + [("atual", SRC.read_text(encoding="utf-8"))]
    rows, tops = {}, {}
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        for name, code in variants:
            got = [run_once(br, code, a.steps, html, video, a.cpu, json.loads(a.prefs) if a.prefs else None, a.delta, a.interval) for _ in range(a.runs)]
            rs = [g[0] for g in got]
            rows[name] = {k: statistics.mean(r[k] for r in rs) for k in rs[0]}
            tops[name] = got[-1][1]
        br.close()
    if a.json:
        print(json.dumps(rows, indent=2))
        return
    keys = list(next(iter(rows.values())))
    print("variante".ljust(28) + "".join(k.rjust(11) for k in keys))
    for name, r in rows.items():
        print(name[:27].ljust(28) + "".join(f"{r[k]:11.1f}" for k in keys))
    for name, top in tops.items():
        if top:
            print(f"{name}: " + ", ".join(f"{f} {ms:.1f} ms" for f, ms in top))


if __name__ == "__main__":
    sys.exit(main())
