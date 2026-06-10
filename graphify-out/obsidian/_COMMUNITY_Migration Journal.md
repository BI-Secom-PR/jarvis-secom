---
type: community
members: 4
---

# Migration Journal

**Members:** 4 nodes

## Members
- [[_journal.json]] - code - lib/db/migrations/meta/_journal.json
- [[dialect_1]] - code - lib/db/migrations/meta/_journal.json
- [[entries]] - code - lib/db/migrations/meta/_journal.json
- [[version_1]] - code - lib/db/migrations/meta/_journal.json

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Migration_Journal
SORT file.name ASC
```
