"""
Parser METRIKE — comprovante de entrega + verification de URLs.

Comprovante:
  Sheet "Worksheet". Cabeçalho na linha ~12.
  Colunas: Veículo, Data, Campanha, ID, Placement ID, Formato, Dimensão,
           Segmentação, Descrição, Linha criativa, Contratado, Impressões,
           Cliques, Viewable, VA%, Tipo de compra.
  Linhas "#TOTAL POR CAMPANHA" → extrair Contratado e VA%.

Verification:
  Sheet única (índice 0). Cabeçalho na linha ~5.
  Colunas: Data, Veículo, Impressões, Placement, Zone, Formato, Categoria, Url.
"""

import json
import random
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import openpyxl

from category_map import INDEVIDAS_ZERO, normaliza_categoria
from parser_utils import col_index, parse_date, to_int, cli_date


# ── Helpers ─────────────────────────────────────────────────────────────────────

def _find_header(ws):
    veiculo_variants  = {"veículo", "veiculo", "vehicle"}
    entregue_variants = {"impressões", "impressoes", "impressions",
                         "entregues", "entregue"}
    for i, row in enumerate(ws.iter_rows(max_row=25, values_only=True), start=1):
        vals = [str(v).strip() if v is not None else "" for v in row]
        lows = {v.lower() for v in vals}
        if lows & veiculo_variants and lows & entregue_variants:
            return i, vals
    return None, []


_VEICULO_VARIANTS = {"veículo", "veiculo", "vehicle", "veículos", "veiculos"}

def _find_verif_header(ws):
    """Detecta linha de cabeçalho do arquivo de verification.
    Requer 'categoria' + algum variant de 'veículo'. URL é opcional.
    """
    for i, row in enumerate(ws.iter_rows(max_row=25, values_only=True), start=1):
        vals = [str(v).strip() if v is not None else "" for v in row]
        lows = {v.lower() for v in vals}
        if "categoria" in lows and lows & _VEICULO_VARIANTS:
            return i, vals
    return None, []


# ── parse_comprovante ────────────────────────────────────────────────────────────

def parse_comprovante(
    filepath: str,
    data_ini: date | None = None,
    data_fim: date | None = None,
) -> list[dict]:
    """Parseia comprovante METRIKE (Worksheet, #TOTAL POR CAMPANHA)."""
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {filepath}")

    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    ws = wb.worksheets[0]

    header_row_idx, header = _find_header(ws)
    if header_row_idx is None:
        wb.close()
        raise ValueError(
            f"Cabeçalho com 'Veículo' e 'Impressões' não encontrado: {path.name}"
        )

    i_veiculo    = col_index(header, "Veículo", "Veiculo", "Vehicle")
    i_impressoes = col_index(header, "Impressões", "Impressoes", "Impressions",
                              "Entregues", "Entregue")
    i_cliques    = col_index(header, "Cliques", "Clicks")
    i_viewable   = col_index(header, "Viewable", "Viewables")
    i_contratado = col_index(header, "Contratado", "Contracted")
    i_data       = col_index(header, "Data", "Date")

    if i_veiculo is None or i_impressoes is None:
        wb.close()
        raise ValueError(f"Colunas obrigatórias ausentes: {path.name}")

    entregue:   dict[str, int]   = defaultdict(int)
    cliques:    dict[str, int]   = defaultdict(int)
    viewables:  dict[str, int]   = defaultdict(int)
    contratado: dict[str, int]   = {}
    last_vehicle: str | None     = None

    for row in ws.iter_rows(min_row=header_row_idx + 1, values_only=True):
        if all(v is None for v in row):
            continue

        veiculo_raw = row[i_veiculo] if i_veiculo < len(row) else None
        if veiculo_raw is None:
            continue
        vname = str(veiculo_raw).strip()
        if not vname:
            continue

        # Linha #TOTAL → apenas contratado (viewability calculado de viewables/entregue)
        if "#TOTAL" in vname.upper():
            if last_vehicle is not None:
                if i_contratado is not None and i_contratado < len(row):
                    c = to_int(row[i_contratado])
                    if c > 0:
                        contratado[last_vehicle] = c
            continue

        if (data_ini or data_fim) and i_data is not None and i_data < len(row):
            d = parse_date(row[i_data])
            if d:
                if data_ini and d < data_ini:
                    continue
                if data_fim and d > data_fim:
                    continue

        imp = to_int(row[i_impressoes] if i_impressoes < len(row) else None)
        if imp == 0:
            continue

        entregue[vname] += imp
        if i_cliques is not None and i_cliques < len(row):
            cliques[vname] += to_int(row[i_cliques])
        if i_viewable is not None and i_viewable < len(row):
            viewables[vname] += to_int(row[i_viewable])

        last_vehicle = vname

    wb.close()

    if not entregue:
        return []

    # Viewability = soma(viewables) / soma(impressões) * 100
    viewability: dict[str, float] = {}
    for vname in entregue:
        if viewables[vname] > 0 and entregue[vname] > 0:
            viewability[vname] = round(viewables[vname] / entregue[vname] * 100, 2)

    return [
        {
            "veiculo":           vname,
            "tipo_compra":       None,
            "contratado":        contratado.get(vname),
            "entregue":          imp,
            "cliques":           cliques[vname] or None,
            "viewables":         viewables[vname] or None,
            "viewability":       viewability.get(vname),
            "indevidas":         {},
            "url_sample":        [],
            "formato_detectado": "metrike_comprovante",
        }
        for vname, imp in entregue.items()
    ]


