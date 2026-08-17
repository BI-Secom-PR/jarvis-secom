"""
Parser 00px — comprovante de entrega + verification de URLs.

Comprovante:
  Workbook com sheets "CPM - Contabilizações", "CPC - Contabilizações",
  "CPV - Contabilizações". Cada sheet tem metadados nas primeiras linhas
  seguidos de uma tabela com cabeçalho detectado automaticamente.
  Viewability: coluna "VA (IAB)" (pode ser %, ex.: "72%", ou decimal 0.72).

Verification:
  Sheet "Verification" (ou wb.active). Colunas: Veículo, Categoria, URL.
  Indevidas mapeadas via category_map.
"""

import json
import random
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path


from parser_utils import col_index, parse_date, to_float, to_int, cli_date, vehicle_from_filename, load_workbook_fast

# ── Helpers ─────────────────────────────────────────────────────────────────────

def _normalize_va(v) -> float | None:
    """Converte VA decimal (0.72) → percentagem (72.0); mantém se já > 1."""
    f = to_float(v)
    if f is None:
        return None
    return round(f * 100, 2) if f <= 1.0 else round(f, 2)


def _find_header(ws, veiculo_required: bool = True):
    """
    Varre até 25 linhas buscando cabeçalho.
    Se veiculo_required=True, exige col com 'Veículo'/'Vehicle'.
    Sempre exige col com 'Impressões'/'Impressions'/'Entregues'/'Views'.
    Retorna (row_idx_1based, header_list) ou (None, []).
    """
    veiculo_variants  = {"veículo", "veiculo", "vehicle"}
    entregue_variants = {"impressões", "impressoes", "impressions",
                         "entregues", "entregue", "views"}
    for i, row in enumerate(ws.iter_rows(max_row=25, values_only=True), start=1):
        vals = [str(v).strip() if v is not None else "" for v in row]
        lows = {v.lower() for v in vals}
        has_entregue = bool(lows & entregue_variants)
        has_veiculo  = bool(lows & veiculo_variants)
        if has_entregue and (has_veiculo or not veiculo_required):
            return i, vals
    return None, []


def _get_comp_sheets(wb):
    """Retorna sheets de Contabilizações (CPM/CPC/CPV). Fallback: primeira sheet."""
    targeted = [
        ws for ws in wb.worksheets
        if "contabiliza" in ws.title.lower()
    ]
    return targeted or [wb.worksheets[0]]


TIPOS_COMPRA = ("CPCV", "CPM", "CPC", "CPV")


def _tipo_from_sheet(title: str) -> str | None:
    """'CPV - Contabilizações' → 'CPV'. O consolidado 00px é separado por objetivo
    de mídia, então cada aba do comprovante vira uma linha própria."""
    up = title.upper()
    return next((t for t in TIPOS_COMPRA if up.startswith(t)), None)


SKIP_VEHICLE_NAMES = {"---", "grand total:", "grand total", "total"}


# ── parse_comprovante ────────────────────────────────────────────────────────────

