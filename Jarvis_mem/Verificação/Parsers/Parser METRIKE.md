---
title: Parser METRIKE
tags:
  - verificacao
  - parser
  - metrike
---

# Parser METRIKE

**Arquivo:** `app/verification/parsers/parser_metrike.py`

## Características

- Sheet: `"Worksheet"`
- Linha `#TOTAL POR CAMPANHA` → valor de **contratado**
- Viewability: `viewables / impressões × 100`
- Comprovante contém subtotais por placement

## Subtotais no Comprovante

Label fica na **coluna Data** (não na coluna Veículo):
- `Total por placement_id`

**Fix:** parser descarta qualquer linha onde a coluna Data tem valor mas não é parseável como data.

## Detecção de Header (`_find_verif_header`)

- Exige `"categoria"` + variante de `"veículo"` na mesma linha (até row 25)
- **NÃO exige coluna "url"** — URL é enriquecimento opcional
- Arquivos sem coluna "Url" (ex: R7, UOL) são parseados normalmente

## Bugs Corrigidos

| Data | Bug | Fix |
|---|---|---|
| Mar/2026 | Date filter retornava todas as datas — subtotais com string na col Data bypassavam | Verificação `None` antes de tentar parse |
| Mar/2026 | Double-counting de subtotais por placement | Descarta linhas com Data não parseável |
| Mar/2026 | `lows` como lista incompatível com set intersection | Convertido `lows` para `set` na detecção de header |

---

Ver também: [[Fluxo de Verificação]] · [[Parser 00px]]
