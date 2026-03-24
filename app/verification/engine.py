"""
Engine de comparação do Sistema de Verificação SECOM.

Fluxo:
  1. Lê o consolidado (template 28 colunas) via openpyxl
  2. Detecta e parseia cada comprovante via parser_auto
  3. Faz match fuzzy entre veículos do consolidado e resultados dos parsers
  4. Compara métricas e gera lista de divergências
  5. Escreve devolutiva na coluna 27 (Devolutiva BI SECOM) do consolidado
  6. Salva como <nome>_verificado.xlsx (não sobrescreve o original)

Regras de divergência:
  - Entregue: |comp − consol| / consol > 2% → flaggar
  - Cada categoria indevida: comp ≠ consol → flaggar
  - Veículo no consolidado sem comprovante → PENDENTE
  - Comprovante sem veículo no consolidado → avisado mas não grava no arquivo

Colunas do consolidado (1-indexed):
  1=Veículo  3=Tipo  4=Contratado  5=Impressões  7=Cliques  9=Views
  11=Viewables  12=Viewability  14–21=indevidas  27=Devolutiva BI SECOM
"""

import sys
import os
import json
import unicodedata
import re
from datetime import date, datetime
from pathlib import Path

import openpyxl
from rapidfuzz import fuzz, process

# ── Constantes ─────────────────────────────────────────────────────────────────
FUZZY_THRESHOLD  = 85     # % mínimo para aceitar match de veículo
ENTREGUE_TOL_PCT = 2.0    # divergência tolerada em entregue (%)
HEADER_ROW       = 8      # linha 1-indexed do cabeçalho no template
DATA_START_ROW   = 9      # primeira linha de dados (1-indexed)

# Mapeamento col_index(1-based) → chave interna
COL_VEICULO      = 1
COL_TIPO_COMPRA  = 3
COL_CONTRATADO   = 4
COL_IMPRESSOES   = 5
COL_CLIQUES      = 7
COL_VIEWS        = 9
COL_VIEWABLES    = 11
COL_VIEWABILITY  = 12
COL_INDEVIDAS = {
    "acidente":          14,
    "violencia":         15,
    "lingua_estrangeira": 16,
    "pornografia":       17,
    "safeframe":         18,
    "app_movel":         19,
    "teste_tag":         20,
    "nao_classificado":  21,
}
COL_DEVOLUTIVA_BI = 27


# ── Normalização de nomes ───────────────────────────────────────────────────────
_REMOVE_SUFFIXES = re.compile(
    r"\b(s\.?a\.?|ltda\.?|eireli|me|epp|s\/a|sa)\b", re.IGNORECASE
)
_REMOVE_PUNCT = re.compile(r"[^\w\s]")
_EXTRA_SPACES = re.compile(r"\s+")


def _normalize(name: str) -> str:
    """Uppercase, sem acentos, sem pontuação, sem sufixos empresariais."""
    if not name:
        return ""
    # Remove acentos
    nfkd = unicodedata.normalize("NFKD", str(name))
    ascii_str = nfkd.encode("ascii", "ignore").decode("ascii")
    # Uppercase
    s = ascii_str.upper()
    # Remove sufixos
    s = _REMOVE_SUFFIXES.sub(" ", s)
    # Remove pontuação (mantém espaços)
    s = _REMOVE_PUNCT.sub(" ", s)
    # Normaliza espaços
    return _EXTRA_SPACES.sub(" ", s).strip()


# ── Leitura do consolidado ──────────────────────────────────────────────────────
def _cell_value(ws, row: int, col: int):
    """Lê valor de célula ignorando fórmulas (retorna None se fórmula sem valor)."""
    cell = ws.cell(row=row, column=col)
    val = cell.value
    if isinstance(val, str) and val.startswith("="):
        return None
    return val


def _to_int_safe(v) -> int:
    if v is None:
        return 0
    try:
        return int(float(str(v).replace(",", ".")))
    except (ValueError, TypeError):
        return 0


def _to_float_safe(v) -> float | None:
    if v is None:
        return None
    try:
        return float(str(v).replace(",", ".").replace("%", "").strip())
    except (ValueError, TypeError):
        return None


