---
type: community
members: 22
---

# Adforce Parser

**Members:** 22 nodes

## Members
- [[Detecta o formato flat ADFORCE (sheet única Result 1 com campaignUuid na col A]] - rationale - app/verification/parsers/parser_adforce.py
- [[Extrai duração em segundos de strings como 'Filme de 60' ou 'Filme 30''.]] - rationale - app/verification/parsers/parser_adforce.py
- [[Loads workbook, sanitizing NaN cell values that crash openpyxl.]] - rationale - app/verification/parsers/parser_adforce.py
- [[Parseia comprovante ADFORCE (sheet única, viewability por média ponderada).]] - rationale - app/verification/parsers/parser_adforce.py
- [[Parseia o formato multi-sheet ADFORCE (uma sheet por veículo, pula ABAT).     In]] - rationale - app/verification/parsers/parser_adforce.py
- [[Parseia verification ADFORCE — detecta automaticamente o formato       - Flat (]] - rationale - app/verification/parsers/parser_adforce.py
- [[Parser ADFORCE — comprovante de entrega + verification de URLs.  Comprovante]] - rationale - app/verification/parsers/parser_adforce.py
- [[Retorna sheets de dados (pula sheets ABAT que são resumos).]] - rationale - app/verification/parsers/parser_adforce.py
- [[Varre até 25 linhas buscando Categoria + coluna contendo 'url'.]] - rationale - app/verification/parsers/parser_adforce.py
- [[Varre até 25 linhas buscando ImpressõesEntregues com pelo menos uma coluna ânco]] - rationale - app/verification/parsers/parser_adforce.py
- [[Workbook]] - code - app/verification/parsers/parser_adforce.py
- [[_extract_duracao()]] - code - app/verification/parsers/parser_adforce.py
- [[_find_header()_1]] - code - app/verification/parsers/parser_adforce.py
- [[_find_verif_header()]] - code - app/verification/parsers/parser_adforce.py
- [[_get_verif_sheets()]] - code - app/verification/parsers/parser_adforce.py
- [[_is_flat_format()]] - code - app/verification/parsers/parser_adforce.py
- [[_load_workbook_safe()]] - code - app/verification/parsers/parser_adforce.py
- [[_parse_verif_multitab()]] - code - app/verification/parsers/parser_adforce.py
- [[date_3]] - code - app/verification/parsers/parser_adforce.py
- [[parse_comprovante()_1]] - code - app/verification/parsers/parser_adforce.py
- [[parse_verif()_1]] - code - app/verification/parsers/parser_adforce.py
- [[parser_adforce.py]] - code - app/verification/parsers/parser_adforce.py

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Adforce_Parser
SORT file.name ASC
```

## Connections to other communities
- 4 edges to [[_COMMUNITY_Ahead Parser]]
- 3 edges to [[_COMMUNITY_Category Mapping]]
- 2 edges to [[_COMMUNITY_Parser Utilities]]
- 1 edge to [[_COMMUNITY_Metrike Parser]]
- 1 edge to [[_COMMUNITY_Comprovante Parser]]

## Top bridge nodes
- [[parse_comprovante()_1]] - degree 11, connects to 4 communities
- [[_parse_verif_multitab()]] - degree 8, connects to 3 communities
- [[parser_adforce.py]] - degree 12, connects to 2 communities
- [[parse_verif()_1]] - degree 7, connects to 1 community