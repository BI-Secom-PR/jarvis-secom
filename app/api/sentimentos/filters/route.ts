import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getPool, isTransientDbError, resetPool } from '@/lib/mysql';
import { buildWhere } from '@/lib/sentimentos';

export const dynamic = 'force-dynamic';

// 534 campaigns / ~2.2k ads — tiny; cache per process for 10 min, keyed by date window.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { data: unknown; loadedAt: number }>();

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const f = {
    from: q.get('from') ?? undefined,
    to: q.get('to') ?? undefined,
    campaign: q.get('campaign') ?? undefined,
    ad: q.get('ad') ?? undefined,
    platform: q.get('platform') ?? undefined,
    sentiment: q.get('sentiment') ?? undefined,
  };
  const key = JSON.stringify(f);

  const hit = cache.get(key);
  if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS)
    return NextResponse.json(hit.data);

  try {
    // Faceted: each list is constrained by every filter EXCEPT its own dimension.
    const wCampaigns = buildWhere({ ...f, campaign: undefined });
    const wPlatforms = buildWhere({ ...f, platform: undefined });
    const wAds = buildWhere({ ...f, ad: undefined });
    const pool = getPool();
    // Platforms is tiny; campaigns + ads are the heavier DISTINCT scans.
    // Cap peak at 2 so this route can coexist with data's first wave.
    const platforms = await pool.query(
      `SELECT DISTINCT platform FROM silver_social_comments WHERE ${wPlatforms.sql} ORDER BY platform`,
      wPlatforms.params
    );
    const [campaigns, ads] = await Promise.all([
      pool.query(`SELECT DISTINCT campaign_name FROM silver_social_comments WHERE ${wCampaigns.sql} AND campaign_name IS NOT NULL AND campaign_name != '' ORDER BY campaign_name`, wCampaigns.params),
      pool.query(`SELECT DISTINCT campaign_name, ad_name FROM silver_social_comments WHERE ${wAds.sql} AND ad_name IS NOT NULL AND ad_name != '' ORDER BY ad_name`, wAds.params),
    ]);
    const data = {
      campaigns: (campaigns[0] as { campaign_name: string }[]).map((r) => r.campaign_name),
      platforms: (platforms[0] as { platform: string }[]).map((r) => r.platform),
      ads: (ads[0] as { campaign_name: string | null; ad_name: string }[]).map((r) => ({
        campaign: r.campaign_name,
        ad: r.ad_name,
      })),
    };
    if (cache.size > 50) cache.clear(); // ponytail: crude bound; LRU if it ever matters
    cache.set(key, { data, loadedAt: Date.now() });
    return NextResponse.json(data);
  } catch (e) {
    console.error('[sentimentos/filters]', e);
    if (isTransientDbError(e)) {
      resetPool();
      return NextResponse.json(
        { error: 'Conexão com o banco esgotou. Tente novamente.' },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: 'Erro ao carregar filtros' }, { status: 500 });
  }
}
