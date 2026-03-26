"""
Engine de comparação do Sistema de Verificação SECOM.

Fluxo:
  1. Lê o consolidado (template 29 colunas) via openpyxl
  2. Separa os arquivos em 2 grupos (pelo nome do arquivo):
       a) "comprovante" → valores de entrega (impressões, cliques, viewables)
       b) "verification" → categorias indevidas + URL por linha (adserver)
  3. Faz match fuzzy entre veículos do consolidado e resultados dos parsers
  4. Compara métricas:
       - entregue/cliques/viewables → vs comprovante
       - categorias indevidas       → vs verification
  5. Escreve devolutiva na coluna 28 (Devolutiva BI SECOM) do consolidado
  6. Salva como <nome>_verificado.xlsx (não sobrescreve o original)

Regras de divergência:
  - Entregue: |comp − consol| / consol > 2% → flaggar
  - Cada categoria indevida: verif ≠ consol → flaggar
  - Veículo no consolidado sem comprovante E sem verification → PENDENTE
  - Arquivo sem veículo no consolidado → avisado mas não grava

Colunas do consolidado (1-indexed, template 29 colunas):
  1=Veículo  3=Tipo  4=Contratado  5=Impressões  7=Cliques  9=Views
  11=Viewables  12=Viewability
  14=Conteúdo Sensível  15–22=indevidas individuais
  28=Devolutiva BI SECOM  29=Devolutiva Agência
"""

import importlib
import sys
import json
import unicodedata
import re
import random
from collections import defaultdict
from datetime import date
from pathlib import Path

import openpyxl
from rapidfuzz import fuzz, process

sys.path.insert(0, str(Path(__file__).parent / "parsers"))

# ── Registro de parsers por adserver ───────────────────────────────────────────
PARSER_MAP: dict[str, str] = {
    "00px":     "parser_00px",
    "adforce":  "parser_adforce",
    "admotion": "parser_admotion",
    "ahead":    "parser_ahead",
    "metrike":  "parser_metrike",
    "brz":      "parser_brz",
}

# ── Constantes ─────────────────────────────────────────────────────────────────
FUZZY_THRESHOLD  = 85     # % mínimo para aceitar match de veículo
HEADER_ROW       = 8      # linha 1-indexed do cabeçalho no template
DATA_START_ROW   = 9      # primeira linha de dados (1-indexed)

# Mapeamento col_index(1-based) → chave interna  [template 29 colunas]
COL_VEICULO        = 1
COL_PRACA          = 2
COL_TIPO_COMPRA    = 3
COL_CONTRATADO     = 4
COL_IMPRESSOES     = 5
COL_CLIQUES        = 7
COL_VIEWS          = 9
COL_VIEWABLES      = 11
COL_VIEWABILITY    = 12
COL_ENTREGAS_VAL   = 13
COL_INDEVIDAS = {
    "conteudo_sensivel":  14,   # novo — Conteúdo Sensível (agregado)
    "acidente":           15,
    "violencia":          16,
    "lingua_estrangeira": 17,
    "pornografia":        18,
    "safeframe":          19,
    "app_movel":          20,
    "teste_tag":          21,
    "nao_classificado":   22,
}
COL_DEVOLUTIVA_BI      = 28   # era 27
COL_DEVOLUTIVA_AGENCIA = 29   # era 28
COL_URL_INFO           = 30   # novo — levantamento IA de URLs indevidas


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

        # Normaliza viewability do consolidado: Excel armazena como decimal (0.7166 = 71.66%)
        va_raw = _to_float_safe(_cell_value(ws, row_idx, COL_VIEWABILITY))
        if va_raw is not None:
            viewability_val = round(va_raw * 100, 2) if va_raw <= 1.0 else round(va_raw, 2)
        else:
            viewability_val = None

        rows.append({
            "row_idx":    row_idx,
            "veiculo":    str(veiculo).strip(),
            "tipo_compra": tipo or None,
            "contratado": _to_int_safe(_cell_value(ws, row_idx, COL_CONTRATADO)),
            "entregue":   entregue,
            "cliques":    _to_int_safe(_cell_value(ws, row_idx, COL_CLIQUES)),
            "viewables":  _to_int_safe(_cell_value(ws, row_idx, COL_VIEWABLES)),
            "viewability": viewability_val,
            "indevidas":  indevidas,
        })

    return rows


def _add_optional(a: int | None, b: int | None) -> int | None:
    """Soma dois valores opcionais; retorna None somente se ambos forem None."""
    if a is None and b is None:
        return None
    return (a or 0) + (b or 0)


