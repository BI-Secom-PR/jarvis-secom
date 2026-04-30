"""
Vercel Python serverless function for the verification engine.

Receives POST with JSON body:
  {
    "consolidado_b64": "<base64>",
    "consolidado_name": "file.xlsx",
    "comp_files": [{"name": "comp.xlsx", "b64": "<base64>"}, ...],
    "verif_files": [{"name": "verif.xlsx", "b64": "<base64>"}, ...],
    "adserver": "adforce",
    "ini": "01/01/2026",   # optional DD/MM/YYYY
    "fim": "31/01/2026",   # optional DD/MM/YYYY
  }

Returns JSON with engine result + output_b64 (verified xlsx as base64).
"""

import base64
import importlib
import json
import os
import shutil
import sys
import tempfile
from datetime import date
from http.server import BaseHTTPRequestHandler
from pathlib import Path

# ── Path setup — engine.py lives at app/verification/ relative to repo root ──
_ROOT = str(Path(__file__).parent.parent.parent)
sys.path.insert(0, os.path.join(_ROOT, "app", "verification"))
sys.path.insert(0, os.path.join(_ROOT, "app", "verification", "parsers"))


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        d, m, y = s.split("/")
        return date(int(y), int(m), int(d))
    except Exception:
        return None


def _patch_openpyxl_colors():
    """Some xlsx files use non-standard color codes that fail openpyxl's strict validator."""
    try:
        from openpyxl.descriptors import MatchedString
        _orig = MatchedString.__set__
        def _lenient(self, instance, value):
            try:
                _orig(self, instance, value)
            except ValueError:
                pass
        MatchedString.__set__ = _lenient
    except Exception:
        pass


def _run_engine(body: dict) -> dict:
    _patch_openpyxl_colors()
    # Lazy import after sys.path is set
    engine = importlib.import_module("engine")
    verificar = engine.verificar

    tmpdir = tempfile.mkdtemp(prefix="secom-verif-")
    try:
        # Save consolidado
        consol_name = body.get("consolidado_name", "consolidado.xlsx")
        consol_path = os.path.join(tmpdir, consol_name)
        with open(consol_path, "wb") as f:
            f.write(base64.b64decode(body["consolidado_b64"]))

        # Save comprovantes
        comp_paths = []
        for item in body.get("comp_files", []):
            p = os.path.join(tmpdir, item["name"])
            with open(p, "wb") as f:
                f.write(base64.b64decode(item["b64"]))
            comp_paths.append(p)

        # Save verification files
        verif_paths = []
        for item in body.get("verif_files", []):
            p = os.path.join(tmpdir, item["name"])
            with open(p, "wb") as f:
                f.write(base64.b64decode(item["b64"]))
            verif_paths.append(p)

        adserver = body["adserver"]
        data_ini = _parse_date(body.get("ini"))
        data_fim = _parse_date(body.get("fim"))
        consol_filename = os.path.basename(consol_name)
        consol_path_obj = Path(consol_filename)
        suffix = consol_path_obj.suffix or ".xlsx"
        output_filename = f"{consol_path_obj.stem}_verificado{suffix}"
        output_path = os.path.join(tmpdir, output_filename)

        result = verificar(
            consolidado_path=consol_path,
            adserver=adserver,
            comp_paths=comp_paths,
            verif_paths=verif_paths,
            data_ini=data_ini,
            data_fim=data_fim,
            output_path=output_path,
        )

        # Read verified xlsx and encode as base64
        out_file = result.get("output", output_path)
        output_b64 = None
        output_name = None
        try:
            with open(out_file, "rb") as f:
                output_b64 = base64.b64encode(f.read()).decode("ascii")
            output_name = os.path.basename(out_file)
        except OSError:
            pass

        return {
            "veiculos":         result.get("veiculos", []),
            "sem_comprovante":  result.get("sem_comprovante", []),
            "sem_consolidado":  result.get("sem_consolidado", []),
            "parse_errors":     result.get("parse_errors", []),
            "url_sample":       result.get("url_sample", []),
            "output_b64":       output_b64,
            "output_name":      output_name,
        }

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _write_url_info(body: dict) -> dict:
    write_url_info = importlib.import_module("write_url_info")

    tmpdir = tempfile.mkdtemp(prefix="secom-urlinfo-")
    try:
        out_path = os.path.join(tmpdir, body.get("output_name", "output.xlsx"))
        with open(out_path, "wb") as f:
            f.write(base64.b64decode(body["output_b64"]))

        write_url_info.write(out_path, body["url_info_by_veiculo"])

        with open(out_path, "rb") as f:
            updated_b64 = base64.b64encode(f.read()).decode("ascii")

        return {"output_b64": updated_b64, "output_name": body.get("output_name")}

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length > 0 else self.rfile.read()
            body = json.loads(raw)

            if "url_info_by_veiculo" in body and "output_b64" in body:
                result = _write_url_info(body)
            else:
                result = _run_engine(body)

            self._json(200, result)
        except Exception as e:
            import traceback
            self._json(500, {"error": str(e), "trace": traceback.format_exc()})

    def _json(self, status: int, data: dict):
        enc = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(enc)))
        self.end_headers()
        self.wfile.write(enc)

    def log_message(self, *_):
        pass
