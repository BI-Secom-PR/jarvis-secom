"""
Parser DGBRASIL — comprovante de entrega + verification de URLs.

Comprovante:
  Um arquivo por veículo. Metadados nas linhas 1-6, header fixo na linha 8.
  A linha 9 já é o total agregado do veículo (coluna "Data" = "-"); as linhas
  10+ são o detalhamento diário — usamos a linha 9 direto em vez de somar.
  Duas variantes de coluna: display/CPM (14 cols) e vídeo/CPV (19 cols, com
  Video Plays/Quartis/Completions extras). "Views" no consolidado corresponde
  a Video Completions (confirmado batendo Views/Impressões com a coluna VTR).

Verification:
  Header na linha 2 (linha 1 é um banner de texto livre inconsistente — não
  usar para totais). Duas schemas: 9 cols "Adserver/.../Impressoes" (display)
  e 6 cols minúsculas "agencia/.../impressions" (vídeo: Claro/Tim/Vivo Ads).
  Sem coluna de Data/Estado — filtros de data/praça viram no-op (igual SENSE).
"""

import json
import random
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

from parser_utils import col_index, to_int, to_float, cli_date, load_workbook_fast


# ── parse_comprovante ────────────────────────────────────────────────────────

def parse_comprovante(
    filepath: str,
    data_ini: date | None = None,
    data_fim: date | None = None,
) -> list[dict]:
    """Parseia comprovante DGBRASIL (um veículo por arquivo, header fixo linha 8)."""
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {filepath}")

    wb = load_workbook_fast(str(path))
    ws = wb.active

    header = [str(v).strip() if v is not None else "" for v in
              next(ws.iter_rows(min_row=8, max_row=8, values_only=True), [])]
    if not header:
        wb.close()
        raise ValueError(f"Header não encontrado na linha 8: {path.name}")

    i_veiculo     = col_index(header, "Veiculo", "Veículo")
    i_data        = col_index(header, "Data")
    i_contratado  = col_index(header, "Contratado")
    i_impressoes  = col_index(header, "Impressoes", "Impressões")
    i_cliques     = col_index(header, "Cliques")
    i_viewable    = col_index(header, "Active View: Viewable Impressions")
    i_viewability = col_index(header, "Active View: % Viewable Impressions")
    i_completions = col_index(header, "Video Completions")

    if i_veiculo is None or i_impressoes is None or i_data is None:
        wb.close()
        raise ValueError(f"Colunas obrigatórias ausentes (Veiculo/Impressoes/Data): {path.name}")

    is_cpv = i_completions is not None

    for row in ws.iter_rows(min_row=9, values_only=True):
        if all(v is None for v in row):
            continue
        if i_data >= len(row) or str(row[i_data]).strip() != "-":
            continue  # não é a linha de totais

        veiculo = str(row[i_veiculo]).strip() if row[i_veiculo] else None
        if not veiculo:
            continue

        entregue = to_int(row[i_impressoes])
        contratado = to_int(row[i_contratado]) if i_contratado is not None else None
        cliques = to_int(row[i_cliques]) if i_cliques is not None else None
        viewables = to_int(row[i_viewable]) if i_viewable is not None else None
        va = to_float(row[i_viewability]) if i_viewability is not None else None
        viewability = round(va * 100, 2) if va is not None and va <= 1.0 else va
        views = to_int(row[i_completions]) if is_cpv else None

        wb.close()
        return [{
            "veiculo":           veiculo,
            "tipo_compra":       "CPV" if is_cpv else "CPM",
            "contratado":        contratado or None,
            "entregue":          entregue,
            "views":             views,
            "cliques":           cliques or None,
            "viewables":         viewables or None,
            "viewability":       viewability,
            "indevidas":         {},
            "url_sample":        [],
            "formato_detectado": "dgbrasil_comprovante",
        }]

    wb.close()
    return []


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
    MAX_POOL = 10000
    url_pool: list[dict] = []
    pool_count = 0

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
            pool_count += 1
            entry = {"url": url, "categoria": categoria, "veiculo": veiculo, "impressoes": impressoes}
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
            "tipo_compra":       "CPV" if is_cpv else "CPM",
            "contratado":        None,
            "entregue":          veiculos_entregue[veiculo],
            "cliques":           None,
            "viewables":         None,
            "viewability":       None,
            "indevidas":         dict(veiculos_indevidas[veiculo]),
            "url_sample":        url_pool if not results else [],
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
