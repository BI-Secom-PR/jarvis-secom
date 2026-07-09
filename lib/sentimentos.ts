// Shared pieces of the SENTIMENTOS dash: fixed-filter WHERE builder and the
// safety guard for the AI-generated free-text filter fragment.

export const SENTIMENTS = ['Positivo', 'Negativo', 'Neutro'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export type SentimentFilters = {
  campaign?: string;
  ad?: string;
  platform?: string;
  sentiment?: string;
  /** Date range over created_time, YYYY-MM-DD (inclusive). */
  from?: string;
  to?: string;
  aiWhere?: string;
};

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parameterized WHERE for the fixed filters (aiWhere appended separately). */
export function buildWhere(f: SentimentFilters): { sql: string; params: unknown[] } {
  const conds: string[] = ['1=1'];
  const params: unknown[] = [];
  if (f.campaign) { conds.push('campaign_name = ?'); params.push(f.campaign); }
  if (f.ad)       { conds.push('ad_name = ?');       params.push(f.ad); }
  if (f.platform) { conds.push('platform = ?');      params.push(f.platform); }
  if (f.sentiment && (SENTIMENTS as readonly string[]).includes(f.sentiment)) {
    conds.push('sentiment = ?'); params.push(f.sentiment);
  }
  if (f.from && ISO_DATE.test(f.from)) { conds.push('created_time >= ?'); params.push(f.from); }
  if (f.to && ISO_DATE.test(f.to))     { conds.push('created_time < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(f.to); }
  if (f.aiWhere && isSafeWhereFragment(f.aiWhere)) conds.push(`(${f.aiWhere})`);
  return { sql: conds.join(' AND '), params };
}

// Whitelist check: strip string literals, then every remaining word token must
// be a known column, SQL keyword/function or number. Blocks subqueries,
// comments, semicolons and anything touching other tables by construction.
const ALLOWED_TOKEN = new RegExp(
  '^(?:' +
    // columns of silver_social_comments the AI may filter on
    'comment|post_message|title|author|platform|campaign_name|ad_name|sentiment|sentiment_source|like_count|created_time|object_type|' +
    // operators / keywords / functions
    'AND|OR|NOT|LIKE|IN|IS|NULL|BETWEEN|TRUE|FALSE|' +
    'DATE|INTERVAL|DAY|MONTH|YEAR|WEEK|NOW|CURDATE|DATE_SUB|DATE_ADD|DATE_FORMAT|' +
    'LOWER|UPPER|TRIM|COALESCE|LENGTH|CHAR_LENGTH' +
  ')$',
  'i'
);

export function isSafeWhereFragment(fragment: string): boolean {
  if (!fragment || fragment.length > 1000) return false;
  if (/[;`\\#]|--|\/\*/.test(fragment)) return false;
  const withoutStrings = fragment.replace(/'(?:[^'\\]|'')*'/g, ' ').replace(/"(?:[^"\\])*"/g, ' ');
  if (/['"]/.test(withoutStrings)) return false; // unbalanced quote
  const tokens = withoutStrings.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  return tokens.every((t) => ALLOWED_TOKEN.test(t));
}
