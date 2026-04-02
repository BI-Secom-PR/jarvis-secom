---
title: Template 30 Colunas
tags:
  - verificacao
  - template
  - consolidado
---

# Template 30 Colunas — Consolidado SECOM

Arquivo gerado pelas agências: `TEMPLATE - Consolidado Verification.xlsx`

## Mapa de Colunas

| Col | Campo | Notas |
|---|---|---|
| 1 | ID / Linha | |
| 2 | Campanha | |
| 3 | Adserver | |
| 4 | Período | |
| 5 | Impressões (entregue) | **Métrica de entrega** — válida para CPM e CPV |
| 6 | Contratado | |
| 7 | Viewability (%) | Excel armazena decimal → normalizado se ≤ 1.0 |
| 8 | CPM | |
| 9 | Views (VTR numerador) | NÃO é entrega — é views completos para VTR |
| ... | ... | |
| 14 | Conteúdo Sensível | Agregado geral de indevidas |
| 15 | acidente | |
| 16 | violencia | |
| 17 | lingua_estrangeira | |
| 18 | pornografia | |
| 19 | sexo_sexualidade | Adicionado Mar/2026 — separado de pornografia |
| 20 | safeframe | |
| 21 | app_movel | |
| 22 | teste_tag | |
| 23 | nao_classificado | |
| ... | ... | |
| 29 | Devolutiva BI SECOM | Output do engine.py |
| 30 | Devolutiva Agência | |

> [!important] CPV e coluna entregue
> Para TODOS os tipos de compra (CPM, CPV), o engine lê `entregue` da **col 5 (Impressões)**.
> A col 9 (Views) é o numerador do VTR — não é a métrica de entrega.
> Parsers 00px CPV usam "Views" como sinônimo de total de plays = col 5.

## Categorias Indevidas (cols 15–23)

```
acidente
violencia
lingua_estrangeira
pornografia
sexo_sexualidade   ← separado de pornografia em Mar/2026
safeframe
app_movel
teste_tag
nao_classificado
```

O mapeamento de strings dos adservers para estas categorias fica em [[Category Map]].

---

Ver também: [[Category Map]] · [[Fluxo de Verificação]]