def _read_consolidado(ws) -> list[dict]:
    """
    Lê todas as linhas de dados do consolidado.
    Retorna lista de dicts com métricas por veículo.
    """
    rows = []
    for row_idx in range(DATA_START_ROW, ws.max_row + 1):
        veiculo = _cell_value(ws, row_idx, COL_VEICULO)
        if not veiculo or not str(veiculo).strip():
            continue

        tipo = str(_cell_value(ws, row_idx, COL_TIPO_COMPRA) or "").strip().upper()

        # Entregue: CPM = Impressões, CPV = Views
        if tipo == "CPV":
            entregue = _to_int_safe(_cell_value(ws, row_idx, COL_VIEWS))
        else:
            entregue = _to_int_safe(_cell_value(ws, row_idx, COL_IMPRESSOES))

        indevidas = {
            cat: _to_int_safe(_cell_value(ws, row_idx, col))
            for cat, col in COL_INDEVIDAS.items()
        }

        rows.append({
            "row_idx":    row_idx,
            "veiculo":    str(veiculo).strip(),
            "tipo_compra": tipo or None,
            "contratado": _to_int_safe(_cell_value(ws, row_idx, COL_CONTRATADO)),
            "entregue":   entregue,
            "cliques":    _to_int_safe(_cell_value(ws, row_idx, COL_CLIQUES)),
            "viewables":  _to_int_safe(_cell_value(ws, row_idx, COL_VIEWABLES)),
            "viewability": _to_float_safe(_cell_value(ws, row_idx, COL_VIEWABILITY)),
            "indevidas":  indevidas,
        })

    return rows


# ── Associação verif files → comprovantes ──────────────────────────────────────
def _is_verif_file(path: str) -> bool:
    """Arquivo de Verification separado: nome começa com 'Verification - '."""
    return Path(path).name.lower().startswith("verification -")


def _associate_verif(comprovante_paths: list[str], verif_paths: list[str]) -> dict[str, list[str]]:
    """
    Associa cada arquivo verif ao comprovante de mesmo veículo.
    Usa fuzzy match no nome do arquivo.

    Retorna: {comprovante_path: [verif_path1, verif_path2, ...]}
    """
    assoc: dict[str, list[str]] = {c: [] for c in comprovante_paths}

    # Extrair "label" do comprovante: parte após "Comprovante Veículo - " ou nome completo
    def comp_label(path: str) -> str:
        name = Path(path).stem
        for prefix in ("comprovante veículo -", "comprovante veiculo -", "comprovante -"):
            lower = name.lower()
            if lower.startswith(prefix):
                return _normalize(name[len(prefix):].strip())
        return _normalize(name)

    # Extrair "label" do verif: parte após "Verification - "
    def verif_label(path: str) -> str:
        name = Path(path).stem
        lower = name.lower()
        for prefix in ("verification -",):
            if lower.startswith(prefix):
                label = name[len(prefix):].strip()
                # Remove sufixo "_Part N"
                label = re.sub(r"\s*_?\s*part\s*\d+$", "", label, flags=re.IGNORECASE)
                return _normalize(label)
        return _normalize(name)

    comp_labels = {c: comp_label(c) for c in comprovante_paths}

    for vp in verif_paths:
        vlabel = verif_label(vp)
        if not vlabel:
            continue
        # Encontrar o comprovante com melhor match
        best_comp = None
        best_score = 0
        for cp, clabel in comp_labels.items():
            score = fuzz.token_sort_ratio(vlabel, clabel)
            if score > best_score:
                best_score = score
                best_comp  = cp
        if best_comp and best_score >= FUZZY_THRESHOLD:
            assoc[best_comp].append(vp)

    return assoc


# ── Comparação de métricas ──────────────────────────────────────────────────────
def _pct_diff(comp: int | float, consol: int | float) -> float | None:
    """Diferença percentual (comp - consol) / consol. None se consol == 0."""
    if not consol:
        return None
    return (comp - consol) / consol * 100


def _fmt_num(n: int | float) -> str:
    return f"{int(n):,}".replace(",", ".")


