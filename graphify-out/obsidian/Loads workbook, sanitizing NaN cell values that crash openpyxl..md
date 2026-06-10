---
source_file: "app/verification/parsers/parser_adforce.py"
type: "rationale"
community: "Adforce Parser"
location: "L37"
tags:
  - graphify/rationale
  - graphify/EXTRACTED
  - community/Adforce_Parser
---

# Loads workbook, sanitizing NaN cell values that crash openpyxl.

## Connections
- [[_load_workbook_safe()]] - `rationale_for` [EXTRACTED]

#graphify/rationale #graphify/EXTRACTED #community/Adforce_Parser