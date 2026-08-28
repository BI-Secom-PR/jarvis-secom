"""
Parser DGBRASIL — comprovante de entrega + verification de URLs.

Comprovante:
  Um arquivo por veículo, layout CM360 lido por `parse_comprovante_cm360` em
  parser_utils.py (o TERATECH usa o mesmo layout, um veículo por aba).
  "Views" no consolidado corresponde a Video Completions (confirmado batendo
  Views/Impressões com a coluna VTR).

Verification:
  Header na linha 2 (linha 1 é um banner de texto livre inconsistente — não
  usar para totais). Duas schemas: 9 cols "Adserver/.../Impressoes" (display)
  e 6 cols minúsculas "agencia/.../impressions" (vídeo: Claro/Tim/Vivo Ads).
  Sem coluna de Data/Estado — filtros de data/praça viram no-op (igual SENSE).
"""

import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

from parser_utils import (
    col_index, to_int, cli_date, load_workbook_fast, parse_comprovante_cm360,
    UrlAggregator,
)


# ── parse_comprovante ────────────────────────────────────────────────────────

def parse_comprovante(
    filepath: str,
    data_ini: date | None = None,
    data_fim: date | None = None,
) -> list[dict]:
    """Parseia comprovante DGBRASIL — um veículo por arquivo, layout CM360."""
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {filepath}")

    wb = load_workbook_fast(str(path))
    result = parse_comprovante_cm360(wb.active, "dgbrasil_comprovante")
    wb.close()
    if result is None:
        raise ValueError(f"Layout de comprovante não reconhecido: {path.name}")
    return [result]


# ── parse_verif ──────────────────────────────────────────────────────────────

def parse_verif(
    filepath: str,
    data_ini: date | None = None,
    data_fim: date | None = None,
    praca: str | None = None,
) -> list[dict]:
    """Parseia verification DGBRASIL (header linha 2, schema 9-col ou 6-col)."""
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {filepath}")

    wb = load_workbook_fast(str(path))
    ws = wb.active

    header = [str(v).strip() if v is not None else "" for v in
              next(ws.iter_rows(min_row=2, max_row=2, values_only=True), [])]
    if not header:
        wb.close()
        raise ValueError(f"Header não encontrado na linha 2: {path.name}")

    i_veiculo    = col_index(header, "Veiculo", "veiculo", "Veículo")
    i_categoria  = col_index(header, "Categorizacao", "categoria", "Categoria")
    i_url        = col_index(header, "URL_Veiculada", "url", "URL")
    i_impressoes = col_index(header, "Impressoes", "impressions", "Impressões")
    is_cpv       = col_index(header, "impressions") is not None

    if i_veiculo is None or i_categoria is None or i_impressoes is None:
        wb.close()
        raise ValueError(
            f"Colunas obrigatórias ausentes (Veiculo/Categoria/Impressoes): {path.name}"
        )

    veiculos_indevidas: dict[str, dict] = defaultdict(dict)
    veiculos_entregue:  dict[str, int]  = defaultdict(int)
    url_agg = UrlAggregator()

    for row in ws.iter_rows(min_row=3, values_only=True):
        if all(v is None for v in row):
            continue

        veiculo   = str(row[i_veiculo]).strip()   if i_veiculo   < len(row) and row[i_veiculo]   else None
        categoria = str(row[i_categoria]).strip() if i_categoria < len(row) and row[i_categoria] else None
        url       = str(row[i_url]).strip()       if i_url is not None and i_url < len(row) and row[i_url] else None
        impressoes = to_int(row[i_impressoes] if i_impressoes < len(row) else None)

        if not veiculo or not categoria:
            continue

        veiculos_indevidas[veiculo][categoria] = (
            veiculos_indevidas[veiculo].get(categoria, 0) + impressoes
        )
        veiculos_entregue[veiculo] += impressoes

        if url:
            url_agg.add(veiculo, categoria, url, impressoes)

    wb.close()

    results: list[dict] = []
    for veiculo in veiculos_entregue:
        results.append({
            "veiculo":           veiculo,
            "tipo_compra":       "CPV" if is_cpv else "CPM",
            "contratado":        None,
            "entregue":          veiculos_entregue[veiculo],
            "cliques":           None,
            "viewables":         None,
            "viewability":       None,
            "indevidas":         dict(veiculos_indevidas[veiculo]),
            "url_sample":        url_agg.items() if not results else [],
            "formato_detectado": "dgbrasil_verif",
        })

    return results


# ── CLI ────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Parser DGBRASIL")
    ap.add_argument("modo", choices=["comp", "verif"])
    ap.add_argument("arquivo")
    ap.add_argument("--ini", default=None, metavar="DD/MM/YYYY")
    ap.add_argument("--fim", default=None, metavar="DD/MM/YYYY")
    args = ap.parse_args()

    fn = parse_comprovante if args.modo == "comp" else parse_verif
    try:
        res = fn(args.arquivo, data_ini=cli_date(args.ini), data_fim=cli_date(args.fim))
        for r in res:
            disp = {k: v for k, v in r.items() if k != "url_sample"}
            disp["url_sample_count"] = len(r.get("url_sample", []))
            print(json.dumps(disp, indent=2, ensure_ascii=False, default=str))
    except Exception as e:
        print(json.dumps({"erro": str(e)}, ensure_ascii=False))
        sys.exit(1)
