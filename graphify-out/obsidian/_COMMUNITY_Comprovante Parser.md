---
type: community
members: 9
---

# Comprovante Parser

**Members:** 9 nodes

## Members
- [[Inferência simples de veículo via nome do arquivo.     Prioriza o último segment]] - rationale - app/verification/parsers/parser_utils.py
- [[Parseia um arquivo de comprovante de entrega (primeira aba).      Retorna listd]] - rationale - app/verification/parsers/parser_comprovante.py
- [[Parser genérico para arquivos de comprovante de entrega.  Detectado por nome de]] - rationale - app/verification/parsers/parser_comprovante.py
- [[Varre as primeiras 25 linhas procurando cabeçalho com 'veículo' E     ('impressõ]] - rationale - app/verification/parsers/parser_comprovante.py
- [[_find_header()_2]] - code - app/verification/parsers/parser_comprovante.py
- [[date_7]] - code - app/verification/parsers/parser_comprovante.py
- [[parse()_1]] - code - app/verification/parsers/parser_comprovante.py
- [[parser_comprovante.py]] - code - app/verification/parsers/parser_comprovante.py
- [[vehicle_from_filename()]] - code - app/verification/parsers/parser_utils.py

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Comprovante_Parser
SORT file.name ASC
```

## Connections to other communities
- 3 edges to [[_COMMUNITY_Ahead Parser]]
- 2 edges to [[_COMMUNITY_Parser Utilities]]
- 2 edges to [[_COMMUNITY_Metrike Parser]]
- 1 edge to [[_COMMUNITY_00px Ad Parser]]
- 1 edge to [[_COMMUNITY_Adforce Parser]]
- 1 edge to [[_COMMUNITY_Admotion Parser]]

## Top bridge nodes
- [[vehicle_from_filename()]] - degree 8, connects to 6 communities
- [[parse()_1]] - degree 9, connects to 3 communities