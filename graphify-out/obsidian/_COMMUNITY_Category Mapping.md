---
type: community
members: 13
---

# Category Mapping

**Members:** 13 nodes

## Members
- [[Mapeamento centralizado de categorias de indevidas → chaves internas SECOM.  Imp]] - rationale - app/verification/parsers/category_map.py
- [[Mapeia um nome de categoria para a chave interna SECOM.     Retorna None se a ca]] - rationale - app/verification/parsers/category_map.py
- [[Parseia o formato flat ADFORCE (Result 1, header na linha 1).     Indevidas = so]] - rationale - app/verification/parsers/parser_adforce.py
- [[Parseia um arquivo de verification de adserver.      Retorna listdict — um dic]] - rationale - app/verification/parsers/parser_adserver_verif.py
- [[Parser para arquivos de Verification de Adserver (R7, Terra, UOL e similares).]] - rationale - app/verification/parsers/parser_adserver_verif.py
- [[Varre as primeiras 25 linhas procurando o header com 'Categoria' + 'Url'.      R]] - rationale - app/verification/parsers/parser_adserver_verif.py
- [[_find_header_row()]] - code - app/verification/parsers/parser_adserver_verif.py
- [[_parse_verif_flat()]] - code - app/verification/parsers/parser_adforce.py
- [[category_map.py]] - code - app/verification/parsers/category_map.py
- [[date_5]] - code - app/verification/parsers/parser_adserver_verif.py
- [[normaliza_categoria()]] - code - app/verification/parsers/category_map.py
- [[parse()]] - code - app/verification/parsers/parser_adserver_verif.py
- [[parser_adserver_verif.py]] - code - app/verification/parsers/parser_adserver_verif.py

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Category_Mapping
SORT file.name ASC
```

## Connections to other communities
- 3 edges to [[_COMMUNITY_Adforce Parser]]
- 3 edges to [[_COMMUNITY_Ahead Parser]]
- 2 edges to [[_COMMUNITY_Verification Engine Core]]
- 2 edges to [[_COMMUNITY_Metrike Parser]]
- 2 edges to [[_COMMUNITY_Parser Utilities]]
- 1 edge to [[_COMMUNITY_00px Ad Parser]]
- 1 edge to [[_COMMUNITY_Admotion Parser]]

## Top bridge nodes
- [[normaliza_categoria()]] - degree 11, connects to 6 communities
- [[parse()]] - degree 8, connects to 3 communities
- [[_parse_verif_flat()]] - degree 6, connects to 3 communities