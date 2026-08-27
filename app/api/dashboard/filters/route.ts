import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getPool, isTransientDbError, resetPool } from '@/lib/mysql';
import { buildWhere, fromTable, HAS_DELIVERY, type DashboardFilters } from '@/lib/dashboard';
import { groupOf, loadCampaignRules, rulesHash, withCampaignNames } from '@/lib/campaignGroups';

export const dynamic = 'force-dynamic';

// Campaign/ad lists are small and change once a day (the gold refresh runs at
// 23:00), so a per-process window is plenty.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { data: unknown; loadedAt: number }>();

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const f: DashboardFilters = {
    from: q.get('from') ?? undefined,
    to: q.get('to') ?? undefined,
    campaign: q.get('campaign') ?? undefined,
    platform: q.get('platform') ?? undefined,
    ad: q.get('ad') ?? undefined,
    objective: q.get('objective') ?? undefined,
    tema: q.get('tema') ?? undefined,
  };
  try {
    // As regras entram na chave: sem isso um PUT no editor demoraria os 10 min do
    // cache para aparecer no dropdown de quem já tinha carregado a tela.
    const { text: rulesText, rules } = await loadCampaignRules();
    const key = `${rulesHash(rulesText)}|${JSON.stringify(f)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) return NextResponse.json(hit.data);

    const pool = getPool();
    // `campaign` chega como rótulo de grupo — traduz para os nomes crus antes dos WHEREs.
    const fr = await withCampaignNames(pool, f, fromTable('gold_platforms_campaigns', f));
    // Faceted: each list is constrained by every filter EXCEPT its own dimension,
    // so picking a platform narrows the campaign list but not the platform list.
    const wCamp = buildWhere({ ...fr, campaign: undefined, campaignNames: undefined, ad: undefined });
    const wPlat = buildWhere({ ...fr, platform: undefined });
    const wAd = buildWhere({ ...fr, ad: undefined });
    const wObj = buildWhere({ ...fr, objective: undefined });
    const wTema = buildWhere({ ...fr, tema: undefined });
    // Os quatro WHEREs acima herdam `tema`, e `eixo` só existe na view — sem trocar a
    // tabela junto, cada um deles vira "Unknown column 'eixo'" e o painel de filtros
    // inteiro esvazia. Trocando, o tema também estreita as listas, como todo o resto.
    const T = fromTable('gold_platforms_campaigns', f);

    // TODA lista é filtrada por entrega, não só a de temas: o gold layer guarda linha
    // zerada para campanha que a plataforma reportou sem entregar nada, e sem o gate os
    // selects ofereciam 127 campanhas numa janela de 7 dias onde só 3 entregaram —
    // parecia que o filtro de data não estava sendo aplicado.
    const DELIVERED = `AND (${HAS_DELIVERY})`;

    // Two waves: platforms/objectives are trivial, campaigns/ads are the
    // heavier DISTINCT scans. Caps peak connections the same way sentimentos does.
    const [platforms, objectives, temas] = await Promise.all([
      pool.query(`SELECT DISTINCT platform FROM ${T} WHERE ${wPlat.sql} ${DELIVERED} ORDER BY platform`, wPlat.params),
      pool.query(`SELECT DISTINCT objective FROM ${T} WHERE ${wObj.sql} ${DELIVERED} AND objective IS NOT NULL AND objective != '' ORDER BY objective`, wObj.params),
      // Única query que sempre roda contra a view — é a fonte da lista de temas.
      // O gate de entrega é o que importa: a classificação está defasada (agosto/2026
      // zerado), então sem ele o select ofereceria 14 temas que só devolvem dashboard
      // vazio. Lista vazia é a resposta honesta para a janela corrente.
      pool.query(
        `SELECT DISTINCT eixo, eixo_label FROM gold_campaigns_classified
          WHERE ${wTema.sql} AND eixo IS NOT NULL AND (${HAS_DELIVERY}) ORDER BY eixo_label`,
        wTema.params
      ),
    ]);
    const [campaigns, ads] = await Promise.all([
      pool.query(`SELECT DISTINCT campaign_name FROM ${T} WHERE ${wCamp.sql} ${DELIVERED} AND campaign_name IS NOT NULL AND campaign_name != '' ORDER BY campaign_name`, wCamp.params),
      pool.query(`SELECT DISTINCT campaign_name, ad_name FROM ${T} WHERE ${wAd.sql} ${DELIVERED} AND ad_name IS NOT NULL AND ad_name != '' ORDER BY ad_name`, wAd.params),
    ]);

    const data = {
      platforms: (platforms[0] as { platform: string }[]).map((r) => r.platform),
      objectives: (objectives[0] as { objective: string }[]).map((r) => r.objective),
      temas: (temas[0] as { eixo: string; eixo_label: string | null }[]).map((r) => ({
        code: r.eixo, label: r.eixo_label ?? r.eixo,
      })),
      // 584 nomes crus viram ~30 rótulos de grupo. O cliente segue recebendo string[].
      campaigns: [...new Set((campaigns[0] as { campaign_name: string }[])
        .map((r) => groupOf(r.campaign_name, rules)))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      // O anúncio carrega o GRUPO da campanha, senão o filtro por campanha do cliente
      // (`a.campaign === campaign`) compararia rótulo com nome cru e esvaziaria a lista.
      // Dedupe porque o DISTINCT do banco é por nome cru: campanhas diferentes do
      // mesmo grupo com o mesmo anúncio virariam linhas repetidas no dropdown.
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
    console.error('[dashboard/filters]', e);
    if (isTransientDbError(e)) {
      resetPool();
      return NextResponse.json({ error: 'Conexão com o banco esgotou. Tente novamente.' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Erro ao carregar filtros' }, { status: 500 });
  }
}
