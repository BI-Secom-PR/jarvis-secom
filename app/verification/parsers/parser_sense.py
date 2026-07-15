"""
Parser SENSE — comprovante de entrega + verification de URLs.

Detecta formato por conteúdo de header/sheet (não por campanha/filename).

Comprovante — shapes:
  C1 diário 1-veículo (Always_on): sheet "*Contabilizações", header com Data +
    Impressões/Válidas; meta Veículo: nas linhas 1–8; soma linhas diárias.
  C2 multi CPM: sheet "TOTAL POR VEÍCULO E PLACEMENT", header Veículo+Impressões
    sem Data; linhas-pai de veículo (placement children ignorados).
  C3 multi CPV: mesmo multi, métrica Views (+ Play/25%/50%/75%/100%).
  C4 diário CPV (previsto): diário com Views em vez de Impressões.

Verification — shapes:
  V1 curto (Always_on): TAG + Impressões válidas/indevidas + Total de impressões.
  V2 largo (Junho CPM): ID Criativo/Placement + mesmas métricas de impressões.
  V3 CPV: Visualizações válidas/indevidas + Total de visualizações.

Filtros data/praça: só se as colunas existirem (SENSE verif atual não tem).
"""

import json
import random
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import fastxlsx

from parser_utils import col_index, parse_date, to_float, to_int, cli_date, vehicle_from_filename


# ── Helpers ─────────────────────────────────────────────────────────────────────

def _clean_header(row) -> list[str]:
    """Normaliza células de cabeçalho: só a 1ª linha do texto (totais vêm após '\\n')."""
    return [str(v).split("\n")[0].strip() if v is not None else "" for v in row]


def _veiculo_meta(ws) -> str | None:
    """Lê 'Veículo: <nome>' do bloco de metadados (col B, linhas 1-8)."""
    for row in ws.iter_rows(max_row=8, values_only=True):
        for v in row:
            s = str(v).strip() if v else ""
            if s.lower().startswith(("veículo:", "veiculo:")):
                nome = s.split(":", 1)[1].strip()
                if nome:
                    return nome
    return None


def _meta_kv(ws, *keys: str, max_row: int = 10) -> str | None:
    """Lê 'Key: value' do bloco de metadados (qualquer coluna, primeiras linhas)."""
    keys_l = {k.lower() for k in keys}
    for row in ws.iter_rows(max_row=max_row, values_only=True):
        for v in row:
            s = str(v).strip() if v else ""
            if ":" not in s:
                continue
            k, val = s.split(":", 1)
            if k.strip().lower() in keys_l:
                val = val.strip()
                if val:
                    return val
    return None


def _find_header(ws, *required: str):
    """Localiza a linha de cabeçalho que contém todos os nomes em `required`."""
    req = {r.lower() for r in required}
    for i, row in enumerate(ws.iter_rows(max_row=25, values_only=True), start=1):
        vals = _clean_header(row)
        lows = {v.lower() for v in vals}
        if req <= lows:
            return i, vals
    return None, []


def _find_header_any(ws, required_groups: list[set[str]]):
    """Header que contém pelo menos um nome de cada grupo (OR dentro do grupo)."""
    for i, row in enumerate(ws.iter_rows(max_row=25, values_only=True), start=1):
        vals = _clean_header(row)
        lows = {v.lower() for v in vals if v}
        if all(any(opt in lows for opt in group) for group in required_groups):
            return i, vals
    return None, []


def _tipo_from_context(ws, filepath: str, sheet_title: str = "") -> str | None:
    """Infere CPM/CPV/… de meta, células DADOS GERAIS, título da sheet ou filename."""
    modelo = _meta_kv(ws, "Modelo de Compra", "Modelo de compra")
    if modelo:
        return modelo.strip().upper()

    for row in ws.iter_rows(max_row=12, max_col=12, values_only=True):
        for v in row:
            if v is None:
                continue
            s = str(v).strip().upper()
            if s in ("CPM", "CPV", "CPC", "CPCV", "CPA"):
                return s

    if "-" in sheet_title:
        prefix = sheet_title.split("-")[0].strip().upper()
        if prefix in ("CPM", "CPV", "CPC", "CPCV", "CPA"):
            return prefix

    name = Path(filepath).stem.upper()
    for t in ("CPCV", "CPM", "CPV", "CPC", "CPA"):
        if re.search(rf"(?:^|[_\s-]){t}(?:$|[_\s-])", name):
            return t
    return None


