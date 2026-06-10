---
type: community
members: 13
---

# 00px Ad Parser

**Members:** 13 nodes

## Members
- [[Converte VA decimal (0.72) → percentagem (72.0); mantém se já  1.]] - rationale - app/verification/parsers/parser_00px.py
- [[Parseia arquivo de verification 00px (URL + categoria por linha).]] - rationale - app/verification/parsers/parser_00px.py
- [[Parseia comprovante 00px (multi-sheet CPMCPCCPV).]] - rationale - app/verification/parsers/parser_00px.py
- [[Parser 00px — comprovante de entrega + verification de URLs.  Comprovante   Wor]] - rationale - app/verification/parsers/parser_00px.py
- [[Retorna sheets de Contabilizações (CPMCPCCPV). Fallback primeira sheet.]] - rationale - app/verification/parsers/parser_00px.py
- [[Varre até 25 linhas buscando cabeçalho.     Se veiculo_required=True, exige col]] - rationale - app/verification/parsers/parser_00px.py
- [[_find_header()]] - code - app/verification/parsers/parser_00px.py
- [[_get_comp_sheets()]] - code - app/verification/parsers/parser_00px.py
- [[_normalize_va()]] - code - app/verification/parsers/parser_00px.py
- [[date_2]] - code - app/verification/parsers/parser_00px.py
- [[parse_comprovante()]] - code - app/verification/parsers/parser_00px.py
- [[parse_verif()]] - code - app/verification/parsers/parser_00px.py
- [[parser_00px.py]] - code - app/verification/parsers/parser_00px.py

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/00px_Ad_Parser
SORT file.name ASC
```

## Connections to other communities
- 3 edges to [[_COMMUNITY_Ahead Parser]]
- 2 edges to [[_COMMUNITY_Parser Utilities]]
- 2 edges to [[_COMMUNITY_Metrike Parser]]
- 1 edge to [[_COMMUNITY_Category Mapping]]
- 1 edge to [[_COMMUNITY_Comprovante Parser]]

## Top bridge nodes
- [[parse_comprovante()]] - degree 10, connects to 4 communities
- [[parse_verif()]] - degree 7, connects to 4 communities
- [[_normalize_va()]] - degree 4, connects to 1 community