import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getPool, isTransientDbError, resetPool } from '@/lib/mysql';
import { buildWhere, type SentimentFilters } from '@/lib/sentimentos';
import { groupOf, loadCampaignRules, rulesHash, withCampaignNames } from '@/lib/campaignGroups';

export const dynamic = 'force-dynamic';

// 534 campaigns / ~2.2k ads — tiny; cache per process for 10 min, keyed by date window.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { data: unknown; loadedAt: number }>();

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  // Multi-valor: o cliente repete o parâmetro (`platform=meta&platform=tiktok`).
  const f: SentimentFilters = {
    from: q.get('from') ?? undefined,
    to: q.get('to') ?? undefined,
    campaigns: q.getAll('campaign'),
    ad: q.getAll('ad'),
    platform: q.getAll('platform'),
    sentiment: q.getAll('sentiment'),
  };

  try {
    // As regras entram na chave: um PUT no editor aparece sem esperar os 10 min do cache.
    const { text: rulesText, rules } = await loadCampaignRules();
    const key = `${rulesHash(rulesText)}|${JSON.stringify(f)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS)
      return NextResponse.json(hit.data);

    const pool = getPool();
    // `campaign` chega como rótulo(s) de grupo → nomes crus antes dos WHEREs.
    const fr = await withCampaignNames(pool, f, 'silver_social_comments', 'created_time');
    // Faceted: each list is constrained by every filter EXCEPT its own dimension.
    const wCampaigns = buildWhere({ ...fr, campaigns: undefined, campaignNames: undefined });
    const wPlatforms = buildWhere({ ...fr, platform: undefined });
    const wAds = buildWhere({ ...fr, ad: undefined });
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
      // Nomes crus viram rótulos de grupo (mesmas regras do dashboard).
      campaigns: [...new Set((campaigns[0] as { campaign_name: string }[])
        .map((r) => groupOf(r.campaign_name, rules)))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      platforms: (platforms[0] as { platform: string }[]).map((r) => r.platform),
      // O anúncio carrega o GRUPO da campanha (o cliente filtra anúncios por rótulo).
      // Dedupe: o DISTINCT é por nome cru, campanhas do mesmo grupo repetiriam o anúncio.
      ads: [...new Map((ads[0] as { campaign_name: string | null; ad_name: string }[])
        .map((r) => {
          const campaign = r.campaign_name ? groupOf(r.campaign_name, rules) : null;
          return [`${campaign}\u0000${r.ad_name}`, { campaign, ad: r.ad_name }] as const;
        })).values()],
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
