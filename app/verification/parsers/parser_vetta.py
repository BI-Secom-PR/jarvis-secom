"""
Parser para o formato VETTA Adserver.

Detectado por: sheet com "Contabilizações" no nome.
Estrutura:
  - Rows 0-10: metadados, cabeçalhos, section header
  - Row 11: #TOTAL POR VEÍCULO (ignorar)
  - Row 12+N: #TOTAL POR CANAL (ignorar — group headers e subtotais)
  - Linhas de dados reais: col[0] = nome do veículo, col[1] = data válida
  - Sheet "*Verification": categorias de indevidas por canal

Estratégia: somar linhas diárias (nunca usar os totais do adserver).
"""

import sys
import json
import re
from datetime import date, datetime
from pathlib import Path

import pandas as pd


# ── Mapeamento de categorias VETTA → SECOM ───────────────────────────────────
# Nomes encontrados na sheet Verification do VETTA
CATEGORY_MAP = {
    # Acidente
    "acidente":                         "acidente",
    "acidentes violentos":              "acidente",
    "acidentes":                        "acidente",
    # Violência (inclui crime)
    "crime":                            "violencia",
    "crimes":                           "violencia",
    "crime violento":                   "violencia",
    "violência":                        "violencia",
    "violencia":                        "violencia",
    "violência e criminalidade":        "violencia",
    "violencia e criminalidade":        "violencia",
    "violence":                         "violencia",
    # Língua Estrangeira
    "conteúdo em língua estrangeira":   "lingua_estrangeira",
    "conteudo em lingua estrangeira":   "lingua_estrangeira",
    "lingua estrangeira":               "lingua_estrangeira",
    "língua estrangeira":               "lingua_estrangeira",
    "idioma estrangeiro ou traduzido":  "lingua_estrangeira",
    "foreign language":                 "lingua_estrangeira",
    # Pornografia (inclui conteúdo sexual)
    "pornografia":                      "pornografia",
    "pornography":                      "pornografia",
    "sexo e sexualidade":               "pornografia",
    "sexo":                             "pornografia",
    "conteúdo adulto e sexual":         "pornografia",
    "conteudo adulto e sexual":         "pornografia",
    "adult":                            "pornografia",
    "sexuality":                        "pornografia",
    # Safeframe
    "safeframe":                        "safeframe",
    # Aplicativo Móvel
    "aplicativo móvel":                 "app_movel",
    "aplicativo movel":                 "app_movel",
    "mobile app":                       "app_movel",
    # Teste de Tag
    "teste de tag":                     "teste_tag",
    # Não Classificado
    "não classificado":                 "nao_classificado",
    "nao classificado":                 "nao_classificado",
    "indeterminado":                    "nao_classificado",
    "indeterminados":                   "nao_classificado",
}

INDEVIDAS_ZERO = {
    "acidente": 0, "violencia": 0, "lingua_estrangeira": 0,
    "pornografia": 0, "safeframe": 0, "app_movel": 0,
    "teste_tag": 0, "nao_classificado": 0,
}


def _normaliza_categoria(texto: str) -> str | None:
    if not texto or not isinstance(texto, str):
        return None
    return CATEGORY_MAP.get(texto.strip().lower())


def _is_data(valor) -> bool:
    """Verifica se o valor é uma data (datetime, date ou string parseable)."""
    if isinstance(valor, (datetime, date)):
        return True
    if isinstance(valor, str):
        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y"):
            try:
                datetime.strptime(valor.strip(), fmt)
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
        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y"):
            try:
                return datetime.strptime(valor.strip(), fmt).date()
            except ValueError:
                pass
    return None


def _to_int(valor) -> int:
    try:
        return int(float(str(valor).replace(",", ".")))
    except (ValueError, TypeError):
        return 0


def _is_total_row(row) -> bool:
    """True se qualquer célula da linha contém '#TOTAL'."""
    return any(
        isinstance(v, str) and "#TOTAL" in v.upper()
        for v in row
    )