def _compare(consol_row: dict, parser_result: dict) -> tuple[str, list[str]]:
    """
    Compara métricas de uma linha do consolidado com o resultado do parser.

    Retorna: (status, linhas_devolutiva)
    status: "OK" | "DIVERGENCIA"
    """
    divergencias: list[str] = []

    # ── Entregue ──────────────────────────────────────────────────────────────
    comp_entregue   = parser_result.get("entregue", 0) or 0
    consol_entregue = consol_row.get("entregue", 0) or 0

    pct = _pct_diff(comp_entregue, consol_entregue)
    if pct is not None and abs(pct) > ENTREGUE_TOL_PCT:
        divergencias.append(
            f"DIV entregue: comprovante {_fmt_num(comp_entregue)} / "
            f"consolidado {_fmt_num(consol_entregue)} ({pct:+.1f}%)"
        )

    # ── Indevidas ─────────────────────────────────────────────────────────────
    comp_indev   = parser_result.get("indevidas", {})
    consol_indev = consol_row.get("indevidas", {})

    for cat, consol_val in consol_indev.items():
        comp_val = comp_indev.get(cat, 0)
        if comp_val != consol_val:
            divergencias.append(
                f"DIV {cat}: comprovante {_fmt_num(comp_val)} / "
                f"consolidado {_fmt_num(consol_val)}"
            )

    if divergencias:
        return "DIVERGENCIA", divergencias

    # OK — linha informativa
    entregue_info = _fmt_num(comp_entregue)
    pct_str = f"{pct:+.1f}%" if pct is not None else "n/a"
    return "OK", [f"OK — entregue {entregue_info} ({pct_str})"]


# ── Engine principal ────────────────────────────────────────────────────────────
def verificar(
    consolidado_path: str,
    files: list[str],
    data_ini: date | None = None,
    data_fim: date | None = None,
    output_path: str | None = None,
) -> dict:
    """
    Verifica um consolidado contra seus comprovantes.

    consolidado_path — arquivo xlsx no padrão do template (28 colunas)
    files            — lista de arquivos: comprovantes + arquivos Verification - *.xlsx
                       (serão separados automaticamente por nome de arquivo)
    data_ini / data_fim — filtro de período (opcional)
    output_path      — caminho de saída; padrão: <nome>_verificado.xlsx

    Retorna dict com:
      {
        "output":      str,           # path do arquivo gerado
        "veiculos":    list[dict],    # resultado por veículo
        "sem_comprovante": list[str], # veículos do consolidado sem comprovante
        "sem_consolidado": list[str], # veículos do comprovante sem entrada no consolidado
      }
    """
    # ── Separar comprovantes de verif files ───────────────────────────────────
    comp_paths  = [f for f in files if not _is_verif_file(f)]
    verif_paths = [f for f in files if _is_verif_file(f)]

    # ── Parear verif → comprovante ────────────────────────────────────────────
    verif_assoc = _associate_verif(comp_paths, verif_paths)

    # ── Parsear todos os comprovantes ─────────────────────────────────────────
    # Importar do mesmo diretório
    sys.path.insert(0, str(Path(__file__).parent / "parsers"))
    from parser_auto import parse as auto_parse  # noqa: E402

    parser_results: list[dict] = []
    parse_errors:   list[dict] = []

    for cp in comp_paths:
        vp_list = verif_assoc.get(cp, [])
        try:
            results = auto_parse(cp, verif_paths=vp_list or None, data_ini=data_ini, data_fim=data_fim)
            parser_results.extend(results)
        except Exception as e:
            parse_errors.append({"arquivo": Path(cp).name, "erro": str(e)})

    # ── Ler consolidado ───────────────────────────────────────────────────────
    wb = openpyxl.load_workbook(consolidado_path)
    ws = wb.active

    consol_rows = _read_consolidado(ws)

    # ── Match fuzzy veículo-a-veículo ─────────────────────────────────────────
    # Construir índice de parser_results por nome normalizado
    parser_norm = {_normalize(r["veiculo"]): r for r in parser_results}
    parser_names = list(parser_norm.keys())

    resultado_veiculos: list[dict] = []
    matched_parser_names: set[str] = set()

    for crow in consol_rows:
        consol_norm = _normalize(crow["veiculo"])
        match_result = None
        match_score  = 0

        if parser_names:
            best = process.extractOne(
                consol_norm, parser_names,
                scorer=fuzz.token_set_ratio,
                score_cutoff=FUZZY_THRESHOLD,
            )
            if best:
                match_result = parser_norm[best[0]]
                match_score  = best[1]
                matched_parser_names.add(best[0])

        if match_result is None:
            # Sem comprovante correspondente
            devolutiva = "PENDENTE: comprovante nao localizado"
            status = "PENDENTE"
            resultado_veiculos.append({
                "veiculo":   crow["veiculo"],
                "status":    status,
                "devolutiva": devolutiva,
                "match":     None,
                "score":     0,
            })
        else:
            status, linhas = _compare(crow, match_result)
            devolutiva = "\n".join(linhas)
            resultado_veiculos.append({
                "veiculo":   crow["veiculo"],
                "status":    status,
                "devolutiva": devolutiva,
                "match":     match_result["veiculo"],
                "score":     match_score,
                "formato":   match_result.get("formato_detectado"),
            })

        # Escrever na coluna Devolutiva BI SECOM
        ws.cell(row=crow["row_idx"], column=COL_DEVOLUTIVA_BI).value = devolutiva

    # ── Veículos do comprovante sem entrada no consolidado ────────────────────
    sem_consolidado = [
        parser_results[i]["veiculo"]
        for i, pname in enumerate([_normalize(r["veiculo"]) for r in parser_results])
        if pname not in matched_parser_names
    ]

    # ── Salvar arquivo verificado ─────────────────────────────────────────────
    if output_path is None:
        p = Path(consolidado_path)
        output_path = str(p.parent / (p.stem + "_verificado" + p.suffix))

    wb.save(output_path)
    wb.close()

    return {
        "output":           output_path,
        "veiculos":         resultado_veiculos,
        "sem_comprovante":  [r["veiculo"] for r in resultado_veiculos if r["status"] == "PENDENTE"],
        "sem_consolidado":  sem_consolidado,
        "parse_errors":     parse_errors,
    }


