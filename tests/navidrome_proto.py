"""Protótipo do navidrome-letras no Navidrome real (rede local e sessão necessárias).

Uso: python3 tests/navidrome_proto.py <storage-state.json> <rótulo>=<id do álbum>,<título na lista>,<id da faixa>,<segundo> ...
  ex.: sync=<álbum>,<título>,<faixa>,64 embutida=<álbum>,<título>,<faixa>,40
  Base: NAVIDROME_URL (padrão http://127.0.0.1:4533). O storage state vem de um login feito à parte
  (um por sessão: o login da UI limita tentativas); este script nunca lê nem grava senha.
O script é injetado em document-start (como no gerenciador), a faixa toca muda e a barra de letra
NATIVA do player é aberta pelo próprio botão. Prints e resultados em NAVIDROME_SHOTS (padrão
.cache/navidrome-letras/, fora do git: contêm capa e letra da biblioteca de quem roda).
Bloqueados nas rotas: scrobble, relatório de reprodução, fila salva, favoritos, notas, playlists,
bookmarks e qualquer escrita em /api/* (nada persiste na conta).
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

from conftest import DESK_UA, GM_STUB, MOB_UA, ROOT, source

BASE = os.environ.get("NAVIDROME_URL", "http://127.0.0.1:4533").rstrip("/")
OUT = __import__("pathlib").Path(os.environ.get("NAVIDROME_SHOTS") or ROOT / ".cache" / "navidrome-letras")
OUT.mkdir(parents=True, exist_ok=True)
S = "navidrome-letras.user.js"
BLOCK = ("/rest/scrobble", "/rest/reportPlayback", "/rest/savePlayQueue", "/rest/star", "/rest/unstar",
         "/rest/setRating", "/rest/createPlaylist", "/rest/updatePlaylist", "/rest/deletePlaylist",
         "/rest/createBookmark", "/rest/deleteBookmark")
MUTE = """(() => { const o = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { this.muted = true; this.volume = 0; return o.call(this); }; })();"""


def guard(blocked):
    def h(route):
        r = route.request
        path = r.url.split("?")[0]
        if any(b in path for b in BLOCK) or ("/api/" in path and r.method != "GET"):
            blocked.append(f"{r.method} {path.replace(BASE, '')}")
            return route.abort()
        return route.continue_()
    return h


def shot(br, state, mobile, kind, track):
    album, title, song_id, seek = track
    ctx = br.new_context(storage_state=state,
                         viewport={"width": 412, "height": 915} if mobile else {"width": 1366, "height": 768},
                         device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile,
                         user_agent=MOB_UA if mobile else DESK_UA, locale="pt-BR", color_scheme="dark")
    ctx.add_init_script(GM_STUB)
    ctx.add_init_script(MUTE)
    ctx.add_init_script(source(S))  # document-start, como no gerenciador
    blocked, errors, lyr = [], [], []
    ctx.route("**/*", guard(blocked))
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)[:160]))
    pg.on("request", lambda r: lyr.append(r.url.rsplit("id=", 1)[-1].split("&")[0]) if "/rest/getLyricsBySongId" in r.url else None)
    name = f"{'cel' if mobile else 'pc'}-{kind}"
    res = {"mobile": mobile, "kind": kind}
    try:
        pg.goto(f"{BASE}/app/#/album/{album}/show", wait_until="domcontentloaded")
        row = pg.locator(f'tr:has-text("{title}"), li:has-text("{title}")').first
        row.wait_for(timeout=15000)
        row.click()
        pg.wait_for_function("() => { const a = document.querySelector('audio'); return a && a.readyState >= 2 && !a.paused; }", timeout=20000)
        pg.evaluate(f"document.querySelector('audio').currentTime = {seek}")
        pg.locator(".lyric-btn").first.click()  # botão de letra nativo do player
        if not mobile:
            pg.mouse.move(640, 30)
        pg.wait_for_timeout(2500)
        res.update(pg.evaluate("""id => { const q = JSON.parse(localStorage.getItem('state')).player.queue;
          const it = q.find(x => x.trackId === id) || {}; const bar = document.querySelector('.music-player-lyric');
          return { bar: bar ? bar.textContent : null, queue_lrc_lines: (it.lyric || '').split('\\n').filter(Boolean).length,
                   t: Math.round(document.querySelector('audio').currentTime) }; }""", song_id))
        pg.screenshot(path=str(OUT / f"{name}.png"))
        res["screenshot"] = str(OUT / f"{name}.png")
    except Exception as e:  # rede, sessão expirada, layout inesperado
        res["error"] = str(e)[:300]
    finally:
        try:
            pg.evaluate("document.querySelectorAll('audio').forEach(a => { a.pause(); a.removeAttribute('src'); a.load(); })")
        except Exception:
            pass
    res.update(lyrics_requests=len(lyr), lyrics_unique=len(set(lyr)), this_song_requested=song_id in lyr,
               blocked=sorted(set(blocked)), page_errors=errors)
    ctx.close()
    return res


if __name__ == "__main__":
    state = sys.argv[1]
    jobs = {}
    for arg in sys.argv[2:]:
        label, spec = arg.split("=", 1)
        parts = spec.split(",")  # o título pode ter vírgula
        jobs[label] = (parts[0], ",".join(parts[1:-2]), parts[-2], float(parts[-1]))
    if not jobs:
        sys.exit(__doc__)
    out = {}
    with sync_playwright() as p:
        br = p.chromium.launch()
        for kind, track in jobs.items():
            for mobile in (False, True):
                r = shot(br, state, mobile, kind, track)
                out[f"{'cel' if mobile else 'pc'}-{kind}"] = r
                print(json.dumps(r, ensure_ascii=False))
        br.close()
    (OUT / "resultados.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
