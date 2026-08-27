import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getPool, isTransientDbError, resetPool } from '@/lib/mysql';
import { buildWhere, isSafeWhereFragment, type SentimentFilters } from '@/lib/sentimentos';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PAGE_SIZE = 50;

const TREND_BUCKETS = {
  month: { expr: "DATE_FORMAT(created_time, '%Y-%m')", interval: 'INTERVAL 24 MONTH' },
  week: {
    expr: "DATE_FORMAT(DATE_SUB(created_time, INTERVAL WEEKDAY(created_time) DAY), '%Y-%m-%d')",
    interval: 'INTERVAL 26 WEEK',
  },
  day: { expr: "DATE_FORMAT(created_time, '%Y-%m-%d')", interval: 'INTERVAL 60 DAY' },
} as const;
type TrendGranularity = keyof typeof TREND_BUCKETS;

// Meta ad-creative rows store a signed external-*.fbcdn.net wrapper URL whose
// `oe=` expiry passes within ~1-2 days; the inner `url=` (the actual
// facebook.com/ads/image/ link) stays valid much longer, so unwrap it.
function resolveImageUrl(url: string | null): string | null {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('fbcdn.net')) {
      const inner = parsed.searchParams.get('url');
      if (inner) return inner;
    }
  } catch {
    // not a valid absolute URL — leave as-is, Thumb's onError already handles bad values
  }
  return url;
}

// creative_image_path is an object key (e.g. "meta/....jpg"), not a URL — durable,
// unlike the fbcdn wrapper above, and unchanged when the bucket moves hosts.
// Prioritize it over image_url and route it through our own proxy (thumb/route.ts),
// which presigns the IDrive e2 GET server-side; the bucket is not public.
// A carousel ad stores every card in one column, joined by ';' — "meta/1~1.jpg;meta/1~2.jpg".
// Returns one URL per card, in card order; a single-image ad simply yields a list of one.
function resolveThumbUrls(path: string | null, imageUrl: string | null): string[] {
  if (path) {
    return path
      .split(';')
      .map((key) => key.trim())
      .filter(Boolean)
      .map((key) =>
        /^https?:\/\//i.test(key) // defensive: already absolute
          ? key
          : `/api/sentimentos/thumb?key=${encodeURIComponent(key.replace(/^\/+/, ''))}`
      );
  }
  // image_url can also carry several cards (the uploader writes both columns the same way)
  return (imageUrl ?? '')
    .split(';')
    .map((u) => resolveImageUrl(u.trim()))
    .filter((u): u is string => Boolean(u));
}

function resolveComments(rows: Array<Record<string, unknown>>) {
  return rows.map(({ creative_image_path, image_url, ...rest }) => ({
    ...rest,
    image_urls: resolveThumbUrls(
      creative_image_path as string | null,
      image_url as string | null
    ),
  }));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: SentimentFilters & { page?: number; trendGranularity?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (body.aiWhere && !isSafeWhereFragment(body.aiWhere))
    return NextResponse.json({ error: 'Filtro IA inválido' }, { status: 400 });

  const page = Math.max(0, Math.floor(Number(body.page) || 0));
  const trendGranularity: TrendGranularity =
    body.trendGranularity && body.trendGranularity in TREND_BUCKETS
      ? (body.trendGranularity as TrendGranularity)
      : 'month';
  const trendBucket = TREND_BUCKETS[trendGranularity];
  const { sql: where, params } = buildWhere(body);
  const from = `FROM silver_social_comments WHERE ${where}`;
  // Safety cap for unbounded day-level grouping — only applies when the user
  // hasn't picked their own date range, otherwise it silently clips it.
  const trendCap = body.from ? '' : ` AND created_time >= DATE_SUB(CURDATE(), ${trendBucket.interval})`;
  // top-ads lists pin their own sentiment, so they must ignore the user's
  // sentiment filter (otherwise `sentiment='Positivo' AND sentiment='Negativo'`)
  const { sql: whereNoSent, params: paramsNoSent } = buildWhere({ ...body, sentiment: undefined });

  try {
    const pool = getPool();
    const commentsSql = `SELECT id, image_url, creative_image_path, post_message, comment, author, like_count, created_time, sentiment, sentiment_source, audited_by, campaign_name, ad_name, platform
         ${from} ORDER BY created_time DESC LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}`;

    // Every filter change resets page to 0 client-side, so page > 0 means the
    // aggregates already on screen are still valid — fetch only the next
    // comments page (1 query instead of 5).
    if (page > 0) {
      const comments = await pool.query(commentsSql, params);
      return NextResponse.json({
        comments: resolveComments(comments[0] as Array<Record<string, unknown>>),
        page,
        pageSize: PAGE_SIZE,
      });
    }

    // Two waves instead of 5-way Promise.all: keeps peak concurrency low when
    // filters (3 queries) runs in parallel with this route.
    const [dist, comments] = await Promise.all([
      pool.query(`SELECT sentiment, COUNT(*) n ${from} GROUP BY sentiment`, params),
      pool.query(commentsSql, params),
    ]);
    const [trend, byPlatform, topAds] = await Promise.all([
      pool.query(
        `SELECT ${trendBucket.expr} period, sentiment, COUNT(*) n ${from}${trendCap} GROUP BY period, sentiment ORDER BY period`,
        params
      ),
      pool.query(`SELECT platform, sentiment, COUNT(*) n ${from} GROUP BY platform, sentiment`, params),
      pool.query(
        `SELECT ad_name, sentiment, COUNT(*) n FROM silver_social_comments WHERE ${whereNoSent} AND sentiment IN ('Negativo','Positivo') AND ad_name IS NOT NULL GROUP BY ad_name, sentiment ORDER BY n DESC`,
        paramsNoSent
      ),
    ]);

    const topRows = topAds[0] as { ad_name: string; sentiment: string; n: number }[];
    const topBy = (s: string) =>
      topRows.filter((r) => r.sentiment === s).slice(0, 10).map(({ ad_name, n }) => ({ ad_name, n }));

    return NextResponse.json({
      distribution: dist[0],
      trend: trend[0],
      byPlatform: byPlatform[0],
      topNegative: topBy('Negativo'),
      topPositive: topBy('Positivo'),
      comments: resolveComments(comments[0] as Array<Record<string, unknown>>),
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (e) {
    console.error('[sentimentos/data]', e);
    if (isTransientDbError(e)) {
      resetPool();
      return NextResponse.json(
        { error: 'Conexão com o banco esgotou. Tente novamente.' },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: 'Erro ao consultar comentários' }, { status: 500 });
  }
}
