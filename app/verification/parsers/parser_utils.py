"""
Utilitários compartilhados pelos parsers de verification/comprovante.
"""

import random
import re
from datetime import date, datetime
from pathlib import Path

import fastxlsx
import openpyxl


def load_workbook_fast(path: str, read_only: bool = True):
    """Loads an xlsx workbook via calamine (Rust, ~10-50x faster than openpyxl
    on large sheets — verification files can be 10-20MB+ and were hitting
    Vercel's 300s cap under openpyxl). Falls back to openpyxl if calamine
    can't parse the file."""
    try:
        return fastxlsx.load_workbook(path)
    except Exception:
        pass
    return openpyxl.load_workbook(path, read_only=read_only, data_only=True)


def to_int(v) -> int:
    if v is None:
        return 0
    try:
        return int(float(str(v).replace(",", ".")))
    except (ValueError, TypeError):
        return 0


def to_float(v) -> float | None:
    if v is None:
        return None
    try:
        return float(str(v).replace(",", ".").replace("%", "").strip())
    except (ValueError, TypeError):
        return None


def parse_date(v) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        s = v.strip()
        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
            try:
                return datetime.strptime(s[:10], fmt).date()
            except ValueError:
                pass
    # Excel serial number stored as float (openpyxl returns raw float for unformatted date cells)
    if isinstance(v, (int, float)) and 1 < float(v) < 2958466:
        try:
            from openpyxl.utils.datetime import from_excel
            result = from_excel(float(v))
            return result.date() if isinstance(result, datetime) else result
        except Exception:
            pass
    return None


def col_index(header: list[str], *names: str) -> int | None:
    """Índice (0-based) da coluna cujo nome (case-insensitive) bate com o primeiro
    candidato de `names` presente no header — a ORDEM de `names` é prioridade.
    Importa quando o header tem mais de uma coluna candidata ao mesmo tempo (ex.:
    "Total de impressões" e "Impressões válidas" na mesma planilha SENSE V1) —
    antes a prioridade era por posição da coluna, não pela ordem dos candidatos,
    o que fazia colunas de fallback "vencerem" a preferida quando vinham antes
    no header."""
    header_lower = [h.lower() for h in header]
    for name in names:
        name_lower = name.lower()
        for i, h in enumerate(header_lower):
            if h == name_lower:
                return i
    return None


def parse_comprovante_cm360(ws, formato: str) -> dict | None:
    """
    Extrai o total de UM veículo de uma planilha de comprovante CM360/DFA
    (usado por DGBRASIL — um veículo por arquivo — e TERATECH — um por aba).

    Layout: metadados nas linhas 1-6, header na linha 8, dados a partir da 9.
    As linhas de total têm "Data" = "-"; há uma por Package e, no fim, o total
    geral do veículo com "Package" = "-" (bate com "Impressoes/Unidades
    Entregues" do cabeçalho na linha 5) e o veículo escrito como "<Nome> Total".
    Pegar o primeiro "Data" = "-" pegaria só o primeiro package — ex.: TERATECH
    Claro Ads tem 3 packages (1.767.981 no 1º vs 4.836.462 no total); DGBRASIL
    Sou + Favela tem 5. Sem nenhuma linha "Package" = "-" cai na primeira linha
    de total (aba de package único).

    Duas variantes de coluna: display/CPM (14 cols) e vídeo/CPV (19 cols, com
    Video Plays/Quartis/Completions). "Views" no consolidado = Video Completions.

    Retorna None quando a planilha não tem o layout de comprovante.
    """
    header = [str(v).strip() if v is not None else "" for v in
              next(ws.iter_rows(min_row=8, max_row=8, values_only=True), [])]
    if not header:
        return None

    i_veiculo     = col_index(header, "Veiculo", "Veículo")
    i_data        = col_index(header, "Data")
    i_package     = col_index(header, "Package")
    i_contratado  = col_index(header, "Contratado")
    i_impressoes  = col_index(header, "Impressoes", "Impressões")
    i_cliques     = col_index(header, "Cliques")
    i_viewable    = col_index(header, "Active View: Viewable Impressions")
    i_viewability = col_index(header, "Active View: % Viewable Impressions")
    i_completions = col_index(header, "Video Completions")

    if i_veiculo is None or i_impressoes is None or i_data is None:
        return None

    is_cpv = i_completions is not None

    totais = [
        row for row in ws.iter_rows(min_row=9, values_only=True)
        if not all(v is None for v in row)
        and i_data < len(row) and str(row[i_data]).strip() == "-"
        and row[i_veiculo] and str(row[i_veiculo]).strip()
    ]
    geral = None
    if i_package is not None:
        geral = next(
            (r for r in totais
             if i_package < len(r) and str(r[i_package]).strip() == "-"),
            None,
        )
    row = geral or (totais[0] if totais else None)
    if row is None:
        return None

    veiculo = str(row[i_veiculo]).strip()
    if veiculo.lower().endswith(" total"):
        veiculo = veiculo[:-6].strip()

    va = to_float(row[i_viewability]) if i_viewability is not None else None

    return {
        "veiculo":           veiculo,
        "tipo_compra":       "CPV" if is_cpv else "CPM",
        "contratado":        to_int(row[i_contratado]) or None if i_contratado is not None else None,
        "entregue":          to_int(row[i_impressoes]),
        "views":             to_int(row[i_completions]) if is_cpv else None,
        "cliques":           to_int(row[i_cliques]) or None if i_cliques is not None else None,
        "viewables":         to_int(row[i_viewable]) or None if i_viewable is not None else None,
        "viewability":       round(va * 100, 2) if va is not None and va <= 1.0 else va,
        "indevidas":         {},
        "url_sample":        [],
        "formato_detectado": formato,
    }


