import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getPool } from '@/lib/mysql';

export const dynamic = 'force-dynamic';

// 534 campaigns / ~2.2k ads — tiny; cache per process for 10 min.
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { data: unknown; loadedAt: number } | null = null;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS)
    return NextResponse.json(cache.data);

  try {
    const pool = getPool();
    const [campaigns, platforms, ads] = await Promise.all([
      pool.query("SELECT DISTINCT campaign_name FROM silver_social_comments WHERE campaign_name IS NOT NULL AND campaign_name != '' ORDER BY campaign_name"),
      pool.query('SELECT DISTINCT platform FROM silver_social_comments ORDER BY platform'),
      pool.query("SELECT DISTINCT campaign_name, ad_name FROM silver_social_comments WHERE ad_name IS NOT NULL AND ad_name != '' ORDER BY ad_name"),
    ]);
    const data = {
      campaigns: (campaigns[0] as { campaign_name: string }[]).map((r) => r.campaign_name),
      platforms: (platforms[0] as { platform: string }[]).map((r) => r.platform),
      ads: (ads[0] as { campaign_name: string | null; ad_name: string }[]).map((r) => ({
        campaign: r.campaign_name,
        ad: r.ad_name,
      })),
    };
    cache = { data, loadedAt: Date.now() };
    return NextResponse.json(data);
  } catch (e) {
    console.error('[sentimentos/filters]', e);
    return NextResponse.json({ error: 'Erro ao carregar filtros' }, { status: 500 });
  }
}
