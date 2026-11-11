"""Leitura do bloco de metadados e casamento de URL como os gerenciadores fazem.

- @match: padrões do Chrome (<esquema>://<host><caminho>); `*` no esquema = http|https;
  `*.dominio` casa o domínio e qualquer subdomínio; porta não faz parte do host do padrão.
- @include/@exclude: glob (`*` = qualquer sequência) sobre a URL inteira, ou /regex/.
"""
import re
from urllib.parse import urlsplit


def metadata(text: str) -> list[tuple[str, str]]:
    m = re.search(r"^// ==UserScript==\n(.*?)^// ==/UserScript==", text, re.S | re.M)
    if not m:
        raise ValueError("sem bloco ==UserScript==")
    out = []
    for line in m.group(1).splitlines():
        mm = re.match(r"^//\s+@(\S+)(?:\s+(.*))?$", line)
        if not mm:
            raise ValueError(f"linha de metadado inválida: {line!r}")
        out.append((mm.group(1), (mm.group(2) or "").strip()))
    return out


def _match_one(pattern: str, url: str) -> bool:
    if pattern == "<all_urls>":
        return urlsplit(url).scheme in ("http", "https", "file", "ftp")
    m = re.match(r"^(\*|https?|file|ftp)://([^/]*)(/.*)$", pattern)
    if not m:
        raise ValueError(f"@match inválido: {pattern}")
    scheme, host, path = m.groups()
    u = urlsplit(url)
    if scheme == "*":
        if u.scheme not in ("http", "https"):
            return False
    elif u.scheme != scheme:
        return False
    h = (u.hostname or "").lower()
    if host == "*":
        pass
    elif host.startswith("*."):
        base = host[2:].lower()
        if not (h == base or h.endswith("." + base)):
            return False
    elif "*" in host:
        raise ValueError(f"curinga no meio do host: {pattern}")
    elif h != host.lower():
        return False
    full_path = (u.path or "/") + ("?" + u.query if u.query else "")
    rx = "^" + ".*".join(re.escape(p) for p in path.split("*")) + "$"
    return re.match(rx, full_path) is not None


def _glob(pattern: str, url: str) -> bool:
    if len(pattern) > 1 and pattern.startswith("/") and pattern.endswith("/"):
        return re.search(pattern[1:-1], url) is not None
    rx = "^" + ".*".join(re.escape(p) for p in pattern.split("*")) + "$"
    return re.match(rx, url) is not None


def runs_on(meta: list[tuple[str, str]], url: str) -> bool:
    matches = [v for k, v in meta if k == "match"]
    includes = [v for k, v in meta if k == "include"]
    excludes = [v for k, v in meta if k == "exclude"]
    exclude_matches = [v for k, v in meta if k == "exclude-match"]
    ok = any(_match_one(p, url) for p in matches) or any(_glob(p, url) for p in includes)
    if not ok:
        return False
    return not (any(_glob(p, url) for p in excludes) or any(_match_one(p, url) for p in exclude_matches))
