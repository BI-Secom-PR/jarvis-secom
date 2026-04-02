---
title: Parser BRZ
tags:
  - verificacao
  - parser
  - brz
  - pendente
---

# Parser BRZ

**Arquivo:** `app/verification/parsers/parser_brz.py`

## Status

> [!danger] Pendente — NotImplementedError
> O parser BRZ é um placeholder. Ambas as funções (`parse_comprovante` e `parse_verif`) lançam `NotImplementedError`.
> Adserver em ajuste — não disponível para uso.

## Para Implementar

1. Entender o formato do comprovante BRZ
2. Implementar `parse_comprovante(filepath, data_ini, data_fim)` → retorna dict com entregue, viewability, url_pool
3. Implementar `parse_verif(filepath, data_ini, data_fim)` → retorna dict com indevidas por categoria
4. Registrar no `PARSER_MAP` em `engine.py` (já deve estar registrado como placeholder)
5. Testar com arquivo real

---

Ver também: [[Fluxo de Verificação]]