# ── CLI ─────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Engine de verificação de consolidados SECOM")
    ap.add_argument("consolidado",  help="Consolidado .xlsx (template 28 colunas)")
    ap.add_argument("files", nargs="+",
                    help="Arquivos de comprovante + Verification - *.xlsx (misturados)")
    ap.add_argument("--ini", default=None, metavar="DD/MM/YYYY")
    ap.add_argument("--fim", default=None, metavar="DD/MM/YYYY")
    ap.add_argument("--output", default=None, metavar="PATH",
                    help="Caminho de saída (padrão: <consolidado>_verificado.xlsx)")
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
        resultado = verificar(
            args.consolidado,
            args.files,
            data_ini=_cli_date(args.ini),
            data_fim=_cli_date(args.fim),
            output_path=args.output,
        )
        # Exibir resumo
        print(f"\nArquivo gerado: {resultado['output']}")
        print(f"\n{'VEÍCULO':<35} {'STATUS':<12} {'MATCH':<35} {'SCORE':>5}")
        print("-" * 90)
        for v in resultado["veiculos"]:
            print(f"{v['veiculo']:<35} {v['status']:<12} {str(v.get('match') or ''):<35} {v.get('score',0):>5.0f}")
        if resultado["sem_consolidado"]:
            print(f"\nComprovante sem consolidado ({len(resultado['sem_consolidado'])}):")
            for n in resultado["sem_consolidado"]:
                print(f"  - {n}")
        if resultado["parse_errors"]:
            print(f"\nErros de parse ({len(resultado['parse_errors'])}):")
            for e in resultado["parse_errors"]:
                print(f"  - {e['arquivo']}: {e['erro']}")
        # JSON completo
        print("\n" + json.dumps(resultado, indent=2, ensure_ascii=False, default=str))
    except Exception as e:
        print(json.dumps({"erro": str(e)}, indent=2, ensure_ascii=False))
        sys.exit(1)