def _parse_contabilizacoes(df: pd.DataFrame, data_ini: date | None, data_fim: date | None) -> dict:
    """
    Lê a sheet de Contabilizações e soma as linhas diárias de dados reais.
    Retorna: {veiculo, tipo_compra, contratado, entregue, cliques, viewables, viewability}
    """
    totais = {
        "veiculo": None,
        "tipo_compra": None,
        "contratado": 0,
        "entregue": 0,
        "cliques": 0,
        "viewables": 0,
        "viewability_soma": 0.0,
        "viewability_n": 0,
    }

    # Detectar linha do cabeçalho das colunas (contém "Veículo" e "Data")
    header_row = None
    for i, row in df.iterrows():
        vals = [str(v).strip().lower() for v in row if pd.notna(v)]
        if "veículo" in vals or "veiculo" in vals:
            header_row = i
            break
        # Extrair "Total contratado" do texto dos metadados (antes do header)
        for v in row:
            if isinstance(v, str):
                m = re.search(r"total contratado[:\s]+([\d.,]+)", v, re.IGNORECASE)
                if m:
                    raw = m.group(1).replace(".", "").replace(",", "")
                    try:
                        totais["contratado"] = int(raw)
                    except ValueError:
                        pass

    if header_row is None:
        return totais

    # Renomear colunas usando a linha de cabeçalho
    df.columns = [str(v).strip() if pd.notna(v) else f"col_{i}" for i, v in enumerate(df.iloc[header_row])]
    df = df.iloc[header_row + 1:].reset_index(drop=True)

    # Normalizar nomes de colunas para busca
    col_lower = {c.lower(): c for c in df.columns}

    def get_col(*candidates):
        for c in candidates:
            if c in col_lower:
                return col_lower[c]
        return None

    col_veiculo     = get_col("veículo", "veiculo", "vehicle")
    col_data        = get_col("data", "date", "dia")
    col_contratado  = get_col("contratado", "impressões contratadas", "views contratados")
    col_entregue    = get_col("entregue", "impressões", "views", "impressoes")
    col_cliques     = get_col("cliques", "clicks", "clique")
    col_viewables   = get_col("viewables", "viewable")
    col_viewability = get_col("va (iab)", "viewability", "viewability%", "% viewability", "va%")

    for _, row in df.iterrows():
        # Extrair viewability da linha #TOTAL POR VEÍCULO antes de pulá-la
        if _is_total_row(row.values):
            row_vals = [str(v).strip().upper() for v in row.values]
            if any("TOTAL POR VEÍCULO" in v or "TOTAL POR VEICULO" in v for v in row_vals):
                if col_viewability:
                    v = row.get(col_viewability)
                    try:
                        pct = float(str(v).replace(",", ".").replace("%", "").strip())
                        totais["viewability_soma"] = pct
                        totais["viewability_n"]    = 1
                    except (ValueError, TypeError):
                        pass
            continue

        # Pular linhas sem veículo ou sem data
        veiculo_val = row.get(col_veiculo) if col_veiculo else None
        data_val    = row.get(col_data)    if col_data    else None

        if not isinstance(veiculo_val, str) or not veiculo_val.strip():
            continue
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

        # Guardar nome do veículo (primeiro encontrado)
        if not totais["veiculo"]:
            totais["veiculo"] = veiculo_val.strip()

        totais["contratado"]  += _to_int(row.get(col_contratado))  if col_contratado  else 0
        totais["entregue"]    += _to_int(row.get(col_entregue))    if col_entregue    else 0
        totais["cliques"]     += _to_int(row.get(col_cliques))     if col_cliques     else 0
        totais["viewables"]   += _to_int(row.get(col_viewables))   if col_viewables   else 0
        # viewability extraída do #TOTAL POR VEÍCULO — não acumular por linha diária

    return totais


