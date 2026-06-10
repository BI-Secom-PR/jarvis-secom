---
type: community
members: 6
---

# User Activity Tracking

**Members:** 6 nodes

## Members
- [[default_4]] - code - lib/db/migrations/meta/0000_snapshot.json
- [[last_seen]] - code - lib/db/migrations/meta/0000_snapshot.json
- [[name_23]] - code - lib/db/migrations/meta/0000_snapshot.json
- [[notNull_15]] - code - lib/db/migrations/meta/0000_snapshot.json
- [[primaryKey_15]] - code - lib/db/migrations/meta/0000_snapshot.json
- [[type_15]] - code - lib/db/migrations/meta/0000_snapshot.json

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/User_Activity_Tracking
SORT file.name ASC
```

## Connections to other communities
- 1 edge to [[_COMMUNITY_Session Schema]]

## Top bridge nodes
- [[last_seen]] - degree 6, connects to 1 community