# ── parse_verif ──────────────────────────────────────────────────────────────────

def parse_verif(
    filepath: str,
    data_ini: date | None = None,
    data_fim: date | None = None,
) -> list[dict]:
    """Parseia verification METRIKE (Data, Veículo, Categoria, Url)."""
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {filepath}")

    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    ws = wb.worksheets[0]

    header_row_idx, header = _find_verif_header(ws)
    if header_row_idx is None:
        wb.close()
        raise ValueError(
            f"Header com 'Categoria' e 'Veículo' não encontrado nas primeiras 25 linhas: {path.name}"
        )

    i_veiculo    = col_index(header, "Veículo", "Veiculo", "Vehicle",
                              "Veículos", "Veiculos")
    i_impressoes = col_index(header, "Impressões", "Impressoes", "Impressions")
    i_categoria  = col_index(header, "Categoria", "Category")
    i_url        = col_index(header, "Url", "URL", "url")
    i_data       = col_index(header, "Data", "Date")

    if i_veiculo is None or i_impressoes is None or i_categoria is None:
        wb.close()
        raise ValueError(
            f"Colunas obrigatórias ausentes (Veículo/Impressões/Categoria): {path.name}"
        )

    veiculos_indevidas: dict[str, dict] = defaultdict(lambda: dict(INDEVIDAS_ZERO))
    veiculos_entregue:  dict[str, int]  = defaultdict(int)
    MAX_POOL = 500
    url_pool: list[dict] = []
    pool_count = 0

    for row in ws.iter_rows(min_row=header_row_idx + 1, values_only=True):
        if all(v is None for v in row):
            continue
        if (data_ini or data_fim) and i_data is not None and i_data < len(row):
            d = parse_date(row[i_data])
            if d:
                if data_ini and d < data_ini:
                    continue
                if data_fim and d > data_fim:
                    continue

        veiculo   = str(row[i_veiculo]).strip()   if i_veiculo   < len(row) and row[i_veiculo]   else None
        categoria = str(row[i_categoria]).strip()  if i_categoria < len(row) and row[i_categoria] else None
        url       = str(row[i_url]).strip()        if i_url is not None and i_url < len(row) and row[i_url] else None
        impressoes = to_int(row[i_impressoes] if i_impressoes < len(row) else None)

        if not veiculo or not categoria:
            continue

        cat_key = normaliza_categoria(categoria)
        if cat_key:
            veiculos_indevidas[veiculo][cat_key] = (
                veiculos_indevidas[veiculo].get(cat_key, 0) + impressoes
            )

        veiculos_entregue[veiculo] += impressoes

        if url and cat_key:
            pool_count += 1
            entry = {"url": url, "categoria": categoria, "veiculo": veiculo}
            if len(url_pool) < MAX_POOL:
                url_pool.append(entry)
            else:
                idx = random.randint(0, pool_count - 1)
                if idx < MAX_POOL:
                    url_pool[idx] = entry

    wb.close()

    results: list[dict] = []
    for veiculo in veiculos_entregue:
        results.append({
            "veiculo":           veiculo,
            "tipo_compra":       None,
            "contratado":        None,
            "entregue":          veiculos_entregue[veiculo],
            "cliques":           None,
            "viewables":         None,
            "viewability":       None,
            "indevidas":         dict(veiculos_indevidas[veiculo]),
            "url_sample":        url_pool if not results else [],
            "formato_detectado": "metrike_verif",
        })

    return results


# ── CLI ──────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Parser METRIKE")
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