def _fuzzy_match(consol_norm: str, name_list: list[str], norm_dict: dict) -> tuple[dict | None, int]:
    """Retorna (result_dict, score) do melhor match fuzzy, ou (None, 0) se abaixo do threshold."""
    if not name_list:
        return None, 0
    best = process.extractOne(
        consol_norm, name_list,
        scorer=fuzz.token_set_ratio,
        score_cutoff=FUZZY_THRESHOLD,
    )
    if best:
        return norm_dict[best[0]], best[1]
    return None, 0


def _merge_by_veiculo(results: list[dict]) -> dict[str, dict]:
    """
    Agrupa e soma resultados de múltiplos arquivos do mesmo veículo.
    Retorna dict: {nome_normalizado: dict_merged}
    """
    merged: dict[str, dict] = {}
    for r in results:
        key = _normalize(r["veiculo"])
        if key not in merged:
            merged[key] = dict(r)
            merged[key]["indevidas"] = dict(r.get("indevidas", {}))
        else:
            m = merged[key]
            m["entregue"]  = (m.get("entregue") or 0) + (r.get("entregue") or 0)
            m["cliques"]   = _add_optional(m.get("cliques"),   r.get("cliques"))
            m["viewables"] = _add_optional(m.get("viewables"), r.get("viewables"))
            for cat, val in r.get("indevidas", {}).items():
                m["indevidas"][cat] = m["indevidas"].get(cat, 0) + val
    return merged


# ── Comparação de métricas ──────────────────────────────────────────────────────
def _fmt_num(n: int | float) -> str:
    return f"{int(n):,}".replace(",", ".")


def _compare(
    consol_row: dict,
    comp_result: dict | None,
    verif_result: dict | None,
) -> tuple[str, list[str]]:
    """
    Compara métricas de uma linha do consolidado com comprovante e verification.
    Retorna todas as linhas de devolutiva (OK e DIV) para rastreabilidade completa.

    Retorna: (status, linhas_devolutiva)
    status: "OK" | "DIVERGENCIA"
    """
    tem_divergencia = False
    linhas: list[str] = []

    # ── Campos do comprovante ─────────────────────────────────────────────────
    if comp_result is not None:
        for campo in ("entregue", "cliques", "viewables"):
            comp_val   = comp_result.get(campo) or 0
            consol_val = consol_row.get(campo)  or 0
            if comp_val == 0:
                continue  # sem dado no comprovante — não gera falso DIV
            if comp_val != consol_val:
                linhas.append(
                    f"DIV {campo}: comprovante {_fmt_num(comp_val)} / "
                    f"consolidado {_fmt_num(consol_val)}"
                )
                tem_divergencia = True
            else:
                linhas.append(f"OK {campo}: {_fmt_num(comp_val)}")

        comp_va   = comp_result.get("viewability")
        consol_va = consol_row.get("viewability")
        if comp_va is not None:
            if consol_va is not None and round(comp_va, 2) != round(consol_va, 2):
                linhas.append(
                    f"DIV viewability: comprovante {comp_va:.2f}% / "
                    f"consolidado {consol_va:.2f}%"
                )
                tem_divergencia = True
            else:
                ref = f"{consol_va:.2f}%" if consol_va is not None else "—"
                linhas.append(f"OK viewability: {comp_va:.2f}% (consolidado {ref})")

    # ── Indevidas ──────────────────────────────────────────────────────────────
    consol_indev = consol_row.get("indevidas", {})

    if verif_result is not None:
        verif_indev = verif_result.get("indevidas", {})
        indev_linhas: list[str] = []
        alguma_indevida_com_dado = False

        for cat, consol_val in consol_indev.items():
            comp_val = verif_indev.get(cat, 0)
            if comp_val == 0 and consol_val == 0:
                continue
            alguma_indevida_com_dado = True
            if comp_val != consol_val:
                indev_linhas.append(
                    f"DIV {cat}: verif. {_fmt_num(comp_val)} / "
                    f"consolidado {_fmt_num(consol_val)}"
                )
                tem_divergencia = True
            else:
                indev_linhas.append(f"OK {cat}: {_fmt_num(consol_val)}")

        if not alguma_indevida_com_dado:
            indev_linhas.append("OK indevidas: todas zeradas")

        linhas.extend(indev_linhas)
    else:
        linhas.append("? indevidas: sem arquivo de verification")

    if not linhas:
        entregue = (comp_result or {}).get("entregue") or 0
        if entregue > 0:
            return "OK", [f"OK — entregue {_fmt_num(entregue)}"]
        return "OK", ["OK — sem dados para comparar"]

    return ("DIVERGENCIA" if tem_divergencia else "OK"), linhas


