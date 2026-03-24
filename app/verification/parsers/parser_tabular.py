"""
Parser para o formato Tabular (Teads PE, Pernambuco.com).

Detectado por: sheet com header ~linha 6 contendo colunas 'Placement' + 'Entregues'.

Estrutura:
  - Rows 0–5: metadados (Cliente, Agência, Campanha, Período, bloco de resumo)
  - Row 6:    cabeçalho das colunas (26 colunas)
  - Row 7+:   dados diários por placement
  - Última linha com "-" em col[0]: grand total → ignorar

Métricas:
  - Contratado / Viewability / Viewables: extraídos do bloco de metadados
  - Entregue / Cliques: somados das linhas diárias
  - CPM → métrica principal = Impressões (col 14)
  - CPV → métrica principal = Entregues (col 9)
  - Sem dados de indevidas neste formato

Estratégia: somar linhas diárias (nunca usar totais do adserver).
"""

import sys
import json
import re
from datetime import date, datetime
from pathlib import Path

import pandas as pd


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


def _is_data(valor) -> bool:
    if isinstance(valor, (datetime, date)):
        return True
    if isinstance(valor, str):
        for fmt in ("%Y-%m-%d %H:%M:%S", "%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
            try:
                datetime.strptime(valor.strip()[:10], fmt[:8])
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
        for fmt in ("%Y-%m-%d %H:%M:%S", "%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
            try:
                return datetime.strptime(s[:len(fmt.replace('%Y','XXXX').replace('%m','XX').replace('%d','XX').replace('%H','XX').replace('%M','XX').replace('%S','XX'))], fmt).date()
            except ValueError:
                pass
        # Try just first 10 chars (handles "2025-12-23 03:00:00")
        try:
            return datetime.strptime(s[:10], "%Y-%m-%d").date()
        except ValueError:
            pass
    return None


def _parse_metadata(df_meta: pd.DataFrame) -> dict:
    """
    Extrai do bloco de metadados (primeiras ~6 linhas).

    O formato Teads/Tabular usa células separadas para chave e valor:
      [row, col]   "Volume contratado"  |  [row, col+1]  123863
      [row, col]   "Viewability (IAB)"  |  [row, col+1]  0.863078

    Também suporta valores combinados na mesma célula:
      "Volume contratado: 123.863"
    """
    result = {
        "veiculo": None,
        "tipo_compra": None,
        "contratado": None,
        "viewability": None,
        "viewables": None,
    }

    # Padrões para células combinadas (chave: valor na mesma string)
    pat_combined = {
        "contratado":  re.compile(r"volume\s+contratado[:\s]+([\d.,]+)", re.IGNORECASE),
        "viewability": re.compile(r"viewability\s*\(?iab\)?[:\s]+([\d.,]+)", re.IGNORECASE),
        "viewables":   re.compile(r"viewables?\s*\(?iab\)?[:\s]+([\d.,]+)", re.IGNORECASE),
        "tipo_cpv":    re.compile(r"\bCPV\b", re.IGNORECASE),
        "tipo_cpm":    re.compile(r"\bCPM\b", re.IGNORECASE),
        "veiculo":     re.compile(r"ve[íi]culo[:\s]+(.+)", re.IGNORECASE),
    }

    # Rótulos para padrão chave/valor em células adjacentes
    labels_contratado  = {"volume contratado", "contratado", "contracted"}
    labels_viewability = {"viewability (iab)", "viewability(iab)", "viewability"}
    labels_viewables   = {"viewables (iab)", "viewables(iab)", "viewables"}

    for _, row in df_meta.iterrows():
        vals = list(row)
        for i, cell in enumerate(vals):
            cell_s = str(cell).strip() if cell is not None else ""
            cell_lower = cell_s.lower()

            # ── Padrão adjacente: rótulo em célula i, valor numérico em célula i+1 ──
            if i + 1 < len(vals) and isinstance(cell, str):
                next_val = vals[i + 1]
                if pd.notna(next_val) and next_val != "" and str(next_val).strip() != "":
                    if cell_lower in labels_contratado and result["contratado"] is None:
                        result["contratado"] = _to_int(next_val)
                    elif cell_lower in labels_viewability and result["viewability"] is None:
                        v = _to_float(next_val)
                        if v is not None:
                            result["viewability"] = v if v <= 1.0 else round(v / 100, 6)
                    elif cell_lower in labels_viewables and result["viewables"] is None:
                        result["viewables"] = _to_int(next_val)

            if not isinstance(cell, str):
                continue

            # ── Tipo de compra: aparece como "CPV Visualizações" ou "CPM ..." ──
            if result["tipo_compra"] is None:
                if pat_combined["tipo_cpv"].search(cell_s):
                    result["tipo_compra"] = "CPV"
                elif pat_combined["tipo_cpm"].search(cell_s):
                    result["tipo_compra"] = "CPM"

            # ── Padrão combinado: "Volume contratado: 123.863" ──
            if result["contratado"] is None:
                m = pat_combined["contratado"].search(cell_s)
                if m:
                    raw = m.group(1).replace(".", "").replace(",", "")
                    try:
                        result["contratado"] = int(raw)
                    except ValueError:
                        pass

            if result["viewability"] is None:
                m = pat_combined["viewability"].search(cell_s)
                if m:
                    v = _to_float(m.group(1))
                    if v is not None:
                        result["viewability"] = v if v <= 1.0 else round(v / 100, 6)

            if result["viewables"] is None:
                m = pat_combined["viewables"].search(cell_s)
                if m:
                    result["viewables"] = _to_int(m.group(1).replace(".", "").replace(",", ""))

    return result


def _find_header_row(df: pd.DataFrame) -> int | None:
    """
    Localiza a linha do cabeçalho procurando por 'Placement' E ('Entregues' OU 'Impressões').
    Retorna o índice da linha (0-based).
    """
    for i, row in df.iterrows():
        vals_lower = [str(v).strip().lower() for v in row if pd.notna(v)]
        has_placement = "placement" in vals_lower
        has_metric = any(v in vals_lower for v in ("entregues", "impressões", "impressoes"))
        if has_placement and has_metric:
            return i
    return None


def parse(
    filepath: str,
    verif_paths: list[str] | None = None,  # ignorado neste formato (sem indevidas)
    data_ini: date | None = None,
    data_fim: date | None = None,
) -> dict:
    """
    Ponto de entrada principal.

    filepath    — Comprovante no formato tabular (.xlsx)
    verif_paths — ignorado (formato tabular não possui dados de indevidas)
    """
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {filepath}")

    xl = pd.ExcelFile(filepath)
    # Usar a primeira sheet (geralmente 'sheet1')
    sheet_name = xl.sheet_names[0]
    df_raw = pd.read_excel(filepath, sheet_name=sheet_name, header=None)

    # ── Localizar linha de cabeçalho ────────────────────────────────────────────
    header_row = _find_header_row(df_raw)
    if header_row is None:
        raise ValueError(
            f"Cabeçalho não encontrado (esperado: colunas 'Placement' + 'Entregues'). "
            f"Sheets: {xl.sheet_names}"
        )

    # ── Extrair metadados (linhas antes do cabeçalho) ──────────────────────────
    df_meta = df_raw.iloc[:header_row]
    meta = _parse_metadata(df_meta)

    # ── Configurar DataFrame de dados ──────────────────────────────────────────
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
    col_data        = get_col("data", "date", "dia")
    col_tipo        = get_col("tipo de compra", "tipo")
    col_impressoes  = get_col("impressões", "impressoes", "impressions")
    col_entregues   = get_col("entregues", "entregues (iab)", "delivered")
    col_cliques     = get_col("cliques", "clicks")
    col_viewables   = get_col("viewables", "viewables (iab)")
    col_viewability = get_col("viewability", "viewability (iab)", "% viewability")
    col_views       = get_col("100%", "views completos", "completed views")  # VTR completed = 100%

    # ── Determinar tipo de compra ───────────────────────────────────────────────
    tipo_compra = meta.get("tipo_compra")

    # Se não detectado no metadata, tentar a partir dos dados
    if tipo_compra is None and col_tipo:
        tipos = df[col_tipo].dropna().astype(str).str.strip().str.upper().unique()
        if "CPV" in tipos:
            tipo_compra = "CPV"
        elif "CPM" in tipos:
            tipo_compra = "CPM"

    # ── Somar linhas diárias ────────────────────────────────────────────────────
    totais = {
        "entregue":  0,
        "cliques":   0,
        "viewables": 0,
        "veiculo":   meta.get("veiculo"),
    }

    viewability_soma = 0.0
    viewability_n    = 0

    for _, row in df.iterrows():
        veiculo_val = row.get(col_veiculo) if col_veiculo else None
        # Linha de grand total: col[0] == "-"
        first_val = str(row.iloc[0]).strip() if len(row) > 0 else ""
        if first_val == "-":
            continue

        # Pular linhas sem veículo
        if col_veiculo and (pd.isna(veiculo_val) or str(veiculo_val).strip() == ""):
            continue

        # Verificar se tem data válida
        data_val = row.get(col_data) if col_data else None
        if not _is_data(data_val):
            continue

        # Filtro de data
        if data_ini or data_fim:
            d = _to_date(data_val)
            if d:
                if data_ini and d < data_ini:
                    continue
                if data_fim and d > data_fim:
                    continue

        # Capturar nome do veículo (primeiro encontrado)
        if not totais["veiculo"] and col_veiculo and isinstance(veiculo_val, str):
            totais["veiculo"] = veiculo_val.strip()

        # Métrica principal de entrega (CPM = Impressões, CPV = Entregues)
        if tipo_compra == "CPM" and col_impressoes:
            totais["entregue"] += _to_int(row.get(col_impressoes))
        elif col_entregues:
            totais["entregue"] += _to_int(row.get(col_entregues))

        # Cliques
        if col_cliques:
            totais["cliques"] += _to_int(row.get(col_cliques))

        # Viewables por linha
        if col_viewables:
            totais["viewables"] += _to_int(row.get(col_viewables))

        # Viewability por linha (para média ponderada)
        if col_viewability:
            v = _to_float(row.get(col_viewability))
            if v is not None and v > 0:
                viewability_soma += v if v <= 1.0 else v / 100
                viewability_n    += 1

    # ── Viewability: preferir metadata (já calculado pelo adserver), senão média diária ──
    viewability = meta.get("viewability")
    if viewability is None and viewability_n > 0:
        viewability = round(viewability_soma / viewability_n, 6)

    # ── Viewables: preferir soma diária se disponível, senão metadata ──────────
    viewables_final = totais["viewables"] if totais["viewables"] > 0 else meta.get("viewables")

    # ── Indevidas: formato tabular não possui dados de categoria ───────────────
    indevidas = {
        "acidente": 0, "violencia": 0, "lingua_estrangeira": 0,
        "pornografia": 0, "safeframe": 0, "app_movel": 0,
        "teste_tag": 0, "nao_classificado": 0,
    }

    return {
        "veiculo":           totais["veiculo"] or path.stem,
        "tipo_compra":       tipo_compra,
        "contratado":        meta.get("contratado") or None,
        "entregue":          totais["entregue"],
        "cliques":           totais["cliques"] or None,
        "viewables":         viewables_final or None,
        "viewability":       viewability,
        "indevidas":         indevidas,
        "formato_detectado": "tabular",
    }


# ── CLI para testes ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Parser Tabular (Teads PE, Pernambuco.com)")
    ap.add_argument("comprovante", help="Comprovante Veículo .xlsx no formato tabular")
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
        resultado = parse(
            args.comprovante,
            data_ini=_cli_date(args.ini),
            data_fim=_cli_date(args.fim),
        )
        print(json.dumps(resultado, indent=2, ensure_ascii=False, default=str))
    except Exception as e:
        print(json.dumps({"erro": str(e)}, indent=2, ensure_ascii=False))
        sys.exit(1)