def _viewability_pct(raw, viewables: int, entregue: int) -> float | None:
    """VA(IAB) 0–1 → %; Viewability já em %; senão viewables/entregue."""
    f = to_float(raw)
    if f is not None:
        if 0 < f <= 1:
            return round(f * 100, 2)
        if f > 1:
            return round(f, 2)
    if viewables > 0 and entregue > 0:
        return round(viewables / entregue * 100, 2)
    return None


def _comp_result(
    *,
    veiculo: str,
    tipo_compra: str | None,
    contratado: int,
    entregue: int,
    cliques: int,
    viewables: int,
    views: int | None = None,
    views_start: int | None = None,
    views_50: int | None = None,
    views_100: int | None = None,
    viewability: float | None = None,
    formato: str,
) -> dict:
    return {
        "veiculo":           veiculo,
        "tipo_compra":       tipo_compra,
        "contratado":        contratado or None,
        "entregue":          entregue,
        "cliques":           cliques or None,
        "viewables":         viewables or None,
        "viewability":       viewability,
        "views":             views or None,
        "views_start":       views_start or None,
        "views_50":          views_50 or None,
        "views_100":         views_100 or None,
        "indevidas":         {},
        "url_sample":        [],
        "formato_detectado": formato,
    }


# ── parse_comprovante ────────────────────────────────────────────────────────────

def parse_comprovante(
    filepath: str,
    data_ini: date | None = None,
    data_fim: date | None = None,
) -> list[dict]:
    """Parseia comprovante SENSE (diário 1-veículo ou multi-veículo por placement)."""
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {filepath}")

    wb = fastxlsx.load_workbook(path)
    try:
        # Prefer Contabilizações (C1/C4); else multi TOTAL/PLACEMENT; else first sheet
        daily_sheets = [ws for ws in wb.worksheets if "contabiliza" in ws.title.lower()]
        multi_sheets = [
            ws for ws in wb.worksheets
            if any(k in ws.title.lower() for k in ("placement", "veículo", "veiculo", "total por"))
        ]
        probe_order = daily_sheets or multi_sheets or list(wb.worksheets)
        if not probe_order:
            raise ValueError(f"Workbook sem sheets: {path.name}")

        shape: str | None = None
        for ws in probe_order:
            hdr_i, _header = _find_header_any(ws, [
                {"data"},
                {"impressões", "impressoes", "válidas", "validas", "views"},
            ])
            if hdr_i is not None:
                shape = "daily"
                break

        if shape is None:
            for ws in (multi_sheets or list(wb.worksheets)):
                hdr_i, header = _find_header_any(ws, [
                    {"veículo", "veiculo"},
                    {"impressões", "impressoes", "válidas", "validas", "views"},
                ])
                if hdr_i is not None and "data" not in {h.lower() for h in header}:
                    shape = "multi"
                    break

        if shape is None:
            titles = [ws.title for ws in wb.worksheets]
            raise ValueError(
                f"Formato de comprovante SENSE não reconhecido: {path.name}. "
                f"Sheets: {titles}"
            )
    finally:
        wb.close()

    if shape == "daily":
        return _parse_comprovante_daily(filepath, data_ini, data_fim)
    return _parse_comprovante_multi(filepath, data_ini, data_fim)