# ── Engine principal ────────────────────────────────────────────────────────────
def verificar(
    consolidado_path: str,
    adserver: str,
    comp_paths: list[str],
    verif_paths: list[str],
    data_ini: date | None = None,
    data_fim: date | None = None,
    output_path: str | None = None,
) -> dict:
    """
    Verifica um consolidado contra comprovantes e arquivos de verification.

    consolidado_path — arquivo xlsx no padrão do template (29 colunas)
    adserver         — identificador do adserver (ex.: "adforce", "admotion")
    comp_paths       — arquivos de comprovante de entrega
    verif_paths      — arquivos de verification de URL (opcional)
    data_ini / data_fim — filtro de período (opcional)
    output_path      — caminho de saída; padrão: <nome>_verificado.xlsx

    Retorna dict com:
      {
        "output":           str,
        "veiculos":         list[dict],
        "sem_comprovante":  list[str],
        "sem_consolidado":  list[str],
        "parse_errors":     list[dict],
        "url_sample":       list[dict],
      }
    """
    if adserver not in PARSER_MAP:
        raise ValueError(
            f"Adserver '{adserver}' não reconhecido. "
            f"Opções: {', '.join(PARSER_MAP)}"
        )

    mod = importlib.import_module(PARSER_MAP[adserver])
    parse_comp  = mod.parse_comprovante
    parse_verif = mod.parse_verif

    parse_errors: list[dict] = []

    # ── Parsear verification files ─────────────────────────────────────────────
    verif_raw: list[dict] = []
    url_pool: list[dict] = []

    for vp in verif_paths:
        try:
            results = parse_verif(vp, data_ini=data_ini, data_fim=data_fim)
            veiculos_encontrados = [r["veiculo"] for r in results]
            print(
                f"[verif] {Path(vp).name}: {len(results)} veículos"
                f" → {veiculos_encontrados}"
                f" | filtro: {data_ini}–{data_fim}",
                file=sys.stderr,
            )
            verif_raw.extend(results)
            for r in results:
                url_pool.extend(r.pop("url_sample", []))
        except Exception as e:
            print(f"[verif] ERRO {Path(vp).name}: {e}", file=sys.stderr)
            parse_errors.append({"arquivo": Path(vp).name, "erro": str(e)})

    # ── Parsear comprovante files ──────────────────────────────────────────────
    comp_raw: list[dict] = []

    for cp in comp_paths:
        try:
            comp_raw.extend(parse_comp(cp, data_ini=data_ini, data_fim=data_fim))
        except Exception as e:
            parse_errors.append({"arquivo": Path(cp).name, "erro": str(e)})

    # ── Amostra de URLs: 5% por categoria indevida, cap global de 200 ───────
    # Parsers devolvem o pool completo (reservoir ≤ 500); amostragem feita aqui.
    if url_pool:
        by_cat: dict[str, list] = defaultdict(list)
        for item in url_pool:
            by_cat[item["categoria"]].append(item)
        url_sample: list[dict] = []
        for items in by_cat.values():
            n = max(1, len(items) // 20)
            url_sample.extend(random.sample(items, min(n, len(items))))
        if len(url_sample) > 200:
            url_sample = random.sample(url_sample, 200)
    else:
        url_sample = []

    # ── Índices por veículo normalizado (somando múltiplos arquivos) ──────────
    verif_norm  = _merge_by_veiculo(verif_raw)
    comp_norm   = _merge_by_veiculo(comp_raw)
    verif_names = list(verif_norm.keys())
    comp_names  = list(comp_norm.keys())

    # ── Ler consolidado ───────────────────────────────────────────────────────
    wb = openpyxl.load_workbook(consolidado_path)
    ws = wb.active
    try:
        consol_rows = _read_consolidado(ws)

        # ── Match fuzzy veículo-a-veículo ─────────────────────────────────────
        resultado_veiculos: list[dict] = []
        matched_verif_names: set[str] = set()
        matched_comp_names:  set[str] = set()

        for crow in consol_rows:
            consol_norm = _normalize(crow["veiculo"])

            verif_match, verif_score = _fuzzy_match(consol_norm, verif_names, verif_norm)
            comp_match,  comp_score  = _fuzzy_match(consol_norm, comp_names,  comp_norm)

            if verif_match:
                matched_verif_names.add(_normalize(verif_match["veiculo"]))
            if comp_match:
                matched_comp_names.add(_normalize(comp_match["veiculo"]))

            if verif_match is None and comp_match is None:
                devolutiva = "PENDENTE: comprovante/verification nao localizado"
                status = "PENDENTE"
                match_name = None
                score = 0
            else:
                status, linhas = _compare(crow, comp_match, verif_match)
                devolutiva = "\n".join(linhas)
                match_name = (verif_match or comp_match or {}).get("veiculo")
                score = verif_score or comp_score

            resultado_veiculos.append({
                "veiculo":    crow["veiculo"],
                "status":     status,
                "devolutiva": devolutiva,
                "match":      match_name,
                "score":      score,
                "formato":    (verif_match or {}).get("formato_detectado"),
            })

            ws.cell(row=crow["row_idx"], column=COL_DEVOLUTIVA_BI).value = devolutiva

        # ── Veículos sem entrada no consolidado ──────────────────────────────
        sem_consolidado: list[str] = []
        seen: set[str] = set()
        for norm, r in verif_norm.items():
            if norm not in matched_verif_names:
                name = r["veiculo"]
                if name not in seen:
                    sem_consolidado.append(name)
                    seen.add(name)
        for norm, r in comp_norm.items():
            if norm not in matched_comp_names:
                name = r["veiculo"]
                if name not in seen:
                    sem_consolidado.append(name)
                    seen.add(name)

        # ── Salvar arquivo verificado ─────────────────────────────────────────
        if output_path is None:
            p = Path(consolidado_path)
            output_path = str(p.parent / (p.stem + "_verificado" + p.suffix))

        wb.save(output_path)
    finally:
        wb.close()

    return {
        "output":           output_path,
        "veiculos":         resultado_veiculos,
        "sem_comprovante":  [r["veiculo"] for r in resultado_veiculos if r["status"] == "PENDENTE"],
        "sem_consolidado":  sem_consolidado,
        "parse_errors":     parse_errors,
        "url_sample":       url_sample,
    }


# ── CLI ─────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Engine de verificação de consolidados SECOM")
    ap.add_argument("consolidado",  help="Consolidado .xlsx (template 29 colunas)")
    ap.add_argument("--adserver", required=True,
                    choices=list(PARSER_MAP.keys()),
                    help="Adserver dos arquivos (ex.: adforce, admotion)")
    ap.add_argument("--comp", nargs="+", default=[],
                    metavar="ARQUIVO", help="Arquivo(s) de comprovante de entrega")
    ap.add_argument("--verif", nargs="*", default=[],
                    metavar="ARQUIVO", help="Arquivo(s) de verification de URL (opcional)")
    ap.add_argument("--ini", default=None, metavar="DD/MM/YYYY")
    ap.add_argument("--fim", default=None, metavar="DD/MM/YYYY")
    ap.add_argument("--output", default=None, metavar="PATH",
                    help="Caminho de saída (padrão: <consolidado>_verificado.xlsx)")
    args = ap.parse_args()

    from parser_utils import cli_date  # noqa: E402

    try:
        resultado = verificar(
            args.consolidado,
            args.adserver,
            args.comp,
            args.verif or [],
            data_ini=cli_date(args.ini),
            data_fim=cli_date(args.fim),
            output_path=args.output,
        )
        # Resumo legível → stderr (não polui o JSON que o Node.js consome)
        print(f"\nArquivo gerado: {resultado['output']}", file=sys.stderr)
        print(f"\n{'VEÍCULO':<35} {'STATUS':<12} {'MATCH':<35} {'SCORE':>5}", file=sys.stderr)
        print("-" * 90, file=sys.stderr)
        for v in resultado["veiculos"]:
            print(f"{v['veiculo']:<35} {v['status']:<12} {str(v.get('match') or ''):<35} {v.get('score',0):>5.0f}", file=sys.stderr)
        if resultado["sem_consolidado"]:
            print(f"\nComprovante sem consolidado ({len(resultado['sem_consolidado'])}):", file=sys.stderr)
            for n in resultado["sem_consolidado"]:
                print(f"  - {n}", file=sys.stderr)
        if resultado["parse_errors"]:
            print(f"\nErros de parse ({len(resultado['parse_errors'])}):", file=sys.stderr)
            for e in resultado["parse_errors"]:
                print(f"  - {e['arquivo']}: {e['erro']}", file=sys.stderr)
        # JSON puro → stdout (consumido pelo Node.js)
        print(json.dumps(resultado, ensure_ascii=False, default=str))
    except Exception as e:
        print(json.dumps({"erro": str(e)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
