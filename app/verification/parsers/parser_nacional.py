"""
Parser para o formato Nacional (multi-veículo, agência Nacional / RJ).

Detectado por: sheet "Worksheet" com header ~linha 11 contendo colunas
'Veículo', 'Data', 'Impressões', 'Cliques', 'Viewable', 'VA%', 'Tipo de compra'.

Estrutura:
  - Rows 0–10: metadados (Campanha, Período, Cliente, Agência, Totais gerais)
  - Row 11:    cabeçalho das colunas
  - Row 12+:   dados por placement/dia, intercalados com linhas #TOTAL POR VEÍCULO
  - Por veículo: 1 linha '#TOTAL POR VEÍCULO' com Contratado + VA% summary

Particularidades:
  - Arquivo multi-veículo: retorna lista[dict], um por veículo
  - Contratado e Viewability extraídos da linha #TOTAL POR VEÍCULO de cada veículo
  - VA% nas linhas diárias já está em percentual (ex: 70.77 = 70.77%)
  - Sem dados de indevidas neste formato

Estratégia: somar linhas diárias (nunca usar totais do adserver) para entregue/cliques/viewables.
"""

import sys
import json
import re
from datetime import date, datetime
from pathlib import Path
from collections import defaultdict

import pandas as pd


INDEVIDAS_ZERO = {
    "acidente": 0, "violencia": 0, "lingua_estrangeira": 0,
    "pornografia": 0, "safeframe": 0, "app_movel": 0,
    "teste_tag": 0, "nao_classificado": 0,
}


def _to_int(valor) -> int:
    try:
        return int(float(str(valor).replace(",", ".")))
    except (ValueError, TypeError):
        return 0


def _to_float(valor) -> float | None:
    try:
        return float(str(valor).replace(",", ".").replace("%", "").strip())
    except (ValueError, TypeError):
        return None


def _is_data_str(valor) -> bool:
    """True se o valor parece uma data (não é uma string de total/texto)."""
    if isinstance(valor, (datetime, date)):
        return True
    if not isinstance(valor, str):
        return False
    s = valor.strip()
    if "#TOTAL" in s.upper():
        return False
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%Y-%m-%d %H:%M:%S"):
        try:
            datetime.strptime(s[:10], fmt[:8] if len(fmt) > 8 else fmt)
            return True
        except ValueError:
            pass
    return False


def _to_date(valor) -> date | None:
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    if isinstance(valor, str):
        s = valor.strip()
        for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(s[:10], fmt).date()
            except ValueError:
                pass
    return None


def _find_header_row(df: pd.DataFrame) -> int | None:
    """
    Localiza a linha do cabeçalho buscando por ('Veículo' OU 'Veiculo') AND ('Impressões' OU 'VA%').
    """
    for i, row in df.iterrows():
        vals_lower = [str(v).strip().lower() for v in row if pd.notna(v) and str(v).strip()]
        has_vehicle = any(v in vals_lower for v in ("veículo", "veiculo", "vehicle"))
        has_metric  = any(v in vals_lower for v in ("impressões", "impressoes", "va%", "viewable"))
        if has_vehicle and has_metric:
            return i
    return None


