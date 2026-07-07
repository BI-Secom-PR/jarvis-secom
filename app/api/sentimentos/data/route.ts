import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getPool } from '@/lib/mysql';
import { buildWhere, isSafeWhereFragment, type SentimentFilters } from '@/lib/sentimentos';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PAGE_SIZE = 50;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: SentimentFilters & { page?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (body.aiWhere && !isSafeWhereFragment(body.aiWhere))
    return NextResponse.json({ error: 'Filtro IA inválido' }, { status: 400 });

  const page = Math.max(0, Math.floor(Number(body.page) || 0));
  const { sql: where, params } = buildWhere(body);
  const from = `FROM silver_social_comments WHERE ${where}`;

  try {
    const pool = getPool();
    const [dist, trend, byPlatform, topNegative, topPositive, comments] = await Promise.all([
      pool.query(`SELECT sentiment, COUNT(*) n ${from} GROUP BY sentiment`, params),
      pool.query(
        `SELECT DATE_FORMAT(created_time, '%Y-%m') ym, sentiment, COUNT(*) n ${from} AND created_time >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH) GROUP BY ym, sentiment ORDER BY ym`,
        params
      ),
      pool.query(`SELECT platform, sentiment, COUNT(*) n ${from} GROUP BY platform, sentiment`, params),
      pool.query(
        `SELECT ad_name, COUNT(*) n ${from} AND sentiment = 'Negativo' AND ad_name IS NOT NULL GROUP BY ad_name ORDER BY n DESC LIMIT 10`,
        params
      ),
      pool.query(
        `SELECT ad_name, COUNT(*) n ${from} AND sentiment = 'Positivo' AND ad_name IS NOT NULL GROUP BY ad_name ORDER BY n DESC LIMIT 10`,
        params
      ),
      pool.query(
        `SELECT id, image_url, post_message, comment, author, like_count, created_time, sentiment, sentiment_source, audited_by, campaign_name, ad_name, platform
         ${from} ORDER BY created_time DESC LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}`,
        params
      ),
    ]);

    return NextResponse.json({
      distribution: dist[0],
      trend: trend[0],
      byPlatform: byPlatform[0],
      topNegative: topNegative[0],
      topPositive: topPositive[0],
      comments: comments[0],
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (e) {
    console.error('[sentimentos/data]', e);
    return NextResponse.json({ error: 'Erro ao consultar comentários' }, { status: 500 });
  }
}
