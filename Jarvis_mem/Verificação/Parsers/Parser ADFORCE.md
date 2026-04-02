---
title: Parser ADFORCE
tags:
  - verificacao
  - parser
  - adforce
---

# Parser ADFORCE

**Arquivo:** `app/verification/parsers/parser_adforce.py`

## Características

- Sheet única
- Viewability: **média ponderada** (não simples)
- Arquivo de verification: multi-sheet (pula sheet "ABAT")

## Strings Compostas de Categoria

O ADFORCE pode enviar múltiplas categorias em uma única célula:

```
"acidentes, violência, crime"        → violencia
"sexo e sexualidade, pornografia"    → sexo_sexualidade
```

Essas strings compostas têm entradas próprias no [[Category Map]].

> [!warning] Não usar split automático
> As strings compostas são mapeadas integralmente — nunca fazer split por vírgula e tentar mapear cada parte individualmente.

---

Ver também: [[Category Map]] · [[Fluxo de Verificação]]
