---
type: community
members: 16
---

# Ahead Parser

**Members:** 16 nodes

## Members
- [[Decimal (0.622) → percentagem (62.2). Mantém se já  1.]] - rationale - app/verification/parsers/parser_adforce.py
- [[Parseia comprovante AHEAD (formato CM360).]] - rationale - app/verification/parsers/parser_ahead.py
- [[Parseia verification AHEAD (URL Veiculada, Veículos, Impressões Totais).]] - rationale - app/verification/parsers/parser_ahead.py
- [[Parser AHEAD — comprovante de entrega + verification de URLs.  Comprovante   Me]] - rationale - app/verification/parsers/parser_ahead.py
- [[Varre até 25 linhas 'Site (CM360)' OU 'Veículo' E 'Impressions'.]] - rationale - app/verification/parsers/parser_ahead.py
- [[_find_comp_header()_1]] - code - app/verification/parsers/parser_ahead.py
- [[_find_verif_header()_2]] - code - app/verification/parsers/parser_ahead.py
- [[_normalize_va()_1]] - code - app/verification/parsers/parser_adforce.py
- [[_normalize_va()_3]] - code - app/verification/parsers/parser_ahead.py
- [[col_index()]] - code - app/verification/parsers/parser_utils.py
- [[date_6]] - code - app/verification/parsers/parser_ahead.py
- [[parse_comprovante()_3]] - code - app/verification/parsers/parser_ahead.py
- [[parse_verif()_3]] - code - app/verification/parsers/parser_ahead.py
- [[parser_ahead.py]] - code - app/verification/parsers/parser_ahead.py
- [[to_float()]] - code - app/verification/parsers/parser_utils.py
- [[Índice (0-based) da primeira coluna cujo nome (case-insensitive) está em names.]] - rationale - app/verification/parsers/parser_utils.py

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Ahead_Parser
SORT file.name ASC
```

## Connections to other communities
- 4 edges to [[_COMMUNITY_Adforce Parser]]
- 4 edges to [[_COMMUNITY_Parser Utilities]]
- 4 edges to [[_COMMUNITY_Metrike Parser]]
- 3 edges to [[_COMMUNITY_Category Mapping]]
- 3 edges to [[_COMMUNITY_00px Ad Parser]]
- 3 edges to [[_COMMUNITY_Admotion Parser]]
- 3 edges to [[_COMMUNITY_Comprovante Parser]]

## Top bridge nodes
- [[col_index()]] - degree 15, connects to 7 communities
- [[to_float()]] - degree 6, connects to 4 communities
- [[parse_comprovante()_3]] - degree 9, connects to 3 communities
- [[parse_verif()_3]] - degree 8, connects to 3 communities
- [[_normalize_va()_1]] - degree 4, connects to 1 community