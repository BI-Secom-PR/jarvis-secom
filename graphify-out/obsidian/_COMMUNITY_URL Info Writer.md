---
type: community
members: 5
---

# URL Info Writer

**Members:** 5 nodes

## Members
- [[Escreve o levantamento de URLs indevidas (análise IA) na coluna 30 (URL info) do]] - rationale - app/verification/parsers/write_url_info.py
- [[Write url_info dict {veiculo text} into COL_URL_INFO of xlsx_path (in-place).]] - rationale - app/verification/parsers/write_url_info.py
- [[main()]] - code - app/verification/parsers/write_url_info.py
- [[write()]] - code - app/verification/parsers/write_url_info.py
- [[write_url_info.py]] - code - app/verification/parsers/write_url_info.py

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/URL_Info_Writer
SORT file.name ASC
```