def parse_comprovante(
    filepath: str,
    data_ini: date | None = None,
    data_fim: date | None = None,
) -> list[dict]:
    """Parseia comprovante 00px (multi-sheet CPM/CPC/CPV)."""
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {filepath}")

    wb = load_workbook_fast(str(path))
    sheets = _get_comp_sheets(wb)

    # Chave = (tipo_compra, veículo normalizado) — uma linha por objetivo de mídia.
    entregue:    dict[tuple, int]   = defaultdict(int)
    cliques:     dict[tuple, int]   = defaultdict(int)
    viewables:   dict[tuple, int]   = defaultdict(int)
    contratado:  dict[tuple, int]   = {}
    viewability: dict[tuple, float] = {}
    va_wsum:     dict[tuple, float] = defaultdict(float)
    va_weight:   dict[tuple, int]   = defaultdict(int)
    display:     dict[tuple, str]   = {}
    found_header  = False
    fallback_vehicle = vehicle_from_filename(filepath)

    for ws in sheets:
        header_row_idx, header = _find_header(ws)
        if header_row_idx is None:
            continue
        found_header = True
        tipo = _tipo_from_sheet(ws.title)

        i_veiculo    = col_index(header, "Veículo", "Veiculo", "Vehicle")
        i_impressoes = col_index(header, "Impressões", "Impressoes", "Impressions",
                                  "Entregues", "Entregue", "Views")
        i_cliques    = col_index(header, "Cliques", "Clicks")
        i_viewable   = col_index(header, "Viewable", "Viewables")
        i_viewability= col_index(header, "VA%", "VA (IAB)", "Viewability", "VA %",
                                  "View%", "Viewability (IAB)")
        i_contratado = col_index(header, "Contratado", "Contracted")
        i_data       = col_index(header, "Data", "Date")

        if i_impressoes is None:
            continue

        for row in ws.iter_rows(min_row=header_row_idx + 1, values_only=True):
            if all(v is None for v in row):
                continue

            veiculo_raw = row[i_veiculo] if i_veiculo is not None and i_veiculo < len(row) else None
            vname = str(veiculo_raw).strip() if veiculo_raw is not None else ""
            if not vname:
                vname = fallback_vehicle
            if vname.lower() in SKIP_VEHICLE_NAMES:
                continue
            if vname.endswith(" Total") or vname.endswith(" total"):
                continue

            key = (tipo, vname.casefold())
            raw_date = row[i_data] if i_data is not None and i_data < len(row) else None

            # Linhas de subtotal: o marcador "#TOTAL POR VEÍCULO"/"#TOTAL POR CANAL"
            # fica na coluna Data (o nome do veículo vem normal na coluna Veículo).
            marker = f"{vname} {raw_date or ''}".upper()
            if "#TOTAL" in marker:
                if "VEÍCULO" in marker or "VEICULO" in marker:
                    display.setdefault(key, vname)
                    if i_contratado is not None and i_contratado < len(row):
                        c = to_int(row[i_contratado])
                        if c > 0:
                            contratado[key] = c
                    if i_viewability is not None and i_viewability < len(row):
                        va = _normalize_va(row[i_viewability])
                        if va is not None:
                            viewability[key] = va
                continue  # nunca soma subtotal — evita double-count

            # Filtro de data
            if raw_date is not None:
                d = parse_date(raw_date)
                if d is None:
                    continue  # lixo na coluna de data → linha não confiável
                if data_ini and d < data_ini:
                    continue
                if data_fim and d > data_fim:
                    continue

            imp = to_int(row[i_impressoes] if i_impressoes < len(row) else None)
            if imp == 0:
                continue

            display.setdefault(key, vname)
            entregue[key] += imp
            if i_cliques is not None and i_cliques < len(row):
                cliques[key] += to_int(row[i_cliques])
            if i_viewable is not None and i_viewable < len(row):
                viewables[key] += to_int(row[i_viewable])
            if i_viewability is not None and i_viewability < len(row):
                va = _normalize_va(row[i_viewability])
                if va is not None and imp > 0:
                    va_wsum[key]   += va * imp
                    va_weight[key] += imp

    wb.close()

    if not found_header:
        raise ValueError(
            f"Cabeçalho com 'Veículo' e 'Impressões' não encontrado em nenhuma sheet: {path.name}"
        )
    if not entregue:
        return []

    # Viewability: viewables/entregue é o mesmo cálculo do consolidado (VA / Impressões).
    # A coluna "VA (IAB)" do comprovante vem arredondada (90%) e daria DIV falso —
    # só serve de fallback, junto com a média ponderada das linhas de detalhe.
    for key, imp in entregue.items():
        if viewables[key] > 0 and imp > 0:
            viewability[key] = round(viewables[key] / imp * 100, 2)
        elif key not in viewability and va_weight[key] > 0:
            viewability[key] = round(va_wsum[key] / va_weight[key], 2)

    return [
        {
            "veiculo":           display.get(key, key[1]),
            "tipo_compra":       key[0],
            "contratado":        contratado.get(key),
            "entregue":          imp,
            # No CPV a entrega contratada são views — o consolidado tem coluna própria.
            "views":             imp if key[0] in ("CPV", "CPCV") else None,
            "cliques":           cliques[key] or None,
            "viewables":         viewables[key] or None,
            "viewability":       viewability.get(key),
            "indevidas":         {},
            "url_sample":        [],
            "formato_detectado": "00px_comprovante",
        }
        for key, imp in entregue.items()
    ]


# ── parse_verif ──────────────────────────────────────────────────────────────────