def parse(
    filepath: str,
    verif_paths: list[str] | None = None,   # ignorado (sem indevidas neste formato)
    data_ini: date | None = None,
    data_fim: date | None = None,
) -> list[dict]:
    """
    Ponto de entrada principal.

    Retorna lista de dicts, um por veículo encontrado no arquivo.
    Ao contrário dos outros parsers, este retorna MÚLTIPLOS resultados.
    """
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {filepath}")

    xl = pd.ExcelFile(filepath)
    # Prefer sheet named 'Worksheet', otherwise use first sheet
    sheet_name = next(
        (s for s in xl.sheet_names if s.lower() == "worksheet"),
        xl.sheet_names[0],
    )

    df_raw = pd.read_excel(filepath, sheet_name=sheet_name, header=None)

    # ── Localizar cabeçalho ────────────────────────────────────────────────────
    header_row = _find_header_row(df_raw)
    if header_row is None:
        raise ValueError(
            f"Cabeçalho não encontrado (esperado: colunas 'Veículo' + 'Impressões'/'VA%'). "
            f"Sheets: {xl.sheet_names}"
        )

    df_raw.columns = [
        str(v).strip() if pd.notna(v) else f"col_{i}"
        for i, v in enumerate(df_raw.iloc[header_row])
    ]
    df = df_raw.iloc[header_row + 1:].reset_index(drop=True)

    col_lower = {c.lower(): c for c in df.columns}

    def get_col(*candidates):
        for c in candidates:
            if c in col_lower:
                return col_lower[c]
        return None

    col_veiculo     = get_col("veículo", "veiculo", "vehicle")
    col_data        = get_col("data", "date")
    col_tipo        = get_col("tipo de compra", "tipo")
    col_contratado  = get_col("contratado", "contracted")
    col_impressoes  = get_col("impressões", "impressoes", "impressions")
    col_cliques     = get_col("cliques", "clicks")
    col_viewable    = get_col("viewable", "viewables")
    col_va          = get_col("va%", "viewability", "va (iab)", "% viewability")

    if not col_veiculo:
        raise ValueError("Coluna 'Veículo' não encontrada no cabeçalho.")

    # ── Processar linhas: acumular por veículo ─────────────────────────────────
    # acumuladores[veiculo] = {entregue, cliques, viewables, tipo_compra, ...}
    acumuladores = defaultdict(lambda: {
        "entregue":          0,
        "cliques":           0,
        "viewables":         0,
        "contratado":        None,   # da linha #TOTAL
        "viewability":       None,   # da linha #TOTAL
        "tipo_compra":       None,
        "viewability_soma":  0.0,
        "viewability_n":     0,
    })

    for _, row in df.iterrows():
        veiculo_val = row.get(col_veiculo) if col_veiculo else None
        if not isinstance(veiculo_val, str) or not veiculo_val.strip():
            continue

        veiculo_key = veiculo_val.strip()
        data_val = row.get(col_data) if col_data else None
        data_str = str(data_val).strip() if data_val is not None else ""

        acc = acumuladores[veiculo_key]

        # ── Linha de TOTAL por veículo: extrair contratado + viewability ──
        if "#TOTAL" in data_str.upper():
            if col_contratado and acc["contratado"] is None:
                acc["contratado"] = _to_int(row.get(col_contratado)) or None
            if col_va and acc["viewability"] is None:
                va = _to_float(row.get(col_va))
                if va is not None and va > 0:
                    # VA% vem em percentual (ex: 70.77) → converter para decimal
                    acc["viewability"] = round(va / 100, 6) if va > 1.0 else round(va, 6)
            if col_tipo and acc["tipo_compra"] is None:
                t = str(row.get(col_tipo) or "").strip().upper()
                if t in ("CPM", "CPV", "CPC"):
                    acc["tipo_compra"] = t
            continue

        # ── Linha de dados: verificar se tem data válida ───────────────────
        if not _is_data_str(data_val):
            continue

        # Filtro de data
        if data_ini or data_fim:
            d = _to_date(data_val)
            if d:
                if data_ini and d < data_ini:
                    continue
                if data_fim and d > data_fim:
                    continue

        # Tipo de compra (da primeira linha de dados)
        if acc["tipo_compra"] is None and col_tipo:
            t = str(row.get(col_tipo) or "").strip().upper()
            if t in ("CPM", "CPV", "CPC"):
                acc["tipo_compra"] = t

        # Acumular métricas
        acc["entregue"]  += _to_int(row.get(col_impressoes)) if col_impressoes else 0
        acc["cliques"]   += _to_int(row.get(col_cliques))    if col_cliques    else 0
        acc["viewables"] += _to_int(row.get(col_viewable))   if col_viewable   else 0

    # ── Montar lista de resultados ─────────────────────────────────────────────
    resultados = []
    for veiculo, acc in acumuladores.items():
        resultados.append({
            "veiculo":           veiculo,
            "tipo_compra":       acc["tipo_compra"],
            "contratado":        acc["contratado"],
            "entregue":          acc["entregue"],
            "cliques":           acc["cliques"] or None,
            "viewables":         acc["viewables"] or None,
            "viewability":       acc["viewability"],
            "indevidas":         dict(INDEVIDAS_ZERO),
            "formato_detectado": "nacional",
        })

    return resultados


# ── CLI para testes ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Parser Nacional (multi-veículo, RJ)")
    ap.add_argument("comprovante", help="Comprovante multi-veículo .xlsx")
    ap.add_argument("--ini", default=None, metavar="DD/MM/YYYY")
    ap.add_argument("--fim", default=None, metavar="DD/MM/YYYY")
    args = ap.parse_args()

    def _cli_date(s):
        if not s:
            return None
        for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                pass
        return None

    try:
        resultados = parse(
            args.comprovante,
            data_ini=_cli_date(args.ini),
            data_fim=_cli_date(args.fim),
        )
        print(json.dumps(resultados, indent=2, ensure_ascii=False, default=str))
    except Exception as e:
        print(json.dumps({"erro": str(e)}, indent=2, ensure_ascii=False))
        sys.exit(1)