def cli_date(s: str | None) -> date | None:
    if not s:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def vehicle_from_filename(filepath: str) -> str:
    """
    Inferência simples de veículo via nome do arquivo.
    Prioriza o último segmento após " - " e remove sufixos comuns.
    """
    stem = Path(filepath).stem.strip()
    if " - " in stem:
        candidate = stem.split(" - ")[-1].strip()
    else:
        candidate = stem
    candidate = re.sub(r"\b(comprovante|verification|verificacao|relatorio)\b", "", candidate, flags=re.IGNORECASE)
    candidate = re.sub(r"\s+", " ", candidate).strip(" _-")
    return candidate or stem


class UrlAggregator:
    """
    Soma impressões por (veículo, categoria, url) enquanto as linhas são lidas.

    Substitui o reservoir sampling que existia aqui. O engine seleciona as URLs
    por *share*: uma URL entra na auditoria se sozinha representa X% do total de
    impressões do seu grupo (veículo, categoria). Isso exige o total real do
    grupo e a impressão real de cada URL — uma amostra aleatória não consegue
    dar nenhum dos dois. Medido nos 29 verifs SENSE: o reservoir de 10k/arquivo
    mostrava 256.604 de 3.478.850 linhas (7,4%).

    Agregar também é o que torna o volume tratável: as mesmas 3,48M linhas
    colapsam em 1,49M chaves distintas, e o engine já deduplicava por esta
    mesma chave depois — agora não precisa.

    URLs de esquema app:// são descartadas: não são páginas auditáveis (a IA
    não tem o que ler nelas) e dominam o topo dos grupos — 9 delas carregam
    40,5M impressões nos arquivos SENSE.
    """

    # ponytail: teto de segurança contra um verif patológico, não uma regra de
    # negócio — o maior veículo real (R7 PORTAL) dá 209.470 chaves ≈ 45MB.
    # Se estourar, a agregação para de aceitar chaves novas mas continua somando
    # nas existentes. Subir se algum adserver legítimo bater no limite.
    MAX_DISTINCT = 500_000

    def __init__(self) -> None:
        self._items: dict[tuple[str, str, str], dict] = {}
        self.dropped = 0

    def add(self, veiculo: str, categoria: str, url: str,
            impressoes: int, cpm: int | None = None, cpv: int | None = None) -> None:
        if not url or url.startswith("app://"):
            return
        key = (veiculo, categoria, url)
        entry = self._items.get(key)
        if entry is None:
            if len(self._items) >= self.MAX_DISTINCT:
                self.dropped += 1
                return
            entry = {"url": url, "categoria": categoria, "veiculo": veiculo, "impressoes": 0}
            if cpm is not None:
                entry["cpm"] = 0
            if cpv is not None:
                entry["cpv"] = 0
            self._items[key] = entry
        entry["impressoes"] += impressoes or 0
        if cpm is not None:
            entry["cpm"] = (entry.get("cpm") or 0) + cpm
        if cpv is not None:
            entry["cpv"] = (entry.get("cpv") or 0) + cpv

    def items(self) -> list[dict]:
        return list(self._items.values())