def _parse_comprovante_daily(
    filepath: str,
    data_ini: date | None,
    data_fim: date | None,
) -> list[dict]:
    """C1/C4: sheet Contabilizações, linhas diárias, 1 veículo por arquivo."""
    path = Path(filepath)
    wb = fastxlsx.load_workbook(path)

    sheets = [ws for ws in wb.worksheets if "contabiliza" in ws.title.lower()]
    if not sheets:
        sheets = [wb.worksheets[0]]

    veiculo_nome = _veiculo_meta(sheets[0]) or vehicle_from_filename(filepath)
    tipo_compra = _tipo_from_context(sheets[0], filepath, sheets[0].title)

    contratado = 0
    entregue = 0
    cliques = 0
    viewables = 0
    views = 0
    views_start = 0
    views_50 = 0
    views_100 = 0
    va_raw_last = None
    has_views_col = False

    for ws in sheets:
        if tipo_compra is None:
            tipo_compra = _tipo_from_context(ws, filepath, ws.title)

        header_row_idx, header = _find_header_any(ws, [
            {"data"},
            {"impressões", "impressoes", "válidas", "validas", "views"},
        ])
        if header_row_idx is None:
            wb.close()
            raise ValueError(
                f"Cabeçalho diário (Data + métrica) não encontrado: {path.name} ({ws.title})"
            )

        i_data       = col_index(header, "Data")
        i_contratado = col_index(header, "Qtd Contratada", "Contratado")
        i_validas    = col_index(header, "Válidas", "Validas")
        i_impressoes = col_index(header, "Impressões", "Impressoes")
        i_views      = col_index(header, "Views", "Visualizações", "Visualizacoes")
        i_viewables  = col_index(header, "Viewables", "Viewable")
        i_cliques    = col_index(header, "Cliques", "Clicks")
        i_va         = col_index(header, "Viewability", "VA(IAB)", "VA")
        i_play       = col_index(header, "Play", "0%", "Views Start", "Views 0%")
        i_v50        = col_index(header, "50%", "Views 50%")
        i_v100       = col_index(header, "100%", "Views 100%")

        i_entregue = i_validas if i_validas is not None else (
            i_impressoes if i_impressoes is not None else i_views
        )
        if i_entregue is None:
            wb.close()
            raise ValueError(f"Coluna obrigatória ausente (Válidas/Impressões/Views): {path.name}")

        if i_views is not None:
            has_views_col = True

        for row in ws.iter_rows(min_row=header_row_idx + 1, values_only=True):
            row = list(row)
            if all(v is None for v in row):
                continue
            data_raw = row[i_data] if i_data is not None and i_data < len(row) else None
            data_str = str(data_raw).strip() if data_raw is not None else ""
            if data_str.lower() == "total":
                continue
            d = parse_date(data_raw)
            if d is None:
                continue
            if data_ini and d < data_ini:
                continue
            if data_fim and d > data_fim:
                continue

            if i_contratado is not None and i_contratado < len(row) and row[i_contratado] is not None:
                contratado += to_int(row[i_contratado])
            entregue += to_int(row[i_entregue] if i_entregue < len(row) else None)
            if i_viewables is not None and i_viewables < len(row):
                viewables += to_int(row[i_viewables])
            if i_cliques is not None and i_cliques < len(row):
                cliques += to_int(row[i_cliques])
            if i_views is not None and i_views < len(row):
                views += to_int(row[i_views])
            if i_play is not None and i_play < len(row):
                views_start += to_int(row[i_play])
            if i_v50 is not None and i_v50 < len(row):
                views_50 += to_int(row[i_v50])
            if i_v100 is not None and i_v100 < len(row):
                views_100 += to_int(row[i_v100])
            if i_va is not None and i_va < len(row) and row[i_va] is not None:
                va_raw_last = row[i_va]

    wb.close()

    viewability = _viewability_pct(va_raw_last, viewables, entregue)

    return [_comp_result(
        veiculo=veiculo_nome,
        tipo_compra=tipo_compra,
        contratado=contratado,
        entregue=entregue,
        cliques=cliques,
        viewables=viewables,
        views=views if has_views_col else None,
        views_start=views_start or None,
        views_50=views_50 or None,
        views_100=views_100 or None,
        viewability=viewability,
        formato="sense_comp_daily",
    )]