def _parse_verification_file(filepath: str) -> dict:
    """
    Lê um arquivo de Verification separado (Verification - *.xlsx).
    Estrutura: metadados nas primeiras linhas, header com 'Categoria' +
    coluna de métrica (Impressões para CPM, Views para CPV).
    Usa openpyxl read_only para arquivos grandes (>50k linhas).
    """
    import openpyxl
    indevidas = dict(INDEVIDAS_ZERO)

    wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
    for ws in wb.worksheets:
        cat_col    = None
        metric_col = None
        header_found = False

        for row in ws.iter_rows(values_only=True):
            if not header_found:
                row_lower = [str(v).strip().lower() if v is not None else "" for v in row]
                if "categoria" in row_lower:
                    cat_col = row_lower.index("categoria")
                    # Preferir Impressões; fallback Views (CPV)
                    for candidate in ("impressões", "impressoes", "impressions", "views", "visualizações"):
                        if candidate in row_lower:
                            metric_col = row_lower.index(candidate)
                            break
                    header_found = True
                continue

            if cat_col is None or metric_col is None:
                continue

            cat_val = row[cat_col] if cat_col < len(row) else None
            cat = _normaliza_categoria(str(cat_val) if cat_val is not None else "")
            if cat:
                met_val = row[metric_col] if metric_col < len(row) else None
                indevidas[cat] = indevidas.get(cat, 0) + _to_int(met_val)

    wb.close()
    return indevidas


def _merge_indevidas(base: dict, extra: dict) -> dict:
    """Soma dois dicts de indevidas."""
    result = dict(base)
    for k, v in extra.items():
        result[k] = result.get(k, 0) + v
    return result


def parse(
    filepath: str,
    verif_paths: list[str] | None = None,
    data_ini: date | None = None,
    data_fim: date | None = None,
) -> dict:
    """
    Ponto de entrada principal.

    filepath     — Comprovante Veículo (contém sheet 'Contabilizações')
    verif_paths  — Lista de arquivos Verification separados (Verification - *.xlsx)
                   com dados de indevidas por categoria/placement.
    """
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {filepath}")

    xl = pd.ExcelFile(filepath)
    sheets = xl.sheet_names

    # Identificar sheet de contabilizações
    sheet_cont = None
    tipo_compra = None
    for s in sheets:
        sl = s.lower()
        if "contabiliza" in sl:
            sheet_cont = s
            if "cpm" in sl:
                tipo_compra = "CPM"
            elif "cpv" in sl:
                tipo_compra = "CPV"
            break

    if sheet_cont is None:
        raise ValueError(f"Sheet 'Contabilizações' não encontrada. Sheets: {sheets}")

    # Parsear contabilizações
    df_cont = pd.read_excel(filepath, sheet_name=sheet_cont, header=None)
    totais  = _parse_contabilizacoes(df_cont, data_ini, data_fim)
    totais["tipo_compra"] = tipo_compra

    # Parsear indevidas — dos arquivos de Verification separados
    indevidas = dict(INDEVIDAS_ZERO)
    for vpath in (verif_paths or []):
        vp = Path(vpath)
        if vp.exists():
            extra = _parse_verification_file(str(vp))
            indevidas = _merge_indevidas(indevidas, extra)

    # Calcular viewability média
    viewability = None
    if totais["viewability_n"] > 0:
        viewability = round(totais["viewability_soma"] / totais["viewability_n"] / 100, 4)

    return {
        "veiculo":           totais["veiculo"] or path.stem,
        "tipo_compra":       tipo_compra,
        "contratado":        totais["contratado"] or None,
        "entregue":          totais["entregue"],
        "cliques":           totais["cliques"] or None,
        "viewables":         totais["viewables"] or None,
        "viewability":       viewability,
        "indevidas":         indevidas,
        "formato_detectado": "vetta",
    }


# ── CLI para testes ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Parser VETTA Adserver")
    ap.add_argument("comprovante", help="Comprovante Veículo .xlsx")
    ap.add_argument("--verif", nargs="*", default=[], metavar="FILE",
                    help="Arquivos Verification separados (podem ser vários)")
    ap.add_argument("--ini",  default=None, metavar="DD/MM/YYYY")
    ap.add_argument("--fim",  default=None, metavar="DD/MM/YYYY")
    args = ap.parse_args()

    try:
        resultado = parse(
            args.comprovante,
            verif_paths=args.verif or None,
            data_ini=_to_date(args.ini),
            data_fim=_to_date(args.fim),
        )
        print(json.dumps(resultado, indent=2, ensure_ascii=False, default=str))
    except Exception as e:
        print(json.dumps({"erro": str(e)}, indent=2, ensure_ascii=False))
        sys.exit(1)
