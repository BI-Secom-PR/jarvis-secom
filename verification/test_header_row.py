#!/usr/bin/env python3
"""Self-check: consolidado exportado SEM as 6 linhas de metadados do template
(header na linha 2, dados na 3) — caso real "Consolidado Agência - 27-08.xlsx".
Antes de _find_header_row(), o engine lia header fixo na linha 8 e dados da 9
em diante: nenhuma linha era encontrada e todo veículo caía em
"sem entrada no consolidado".

Uso:  python3 verification/test_header_row.py
"""
import sys
import os

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "app", "verification"))
sys.path.insert(0, os.path.join(HERE, "..", "app", "verification", "parsers"))

from engine import _read_consolidado  # noqa: E402

HEADER = ["Veículo", "Praça", "Objetivo de Mídia", "Contratado", "Impressões",
          "% Entregue", "Cliques", "CTR", "Views"]
LINHA = ["Teads", "SP", "CPV", 210148, 360162, 1.71, 599, 0.0016, 360162]


def _ws(linhas_antes: int):
    """Consolidado com N linhas em branco antes do header."""
    wb = openpyxl.Workbook()
    ws = wb.active
    for _ in range(linhas_antes):
        ws.append([])
    ws.append(HEADER)
    ws.append(LINHA)
    return ws


def main() -> None:
    # header na linha 2 (sem metadados) e na linha 8 (template) → mesmo resultado
    for antes, header_row in ((1, 2), (7, 8)):
        rows, _ = _read_consolidado(_ws(antes))
        assert len(rows) == 1, f"header linha {header_row}: {len(rows)} linhas lidas, esperado 1"
        assert rows[0]["veiculo"] == "Teads", rows[0]
        assert rows[0]["entregue"] == 360162, rows[0]
        assert rows[0]["row_idx"] == header_row + 1, rows[0]

    print("OK — header do consolidado localizado nas linhas 2 e 8.")


if __name__ == "__main__":
    main()
