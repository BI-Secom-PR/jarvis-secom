"""
Detector automático de formato de comprovante.

Tenta cada parser em ordem de especificidade e retorna o resultado do
primeiro que detectar o formato correto.

Regras de detecção:
  1. VETTA     — alguma sheet contém 'Contabilizações' no nome
  2. Tabular   — header ~linha 6 com colunas 'Placement' + ('Entregues'|'Impressões')
  3. Nacional  — sheet 'Worksheet' com header ~linha 11 e colunas 'Veículo'+'VA%'
  4. CM360     — coluna 'Sensitive Category' (reservado para implementação futura)

Retorna:
  list[dict]  — um dict por veículo (VETTA/Tabular retornam lista com 1 elemento;
                Nacional retorna múltiplos elementos).

Cada dict segue a interface padrão dos parsers:
  {veiculo, tipo_compra, contratado, entregue, cliques, viewables,
   viewability, indevidas, formato_detectado}
"""

import json
import sys
from datetime import date, datetime
from pathlib import Path

import pandas as pd


def _detect_format(filepath: str) -> str | None:
    """
    Inspeciona o arquivo e retorna o formato detectado:
    'vetta' | 'tabular' | 'nacional' | None
    """
    try:
        xl = pd.ExcelFile(filepath)
        sheet_names = xl.sheet_names

        # ── 1. VETTA: alguma sheet tem 'Contabilizações' ─────────────────────
        for s in sheet_names:
            if "contabiliza" in s.lower():
                return "vetta"

        # ── 2. Nacional: sheet 'Worksheet' com colunas específicas ───────────
        worksheet_names = [s for s in sheet_names if s.lower() == "worksheet"]
        if worksheet_names:
            df = pd.read_excel(filepath, sheet_name=worksheet_names[0], header=None, nrows=15)
            for _, row in df.iterrows():
                vals_lower = [str(v).strip().lower() for v in row if pd.notna(v) and str(v).strip()]
                has_vehicle = any(v in vals_lower for v in ("veículo", "veiculo"))
                has_va      = "va%" in vals_lower
                if has_vehicle and has_va:
                    return "nacional"

        # ── 3. Tabular: primeira sheet, header ~linha 6 com 'Placement' ──────
        df = pd.read_excel(filepath, sheet_name=sheet_names[0], header=None, nrows=12)
        for _, row in df.iterrows():
            vals_lower = [str(v).strip().lower() for v in row if pd.notna(v) and str(v).strip()]
            has_placement = "placement" in vals_lower
            has_metric    = any(v in vals_lower for v in ("entregues", "impressões", "impressoes"))
            if has_placement and has_metric:
                return "tabular"

    except Exception:
        pass

    return None


def parse(
    filepath: str,
    verif_paths: list[str] | None = None,
    data_ini: date | None = None,
    data_fim: date | None = None,
) -> list[dict]:
    """
    Detecta o formato e delega ao parser correto.

    Sempre retorna list[dict] — mesmo para formatos de veículo único
    (VETTA/Tabular), o resultado é embrulhado em lista para uniformidade.

    Raises:
        ValueError: se o formato não for reconhecido
        FileNotFoundError: se o arquivo não existir
    """
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {filepath}")

    fmt = _detect_format(filepath)

    if fmt == "vetta":
        from parser_vetta import parse as parse_vetta
        result = parse_vetta(filepath, verif_paths=verif_paths, data_ini=data_ini, data_fim=data_fim)
        return [result]

    elif fmt == "tabular":
        from parser_tabular import parse as parse_tabular
        result = parse_tabular(filepath, verif_paths=verif_paths, data_ini=data_ini, data_fim=data_fim)
        return [result]

    elif fmt == "nacional":
        from parser_nacional import parse as parse_nacional
        return parse_nacional(filepath, verif_paths=verif_paths, data_ini=data_ini, data_fim=data_fim)

    else:
        xl = pd.ExcelFile(filepath)
        raise ValueError(
            f"Formato não reconhecido: {path.name}\n"
            f"Sheets: {xl.sheet_names}\n"
            f"Formatos suportados: VETTA (sheet 'Contabilizações'), "
            f"Tabular (header com 'Placement'), Nacional (sheet 'Worksheet' com 'VA%')"
        )


# ── CLI para testes ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Parser automático de comprovante (auto-detect)")
    ap.add_argument("comprovante", help="Arquivo .xlsx de comprovante")
    ap.add_argument("--verif", nargs="*", default=[], metavar="FILE",
                    help="Arquivos Verification separados (formato VETTA)")
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
            verif_paths=args.verif or None,
            data_ini=_cli_date(args.ini),
            data_fim=_cli_date(args.fim),
        )
        print(json.dumps(resultados, indent=2, ensure_ascii=False, default=str))
    except Exception as e:
        print(json.dumps({"erro": str(e)}, indent=2, ensure_ascii=False))
        sys.exit(1)
