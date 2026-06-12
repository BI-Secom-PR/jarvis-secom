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
import urllib.request
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
    """Patch openpyxl's strict string/color validators to silently drop invalid values.

    openpyxl ≤3.0.x: validator is MatchedString in openpyxl.descriptors
    openpyxl ≥3.1.x: validator is MatchPattern in openpyxl.descriptors.base
    Both raise ValueError for non-conforming cell attributes (e.g. bad color codes).
    """
    def _make_lenient(cls):
        orig = cls.__set__
        def _lenient(self, instance, value):
            try:
                orig(self, instance, value)
            except (ValueError, TypeError):
                pass
        cls.__set__ = _lenient

    # openpyxl 3.1+
    try:
        from openpyxl.descriptors.base import MatchPattern
        _make_lenient(MatchPattern)
    except Exception:
        pass

    # openpyxl 3.0 and older
    try:
        from openpyxl.descriptors import MatchedString  # type: ignore[attr-defined]
        _make_lenient(MatchedString)
    except Exception:
        pass


def _download_url(url: str, dest: str, token: str | None = None) -> None:
    """Download a file from a URL (e.g. Vercel Blob) to a local path.
    If token is provided, sends it as a Bearer Authorization header."""
    if token:
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req) as resp, open(dest, "wb") as f:
            shutil.copyfileobj(resp, f)
    else:
        with urllib.request.urlopen(url) as resp, open(dest, "wb") as f:
            shutil.copyfileobj(resp, f)


def _run_engine(body: dict) -> dict:
    _patch_openpyxl_colors()
    # Lazy import after sys.path is set
    engine = importlib.import_module("engine")
    verificar = engine.verificar

    blob_token = body.get("blob_token")
    tmpdir = tempfile.mkdtemp(prefix="secom-verif-")
    try:
        # Save consolidado — supports both blob URL and legacy base64
        consol_name = body.get("consolidado_name", "consolidado.xlsx")
        consol_path = os.path.join(tmpdir, consol_name)
        if "consolidado_url" in body:
            _download_url(body["consolidado_url"], consol_path, blob_token)
        else:
            with open(consol_path, "wb") as f:
                f.write(base64.b64decode(body["consolidado_b64"]))

        # Save comprovantes — supports blob URLs (comp_urls) or legacy base64 (comp_files)
        comp_paths = []
        if "comp_urls" in body:
            for url in body["comp_urls"]:
                name = url.split("?")[0].rsplit("/", 1)[-1]
                p = os.path.join(tmpdir, name)
                _download_url(url, p, blob_token)
                comp_paths.append(p)
        else:
            for item in body.get("comp_files", []):
                p = os.path.join(tmpdir, item["name"])
                with open(p, "wb") as f:
                    f.write(base64.b64decode(item["b64"]))
                comp_paths.append(p)

        # Save verification files — supports blob URLs (verif_urls) or legacy base64 (verif_files)
        verif_paths = []
        if "verif_urls" in body:
            for url in body["verif_urls"]:
                name = url.split("?")[0].rsplit("/", 1)[-1]
                p = os.path.join(tmpdir, name)
                _download_url(url, p, blob_token)
                verif_paths.append(p)
        else:
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

        # Parse view rules if provided as a JSON string
        view_rules = body.get("view_rules")
        if isinstance(view_rules, str) and view_rules:
            try:
                view_rules = json.loads(view_rules)
            except Exception:
                view_rules = None

        result = verificar(
            consolidado_path=consol_path,
            adserver=adserver,
            comp_paths=comp_paths,
            verif_paths=verif_paths,
            data_ini=data_ini,
            data_fim=data_fim,
            output_path=output_path,
            url_sample_pct=body.get("url_sample_pct", 10),
            view_rules=view_rules,
            praca=body.get("praca") or None,
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
            try:
                import openpyxl as _ox
                _ver = _ox.__version__
            except Exception:
                _ver = "unknown"
            self._json(500, {
                "error": str(e),
                "trace": traceback.format_exc(),
                "openpyxl_version": _ver,
                "python_version": sys.version,
            })

    def _json(self, status: int, data: dict):
        enc = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(enc)))
        self.end_headers()
        self.wfile.write(enc)

    def log_message(self, *_):
        pass
