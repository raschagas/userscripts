"""Impressora IPP de mentira (127.0.0.1) para conferir o script: decodifica o
pedido (RFC 8010), responde Get-Printer-Attributes e guarda o Print-Job em disco."""
import struct, sys, json
from http.server import BaseHTTPRequestHandler, HTTPServer
OUT = sys.argv[2]

def decode(b):
    ver, op, rid = b[0:2], struct.unpack("!H", b[2:4])[0], struct.unpack("!I", b[4:8])[0]
    i, groups, cur, last = 8, [], None, None
    while True:
        t = b[i]; i += 1
        if t == 3: break
        if t < 0x10: cur = {"group": t, "attrs": {}}; groups.append(cur); continue
        nl = struct.unpack("!H", b[i:i+2])[0]; i += 2; name = b[i:i+nl].decode(); i += nl
        vl = struct.unpack("!H", b[i:i+2])[0]; i += 2; raw = b[i:i+vl]; i += vl
        val = struct.unpack("!i", raw)[0] if t in (0x21, 0x23) else raw.decode()
        if name: last = name; cur["attrs"][name] = [val]
        else: cur["attrs"][last].append(val)
    return {"version": list(ver), "op": op, "request_id": rid, "groups": groups, "data": b[i:]}

def a(tag, name, *vals):
    out = b""
    for k, v in enumerate(vals):
        n = name.encode() if k == 0 else b""
        raw = struct.pack("!i", v) if tag in (0x21, 0x23) else str(v).encode()
        out += bytes([tag]) + struct.pack("!H", len(n)) + n + struct.pack("!H", len(raw)) + raw
    return out

class H(BaseHTTPRequestHandler):
    def log_message(self, *x): pass
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        if self.path.endswith("/lixo"):   # impressora que responde IPP truncado
            return self.ipp(b"\x01\x01\x00")
        req = decode(body)
        rid = req["request_id"]
        if self.path.endswith("/so-cabecalho"):   # só os 8 bytes do cabeçalho, sem atributos nem fim
            return self.ipp(struct.pack("!BBHI", 1, 1, 0, rid))
        if self.path.endswith("/outro-id"):   # request-id que não é o do pedido
            rid = rid + 1
        head = struct.pack("!BBHI", 1, 1, 0, rid) + bytes([1])
        if self.path.endswith("/versao-9"):   # versão IPP 9.1: não existe
            return self.ipp(struct.pack("!BBHI", 9, 1, 0, rid) + bytes([1, 3]))
        if self.path.endswith("/inteiro-curto"):   # integer com 2 bytes em vez de 4
            return self.ipp(head + bytes([0x21]) + struct.pack("!H", 6) + b"job-id" + struct.pack("!H", 2) + b"\x00\x2a" + bytes([3]))
        if self.path.endswith("/estoura"):   # comprimento do valor maior que o resto do buffer
            return self.ipp(head + bytes([0x41]) + struct.pack("!H", 4) + b"nome" + struct.pack("!H", 500) + b"abc" + bytes([3]))
        resp = struct.pack("!BBHI", 1, 1, 0, rid) + bytes([1]) + a(0x47, "attributes-charset", "utf-8") + a(0x48, "attributes-natural-language", "pt-br")
        if req["op"] == 0x0B:
            resp += bytes([4]) + a(0x49, "document-format-supported", "application/pdf", "image/pwg-raster", "image/urf") \
                + a(0x44, "sides-supported", "one-sided", "two-sided-long-edge", "two-sided-short-edge") \
                + a(0x21, "number-up-supported", 1, 2, 4) + a(0x44, "media-supported", "iso_a4_210x297mm", "iso_a5_148x210mm") \
                + a(0x41, "printer-make-and-model", "Impressora de bancada IPP Everywhere")
        else:
            resp += bytes([2]) + a(0x21, "job-id", 42)
        if not self.path.endswith("/sem-fim"):   # sem-fim: termina sem a tag 0x03
            resp += bytes([3])
        log = {k: v for k, v in req.items() if k != "data"}; log["data_len"] = len(req["data"]); log["data_head"] = req["data"][:5].decode(errors="replace")
        with open(OUT, "a") as f: f.write(json.dumps(log, ensure_ascii=False) + "\n")
        self.send_response(200); self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Content-Type", "application/ipp"); self.send_header("Content-Length", str(len(resp))); self.end_headers(); self.wfile.write(resp)
    def ipp(self, resp):
        self.send_response(200); self.send_header("Content-Type", "application/ipp"); self.send_header("Content-Length", str(len(resp))); self.end_headers(); self.wfile.write(resp)
    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "Content-Type"); self.send_header("Access-Control-Allow-Methods", "POST"); self.end_headers()
    def do_GET(self):
        # O PDF sai em qualquer caminho com /api/print/ (raiz ou sob /reader); o destino do
        # redirecionamento também responde, para a recusa vir do finalUrl e não de um 404.
        if "redireciona" in self.path:   # o servidor manda o PDF para fora de /api/print/
            self.send_response(302); self.send_header("Location", "/api/bookmarks/1.pdf"); self.send_header("Content-Length", "0"); self.end_headers(); return
        if "nao-pdf" in self.path:
            body = b"<html>pagina de erro</html>"
            self.send_response(200); self.send_header("Content-Type", "text/html"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body); return
        pdf = b"%PDF-1.4\n% artigo de teste\n%%EOF\n"
        self.send_response(200); self.send_header("Content-Type", "application/pdf")
        self.send_header("X-Print-Sides", "two-sided-long-edge"); self.send_header("X-Print-Media", "iso_a5_148x210mm"); self.send_header("X-Print-Booklet", "unavailable"); self.send_header("Content-Length", str(len(pdf))); self.end_headers(); self.wfile.write(pdf)

HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
