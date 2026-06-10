---
type: community
members: 24
---

# Verification Engine Core

**Members:** 24 nodes

## Members
- [[Agrupa e soma resultados de múltiplos arquivos do mesmo veículo.     Retorna dic]] - rationale - app/verification/engine.py
- [[Compara métricas de uma linha do consolidado com comprovante e verification.]] - rationale - app/verification/engine.py
- [[Engine de comparação do Sistema de Verificação SECOM.  Fluxo   1. Lê o consolid]] - rationale - app/verification/engine.py
- [[Lê o header (HEADER_ROW=8) e retorna posições reais das colunas,     permitindo]] - rationale - app/verification/engine.py
- [[Lê todas as linhas de dados do consolidado.     Retorna (lista de dicts com métr]] - rationale - app/verification/engine.py
- [[Lê valor de célula ignorando fórmulas (retorna None se fórmula sem valor).]] - rationale - app/verification/engine.py
- [[Retorna (result_dict, score) do melhor match fuzzy, ou (None, 0) se abaixo do th]] - rationale - app/verification/engine.py
- [[Soma dois valores opcionais; retorna None somente se ambos forem None.]] - rationale - app/verification/engine.py
- [[Uppercase, sem acentos, sem pontuação, sem sufixos empresariais.]] - rationale - app/verification/engine.py
- [[Verifica um consolidado contra comprovantes e arquivos de verification.      con]] - rationale - app/verification/engine.py
- [[_add_optional()]] - code - app/verification/engine.py
- [[_cell_value()]] - code - app/verification/engine.py
- [[_compare()]] - code - app/verification/engine.py
- [[_detect_consolidado_cols()]] - code - app/verification/engine.py
- [[_fmt_num()]] - code - app/verification/engine.py
- [[_fuzzy_match()]] - code - app/verification/engine.py
- [[_merge_by_veiculo()]] - code - app/verification/engine.py
- [[_normalize()]] - code - app/verification/engine.py
- [[_read_consolidado()]] - code - app/verification/engine.py
- [[_to_float_safe()]] - code - app/verification/engine.py
- [[_to_int_safe()]] - code - app/verification/engine.py
- [[date_1]] - code - app/verification/engine.py
- [[engine.py]] - code - app/verification/engine.py
- [[verificar()]] - code - app/verification/engine.py

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Verification_Engine_Core
SORT file.name ASC
```

## Connections to other communities
- 2 edges to [[_COMMUNITY_Category Mapping]]
- 1 edge to [[_COMMUNITY_Verification HTTP Server]]

## Top bridge nodes
- [[verificar()]] - degree 10, connects to 2 communities
- [[_detect_consolidado_cols()]] - degree 5, connects to 1 community