"""Impressão direta: o userscript roda no Node contra a impressora IPP de bancada (127.0.0.1)."""
import json
import shutil
import socket
import subprocess
import sys
import time

import pytest

from conftest import ROOT, SRC

IPP = ROOT / "tests" / "ipp"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def run_bench(tmp, *extra):
    """Sobe a impressora de bancada, roda o bench (argumentos extras: pathname) e devolve (saída, jobs)."""
    node = shutil.which("node")
    assert node, "node ausente"
    port, log = free_port(), tmp / "jobs.jsonl"
    srv = subprocess.Popen([sys.executable, str(IPP / "mock_printer.py"), str(port), str(log)])
    try:
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)
        r = subprocess.run([node, str(IPP / "bench.mjs"), str(SRC / "news-reader-impressao.user.js"), str(port), *extra],
                           capture_output=True, text=True, timeout=60)
        assert r.returncode == 0, r.stderr
        out = {}
        for line in r.stdout.splitlines():
            k, v = line[:34].strip(), line[34:].strip()
            out[k] = json.loads(v)
        jobs = [json.loads(x) for x in log.read_text().splitlines()] if log.exists() else []
        return out, jobs
    finally:
        srv.terminate()
        srv.wait()


@pytest.fixture(scope="module")
def bench(tmp_path_factory):
    return run_bench(tmp_path_factory.mktemp("ipp"))


def test_base_do_app_sob_reader(tmp_path):
    # SPA com rotas por hash sob /reader/: NR.BASE = "/reader", e o PDF só vale sob /reader/api/print/.
    out, jobs = run_bench(tmp_path, "/reader/")
    assert out["job sob a base"] == {"seq": 1, "ok": True, "printer": "Bancada", "job_id": 42, "booklet": "unavailable"}
    assert out["job fora da base"] == {"seq": 2, "ok": False, "reason": "PDF fora do News Reader"}
    assert len([j for j in jobs if j["op"] == 2]) == 1


def test_recusas_sem_gesto(bench):
    out, _ = bench
    assert out["probe sem gesto"]["error"] == "sem gesto em Configurações"
    assert out["save sem gesto confiável"] == {"what": "save", "reason": "sem gesto em Configurações"}
    assert out["job sem clique no Imprimir"]["reason"] == "sem clique no Imprimir"
    assert out["mesmo clique, segundo job"]["reason"] == "sem clique no Imprimir"


def test_so_ipp_e_so_pdf_do_news_reader(bench):
    out, _ = bench
    assert "ipp://" in out["probe http:// (não ipp)"]["error"]
    assert out["job pdf de outra origem"]["reason"] == "PDF fora do News Reader"
    assert out["job fora de /api/print/"]["reason"] == "PDF fora do News Reader"
    assert out["job resposta não-PDF"]["reason"] == "A resposta não é um PDF"
    assert out["impressora não cadastrada"]["reason"] == "Impressora não cadastrada neste aparelho"


def test_resposta_ipp_estrita(bench):
    out, _ = bench
    for k in ("probe resposta truncada", "probe só cabeçalho (8 bytes)", "probe sem a tag de fim",
              "probe request-id diferente", "probe versão 9", "probe inteiro com 2 bytes", "probe comprimento estoura"):
        assert out[k].get("error") == "resposta IPP inválida", (k, out[k])


def test_um_gesto_uma_sondagem_um_cadastro(bench):
    out, _ = bench
    assert out["probe ipp com gesto"]["caps"]["pdf"] is True
    assert out["probe segundo com o mesmo gesto"]["error"] == "sem gesto em Configurações"
    assert out["save segundo com o mesmo gesto"] == {"what": "save", "reason": "sem gesto em Configurações"}


def test_sem_usuario_nem_ipv6_no_endereco(bench):
    out, _ = bench
    for k in ("probe com usuário no host", "probe IPv6"):
        assert "ipp://" in out[k]["error"] and "caps" not in out[k], (k, out[k])


def test_redirecionamento_para_fora_recusado(bench):
    out, _ = bench
    assert out["job redirecionado para fora"]["reason"] == "PDF fora do News Reader"


def test_post_ipp_sem_cookies_e_em_blob(bench):
    out, _ = bench
    posts = [c for c in out["chamadas GM_xmlhttpRequest"] if c["method"] == "POST"]
    assert posts and all(c == {"method": "POST", "anonymous": True, "blob": True, "type": "application/ipp"} for c in posts), posts


def test_lista_revalidada(bench):
    out, _ = bench
    dev = out["save com gesto (lista revalidada)"]
    assert [p["name"] for p in dev["printers"]] == ["Bancada"]   # javascript:, usuário e IPv6 descartados
    assert dev["default_printer"] == "Bancada"


def test_job_valido_chega_a_impressora(bench):
    out, jobs = bench
    assert out["probe ipp com gesto"]["caps"]["pdf"] is True
    assert out["job válido"] == {"seq": 5, "ok": True, "printer": "Bancada", "job_id": 42, "booklet": "unavailable"}
    prints = [j for j in jobs if j["op"] == 2]
    assert len(prints) == 2, "só os jobs válidos chegam à impressora"
    job = next(j for j in prints if j["groups"][0]["attrs"]["job-name"] == ["Conselho propõe perda de cargo"])
    assert job["data_head"] == "%PDF-"
    attrs = {k: v for g in job["groups"] for k, v in g["attrs"].items()}
    assert attrs["document-format"] == ["application/pdf"]
    assert attrs["sides"] == ["two-sided-long-edge"] and attrs["media"] == ["iso_a5_148x210mm"]
    assert attrs["print-scaling"] == ["none"]


def test_job_name_cortado_em_255_bytes(bench):
    out, jobs = bench
    assert out["job título longo acentuado"]["ok"] is True
    title = "Ação já é exceção. " * 30
    names = [j["groups"][0]["attrs"]["job-name"][0] for j in jobs if j["op"] == 2]
    longo = [n for n in names if n.startswith("Ação")]
    assert len(longo) == 1
    raw = longo[0].encode("utf-8")
    assert 250 <= len(raw) <= 255 and title.startswith(longo[0]), len(raw)   # sem partir caractere
