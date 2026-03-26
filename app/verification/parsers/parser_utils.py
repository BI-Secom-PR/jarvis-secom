"""
Utilitários compartilhados pelos parsers de verification/comprovante.
"""

from datetime import date, datetime


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
    return None


def col_index(header: list[str], *names: str) -> int | None:
    """Índice (0-based) da primeira coluna cujo nome (case-insensitive) está em names."""
    names_lower = {n.lower() for n in names}
    for i, h in enumerate(header):
        if h.lower() in names_lower:
            return i
    return None


def cli_date(s: str | None) -> date | None:
    if not s:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None
