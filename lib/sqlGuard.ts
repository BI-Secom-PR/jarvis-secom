// Shared SQL allowlist/blocklist for the AI SQL tool (chat + external/query).
// The model's own prompt tells it to only touch gold_* tables, but that's a
// suggestion, not a boundary — this is the code-level boundary. Defense in
// depth: the MySQL user is also read-only on airbyte_secom (see lib/mysql.ts).

const SAFE_QUERY = /^\s*(?:WITH\b|SELECT\b)(?![\s\S]*\b(?:INTO\s+(?:OUTFILE|DUMPFILE)|LOAD_FILE)\b)[\s\S]+\bFROM\b/i;

const BLOCKED_PATTERNS =
  /\b(UNION[\s\S]*SELECT|SLEEP\s*\(|BENCHMARK\s*\(|INFORMATION_SCHEMA|mysql\s*\.|sys\s*\.|performance_schema)\b|gold_platforms_/i;

// SQL line comments (--) and block comments (/*) can hide a second statement
// from the checks below, or smuggle instructions to a naive downstream tool.
// Never legitimately needed in a generated analytics query.
const HAS_COMMENT = /--|\/\*/;

// A ';' is fine as a single trailing terminator (every few-shot example ends
// with one) but not followed by more content — that's a second statement.
const HAS_MULTIPLE_STATEMENTS = /;\s*\S/;

const KEYWORD_RE = /\b(FROM|JOIN)\b/gi;
const IDENTIFIER_RE = /^(`?[\w.]+`?)/;
const ALIAS_RE = /^\s+(?:AS\s+)?(\w+)\b/i;
const COMMA_RE = /^\s*,\s*/;
const ALIAS_STOP_WORDS = new Set([
  'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'JOIN', 'ON',
  'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'UNION',
]);

const CTE_NAME_RE = /\bWITH\s+(\w+)\s+AS\s*\(|,\s*(\w+)\s+AS\s*\(/gi;

function extractCteNames(sql: string): Set<string> {
  const names = new Set<string>();
  for (const m of sql.matchAll(CTE_NAME_RE)) {
    const name = m[1] ?? m[2];
    if (name) names.add(name.toLowerCase());
  }
  return names;
}

// Walks every FROM/JOIN keyword and pulls out the table reference(s) that
// follow — including comma-joined tables in a FROM list, e.g.
// `FROM base b, stats s`. Subqueries (`FROM (SELECT ...)`) are left alone:
// their own inner FROM/JOIN get picked up independently since we scan the
// whole query text, nesting included. Not a full SQL parser — anchored
// scanning from known keyword positions avoids the classic bug of a regex
// mistaking a SELECT-list comma for a FROM-list comma.
function findTableRefs(sql: string): string[] {
  const refs: string[] = [];
  let m: RegExpExecArray | null;
  KEYWORD_RE.lastIndex = 0;
  while ((m = KEYWORD_RE.exec(sql))) {
    const keyword = m[1].toUpperCase();
    let pos = KEYWORD_RE.lastIndex;
    while (pos < sql.length && /\s/.test(sql[pos])) pos++;
    if (sql[pos] === '(') continue; // subquery — inner FROM/JOIN caught separately

    const idMatch = IDENTIFIER_RE.exec(sql.slice(pos));
    if (!idMatch) continue;
    refs.push(idMatch[1]);
    pos += idMatch[0].length;

    if (keyword !== 'FROM') continue; // only FROM supports comma-joined lists

    for (;;) {
      const beforeAlias = pos;
      const aliasMatch = ALIAS_RE.exec(sql.slice(pos));
      if (aliasMatch && !ALIAS_STOP_WORDS.has(aliasMatch[1].toUpperCase())) {
        pos += aliasMatch[0].length;
      }
      const commaMatch = COMMA_RE.exec(sql.slice(pos));
      if (!commaMatch) { pos = beforeAlias; break; }
      pos += commaMatch[0].length;
      if (sql[pos] === '(') break; // subquery in comma list — skip

      const idMatch2 = IDENTIFIER_RE.exec(sql.slice(pos));
      if (!idMatch2) break;
      refs.push(idMatch2[1]);
      pos += idMatch2[0].length;
    }
  }
  return refs;
}

function isAllowedTableRef(ref: string, cteNames: Set<string>): boolean {
  const bare = ref.replace(/`/g, '');
  const table = (bare.includes('.') ? bare.split('.').pop()! : bare).toLowerCase();
  return table.startsWith('gold_') || cteNames.has(table);
}

// Every FROM/JOIN target must be a gold_* table/view or a CTE defined
// earlier in the same query.
function allTableRefsAllowed(sql: string): boolean {
  const cteNames = extractCteNames(sql);
  return findTableRefs(sql).every((ref) => isAllowedTableRef(ref, cteNames));
}

export function isSafeQuery(sqlQuery: string): boolean {
  if (!SAFE_QUERY.test(sqlQuery)) return false;
  if (BLOCKED_PATTERNS.test(sqlQuery)) return false;
  if (HAS_COMMENT.test(sqlQuery)) return false;
  if (HAS_MULTIPLE_STATEMENTS.test(sqlQuery)) return false;
  if (!allTableRefsAllowed(sqlQuery)) return false;
  return true;
}

export function assertSafeQuery(sqlQuery: string): void {
  if (!isSafeQuery(sqlQuery)) {
    throw new Error('Only SELECT queries on airbyte_secom gold_* tables are allowed.');
  }
}
