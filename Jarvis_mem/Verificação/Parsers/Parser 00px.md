---
title: Parser 00px
tags:
  - verificacao
  - parser
  - 00px
---

# Parser 00px

**Arquivo:** `app/verification/parsers/parser_00px.py`

## Características

- Multi-sheet: CPM + CPC + CPV numa mesma pasta
- Viewability: VA (IAB)
- Arquivo de verification tem **layout multi-seção**

## Layout Multi-Seção do Arquivo de Verification

```
Row 8  → cabeçalho de seções
Row 10 → cabeçalho de colunas

Três seções na mesma sheet:
  IMPRESSÕES | CPM  →  col "Impressões"  (apenas linhas CPM)
  CLIQUES    | CPC  →  col "Cliques"
  VISUALIZAÇÕES | CPV → col "Views"     (apenas linhas CPV)
```

`parse_verif` lê: `impressoes = Impressões OR Views` (usa o que não for zero).
Isso garante que veículos CPV (ex.: Teads) tenham indevidas contadas corretamente.

> [!warning] Múltiplos Placement IDs
> Se o arquivo contiver múltiplos Placement IDs (ex: 152077 + 152078), os totais de indevidas somam TODOS.
> Se o consolidado reflete apenas um deles → agência deve fornecer arquivo filtrado por placement.

## Subtotais no Comprovante

O comprovante contém subtotais com label na **coluna Data** (não na coluna Veículo):
- `#TOTAL POR VEÍCULO`
- `#TOTAL POR CANAL`

**Fix:** parser descarta qualquer linha onde a coluna Data tem valor mas não é parseável como data.
Isso evita dupla contagem independente do filtro de período.

## CPV — Coluna de Entrega

Para linhas CPV, a coluna "Views" = total de plays = col 5 (Impressões) do consolidado.
O parser CPV lê a coluna "Views" como métrica de entrega (não como views completos).

## Bugs Corrigidos

| Data | Bug | Fix |
|---|---|---|
| Mar/2026 | Subtotais bypassavam date filter → dupla contagem | Descarta linhas com Data não parseável |
| Mar/2026 | CPV lendo coluna errada (Impressões em vez de Views) | parse_verif usa `Impressões OR Views` |

---

Ver também: [[Fluxo de Verificação]] · [[Parser METRIKE]]
