"""Read-only xlsx loading via python-calamine (Rust) — ~10-50x faster than
openpyxl on large sheets. Exposes only the openpyxl surface the parsers use:
wb.worksheets / wb.close() / ws.title / ws.iter_rows(values_only=True).

ponytail: only parser_sense uses this (the one that hit Vercel's 300s cap);
convert other parsers if they start timing out too.
"""

from python_calamine import CalamineWorkbook


class FastSheet:
    def __init__(self, title: str, rows: list[list]):
        self.title = title
        # Normalize to openpyxl semantics: rectangular rows, empty cell = None.
        width = max((len(r) for r in rows), default=0)
        self._rows = [
            tuple(None if v == "" else v for v in r) + (None,) * (width - len(r))
            for r in rows
        ]

    def iter_rows(self, min_row=1, max_row=None, max_col=None, values_only=True):
        for row in self._rows[min_row - 1 : max_row]:
            yield row[:max_col] if max_col else row


class FastWorkbook:
    def __init__(self, path):
        wb = CalamineWorkbook.from_path(str(path))
        # skip_empty_area=False keeps leading empty rows — parsers detect
        # headers by absolute row position.
        self.worksheets = [
            FastSheet(name, wb.get_sheet_by_name(name).to_python(skip_empty_area=False))
            for name in wb.sheet_names
        ]

    def close(self):
        pass


def load_workbook(path) -> FastWorkbook:
    return FastWorkbook(path)