def parse_verif(
    filepath: str,
    data_ini: date | None = None,
    data_fim: date | None = None,
    praca: str | None = None,
) -> list[dict]:
    """Parseia arquivo de verification 00px (URL + categoria por linha)."""
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {filepath}")

    wb = load_workbook_fast(str(path))
    ws = wb.active

    # Detectar header: exige 'categoria' + alguma col com 'url'
    header_row_idx, header = None, []
    for i, row in enumerate(ws.iter_rows(max_row=25, values_only=True), start=1):
        vals = [str(v).strip() if v is not None else "" for v in row]
        lows = {v.lower() for v in vals}
        if "categoria" in lows and lows & {"veículo", "veiculo", "vehicle", "veículos", "veiculos"}:
            header_row_idx, header = i, vals
            break

    if header_row_idx is None:
        wb.close()
        raise ValueError(
            f"Header com 'Categoria' e 'URL' não encontrado nas primeiras 25 linhas: {path.name}"
        )

    i_veiculo    = col_index(header, "Veículo", "Veiculo", "Vehicle",
                              "Veículos", "Veiculos")
    # 00px escreve "Impressões Válidas"/"Views Válidas" (com e sem acento em Válidas);
    # "Entregues" aparece 3x no header (CPM/CPC/CPV) — não serve de fallback.
    i_impressoes = col_index(header, "Impressões", "Impressoes", "Impressions",
                              "Impressões Válidas", "Impressões Validas",
                              "Impressoes Validas", "Impressões Totais", "Impressoes Totais")
    # CPV rows store delivery count in "Views" — CPM rows leave it blank (and vice-versa)
    i_views      = col_index(header, "Views", "Visualizações", "Visualizacoes",
                              "Views Válidas", "Views Validas")
    i_categoria  = col_index(header, "Categoria", "Category")
    i_url        = col_index(header, "Url", "URL", "url", "URL Veiculada",
                              "Url Veiculada")
    i_data       = col_index(header, "Data", "Date")
    i_estado     = col_index(header, "Estado", "State", "UF")

    if i_veiculo is None or (i_impressoes is None and i_views is None) or i_categoria is None:
        wb.close()
        raise ValueError(
            f"Colunas obrigatórias ausentes (Veículo/Impressões ou Views/Categoria): {path.name}"
        )

    # Chave = (veículo, tipo_compra): o mesmo arquivo traz linhas CPM (Impressões
    # Válidas) e CPV (Views Válidas), e o consolidado é separado por objetivo.
    veiculos_indevidas:         dict[tuple, dict] = defaultdict(dict)
    veiculos_indevidas_sem_url: dict[tuple, dict] = defaultdict(dict)
    veiculos_entregue:  dict[tuple, int]  = defaultdict(int)
    veiculos_total:     dict[tuple, int]  = defaultdict(int)

    MAX_POOL = 10000
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
        # CPM rows fill Impressões; CPV rows fill Views — cada uma vira sua própria
        # linha de resultado (um veículo pode ter as duas no mesmo arquivo).
        por_tipo = [
            (tipo, to_int(row[i] if i is not None and i < len(row) else None))
            for tipo, i in (("CPM", i_impressoes), ("CPV", i_views))
        ]
        por_tipo = [(t, n) for t, n in por_tipo if n]
        impressoes = sum(n for _, n in por_tipo)

        if not veiculo or not categoria or not por_tipo:
            continue

        fora_da_praca = False
        if praca and i_estado is not None and i_estado < len(row):
            estado_row = str(row[i_estado]).strip().upper() if row[i_estado] else ""
            fora_da_praca = bool(estado_row) and estado_row != praca.upper().strip()

        cat_str = categoria.strip()
        for tipo, n in por_tipo:
            key = (veiculo, tipo)
            if fora_da_praca:
                # Mesmo filtrando a linha, somamos ao total geral do veículo para o DIF
                veiculos_total[key] += n
                continue
            veiculos_indevidas[key][cat_str] = veiculos_indevidas[key].get(cat_str, 0) + n
            if not url:
                veiculos_indevidas_sem_url[key][cat_str] = (
                    veiculos_indevidas_sem_url[key].get(cat_str, 0) + n
                )
            veiculos_entregue[key] += n
            veiculos_total[key] += n

        if fora_da_praca:
            continue

        if url and cat_str:
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
    for (veiculo, tipo) in veiculos_entregue:
        key = (veiculo, tipo)
        results.append({
            "veiculo":           veiculo,
            "tipo_compra":       tipo,
            "contratado":        None,
            "entregue":          veiculos_entregue[key],
            "entregue_total":    veiculos_total[key],
            "cliques":           None,
            "viewables":         None,
            "viewability":       None,
            "indevidas":         dict(veiculos_indevidas[key]),
            "indevidas_sem_url": dict(veiculos_indevidas_sem_url[key]),
            "url_sample":        url_pool if not results else [],
            "formato_detectado": "00px_verif",
        })

    return results


# ── CLI ──────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Parser 00px")
    ap.add_argument("modo", choices=["comp", "verif"],
                    help="'comp' = comprovante, 'verif' = verification URL")
    ap.add_argument("arquivo", help="Arquivo .xlsx")
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