def _parse_comprovante_multi(
    filepath: str,
    data_ini: date | None,
    data_fim: date | None,
) -> list[dict]:
    """C2/C3: TOTAL POR VEÍCULO E PLACEMENT — um result por linha-pai de veículo.

    data_ini/data_fim: no-op (arquivo agregado sem coluna Data; período só em meta).
    """
    del data_ini, data_fim  # explicit: multi export has no daily grain
    path = Path(filepath)
    wb = fastxlsx.load_workbook(path)

    multi_sheets = [
        ws for ws in wb.worksheets
        if any(k in ws.title.lower() for k in ("placement", "veículo", "veiculo", "total por"))
    ]
    sheets = multi_sheets or list(wb.worksheets)

    results: list[dict] = []

    for ws in sheets:
        header_row_idx, header = _find_header_any(ws, [
            {"veículo", "veiculo"},
            {"impressões", "impressoes", "válidas", "validas", "views"},
        ])
        if header_row_idx is None:
            continue

        i_veiculo    = col_index(header, "Veículo", "Veiculo")
        i_contratado = col_index(header, "Contratado", "Qtd Contratada")
        i_validas    = col_index(header, "Válidas", "Validas")
        i_impressoes = col_index(header, "Impressões", "Impressoes")
        i_views      = col_index(header, "Views", "Visualizações", "Visualizacoes")
        i_viewables  = col_index(header, "Viewables", "Viewable")
        i_cliques    = col_index(header, "Cliques", "Clicks")
        i_va         = col_index(header, "VA(IAB)", "Viewability", "VA")
        i_play       = col_index(header, "Play", "0%", "Views Start", "Views 0%")
        i_v50        = col_index(header, "50%", "Views 50%")
        i_v100       = col_index(header, "100%", "Views 100%")

        if i_veiculo is None:
            continue

        tipo_compra = _tipo_from_context(ws, filepath, ws.title)

        for row in ws.iter_rows(min_row=header_row_idx + 1, values_only=True):
            row = list(row)
            if all(v is None for v in row):
                continue
            raw_v = row[i_veiculo] if i_veiculo < len(row) else None
            if raw_v is None or not str(raw_v).strip():
                continue  # placement child row
            veiculo = str(raw_v).strip()
            if veiculo.lower() == "total":
                continue

            validas = to_int(row[i_validas] if i_validas is not None and i_validas < len(row) else None)
            impressoes = to_int(row[i_impressoes] if i_impressoes is not None and i_impressoes < len(row) else None)
            views_val = to_int(row[i_views] if i_views is not None and i_views < len(row) else None)
            entregue = validas or impressoes or views_val
            viewables = to_int(row[i_viewables] if i_viewables is not None and i_viewables < len(row) else None)
            cliques = to_int(row[i_cliques] if i_cliques is not None and i_cliques < len(row) else None)
            contratado = to_int(row[i_contratado] if i_contratado is not None and i_contratado < len(row) else None)
            va_raw = row[i_va] if i_va is not None and i_va < len(row) else None
            play = to_int(row[i_play] if i_play is not None and i_play < len(row) else None)
            v50 = to_int(row[i_v50] if i_v50 is not None and i_v50 < len(row) else None)
            v100 = to_int(row[i_v100] if i_v100 is not None and i_v100 < len(row) else None)

            results.append(_comp_result(
                veiculo=veiculo,
                tipo_compra=tipo_compra,
                contratado=contratado,
                entregue=entregue,
                cliques=cliques,
                viewables=viewables,
                views=views_val if i_views is not None else None,
                views_start=play or None,
                views_50=v50 or None,
                views_100=v100 or None,
                viewability=_viewability_pct(va_raw, viewables, entregue),
                formato="sense_comp_multi",
            ))

    wb.close()

    if not results:
        raise ValueError(
            f"Nenhum veículo encontrado no comprovante multi SENSE: {path.name}"
        )
    return results


# ── parse_verif ──────────────────────────────────────────────────────────────────

