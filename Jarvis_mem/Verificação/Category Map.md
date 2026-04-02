---
title: Category Map
tags:
  - verificacao
  - categorias
---

# Category Map

**Arquivo:** `app/verification/parsers/category_map.py`

Único lugar para adicionar variantes de categoria. Todos os parsers importam daqui.

## Estrutura

```python
CATEGORY_MAP = {
    # Acidente
    "acidente": "acidente",
    "acidentes": "acidente",
    ...

    # Pornografia
    "pornografia": "pornografia",
    "pornography": "pornografia",

    # Sexo e Sexualidade (separado de pornografia desde Mar/2026)
    "sexo e sexualidade": "sexo_sexualidade",
    "sexo": "sexo_sexualidade",
    "sexuality": "sexo_sexualidade",

    # Strings compostas ADFORCE
    "acidentes, violência, crime": "violencia",
    "sexo e sexualidade, pornografia": "sexo_sexualidade",
    ...
}

INDEVIDAS_ZERO = {
    "acidente": 0,
    "violencia": 0,
    "lingua_estrangeira": 0,
    "pornografia": 0,
    "sexo_sexualidade": 0,   ← adicionado Mar/2026
    "safeframe": 0,
    "app_movel": 0,
    "teste_tag": 0,
    "nao_classificado": 0,
}
```

## Como Adicionar uma Variante

1. Abrir `category_map.py`
2. Adicionar `"string_do_adserver": "categoria_destino"` no `CATEGORY_MAP`
3. Se for categoria nova: adicionar em `INDEVIDAS_ZERO` e atualizar [[Template 30 Colunas]] (cols 15–23)

> [!tip] ADFORCE tem strings compostas
> O ADFORCE pode enviar strings como `"acidentes, violência, crime"` em uma única célula.
> Essas strings compostas precisam de entrada própria no CATEGORY_MAP — não são tratadas por split automático.

---

Ver também: [[Template 30 Colunas]] · [[Parser ADFORCE]]