def parse_verif(
    filepath: str,
    data_ini: date | None = None,
    data_fim: date | None = None,
    praca: str | None = None,
) -> list[dict]:
    """Parseia verification SENSE (V1/V2 impressões ou V3 visualizações).

    Os arquivos atuais não têm colunas de Data nem Estado; os filtros só são
    aplicados se as colunas existirem.
    """
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {filepath}")

    wb = fastxlsx.load_workbook(path)

    # Prefer RELATÓRIO SIMPLIFICADO; else first sheet with valid header
    preferred = [
        ws for ws in wb.worksheets
        if "simplificado" in ws.title.lower() or "relatório" in ws.title.lower()
        or "relatorio" in ws.title.lower()
    ]
    candidates = preferred + [ws for ws in wb.worksheets if ws not in preferred]

    header_row_idx, header, ws = None, [], None
    for candidate in candidates:
        hi, hd = _find_header(candidate, "Categoria", "Veículo")
        if hi is None:
            hi, hd = _find_header(candidate, "Categoria", "Veiculo")
        if hi is not None:
            header_row_idx, header, ws = hi, hd, candidate
            break

    if header_row_idx is None or ws is None:
        wb.close()
        raise ValueError(
            f"Header com 'Categoria' e 'Veículo' não encontrado nas primeiras 25 linhas: {path.name}"
        )

    i_veiculo    = col_index(header, "Veículo", "Veiculo")
    i_categoria  = col_index(header, "Categoria")
    i_url        = col_index(header, "URL/APP", "URL", "Url")
    # V1/V2 impressões + V3 visualizações — first match wins
    i_impressoes = col_index(
        header,
        "Total de impressões", "Total de impressoes",
        "Total de visualizações", "Total de visualizacoes",
        "Impressões", "Impressoes",
        "Visualizações válidas", "Visualizacoes validas",
        "Impressões válidas", "Impressoes validas",
    )
    i_data   = col_index(header, "Data", "Date")
    i_estado = col_index(header, "Estado", "State", "UF")

    metric_name = header[i_impressoes].lower() if i_impressoes is not None else ""
    is_views_metric = "visualiza" in metric_name

    if i_veiculo is None or i_impressoes is None or i_categoria is None:
        wb.close()
        raise ValueError(
            f"Colunas obrigatórias ausentes (Veículo/Total impressões|visualizações/Categoria): {path.name}"
        )

    tipo_compra = _tipo_from_context(ws, filepath, ws.title)
    if tipo_compra is None and is_views_metric:
        tipo_compra = "CPV"

    veiculos_indevidas:         dict[str, dict] = defaultdict(dict)
    veiculos_indevidas_sem_url: dict[str, dict] = defaultdict(dict)
    veiculos_entregue:  dict[str, int]  = defaultdict(int)
    veiculos_total:     dict[str, int]  = defaultdict(int)
    MAX_POOL = 10000
    url_pool: list[dict] = []
    pool_count = 0

    for row in ws.iter_rows(min_row=header_row_idx + 1, values_only=True):
        row = list(row)
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

        if praca and i_estado is not None and i_estado < len(row):
            estado_row = str(row[i_estado]).strip().upper() if row[i_estado] else ""
            if estado_row and estado_row != praca.upper().strip():
                veiculos_total[veiculo] += impressoes
                continue

        cat_str = categoria.strip()
        veiculos_indevidas[veiculo][cat_str] = (
            veiculos_indevidas[veiculo].get(cat_str, 0) + impressoes
        )
        if not url:
            veiculos_indevidas_sem_url[veiculo][cat_str] = (
                veiculos_indevidas_sem_url[veiculo].get(cat_str, 0) + impressoes
            )

        veiculos_entregue[veiculo] += impressoes
        veiculos_total[veiculo] += impressoes

        if url and cat_str:
            pool_count += 1
            entry = {"url": url, "categoria": categoria, "veiculo": veiculo, "impressoes": impressoes}
            if is_views_metric:
                entry["cpv"] = impressoes
            else:
                entry["cpm"] = impressoes
            if len(url_pool) < MAX_POOL:
                url_pool.append(entry)
            else:
                idx = random.randint(0, pool_count - 1)
                if idx < MAX_POOL:
                    url_pool[idx] = entry

    wb.close()

    results: list[dict] = []
    for veiculo in veiculos_entregue:
        ent = veiculos_entregue[veiculo]
        results.append({
            "veiculo":           veiculo,
            "tipo_compra":       tipo_compra,
            "contratado":        None,
            "entregue":          ent,
            "entregue_total":    veiculos_total[veiculo],
            "views":             ent if is_views_metric else None,
            "cliques":           None,
            "viewables":         None,
            "viewability":       None,
            "indevidas":         dict(veiculos_indevidas[veiculo]),
            "indevidas_sem_url": dict(veiculos_indevidas_sem_url[veiculo]),
            "url_sample":        url_pool if not results else [],
            "formato_detectado": "sense_verif_views" if is_views_metric else "sense_verif",
        })

    return results


# ── CLI ──────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Parser SENSE")
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
