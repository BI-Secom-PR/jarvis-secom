import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { urlVerdicts } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { checkUrls, URL_CHECK_BUDGET_MS, type UrlCheckedRow, type UrlSampleItem } from '@/lib/urlCheck';

export const maxDuration = 300;

/**
 * Audita um lote de URLs amostradas.
 *
 * O cliente manda uma fatia generosa e avança pelo `checked` que volta: quantas
 * cabem no orçamento depende da velocidade do modelo naquele momento (medido:
 * 8-33s por chamada de 10 URLs), e o servidor é quem sabe. Assim nenhuma
 * requisição encosta nos 300s e nada se perde quando o prazo vence no meio.
 */
export async function POST(req: NextRequest) {
  const deadline = Date.now() + URL_CHECK_BUDGET_MS;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { items?: UrlSampleItem[]; categorias?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const items = body.items;
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: 'items deve ser um array' }, { status: 400 });
  }
  if (items.length === 0) {
    return NextResponse.json({ rows: [], checked: 0, failed: 0 });
  }
  if (items.length > 2000) {
    return NextResponse.json({ error: 'items: máximo 2000 por chamada' }, { status: 400 });
  }
  for (const it of items) {
    if (typeof it?.url !== 'string' || typeof it?.categoria !== 'string' || typeof it?.veiculo !== 'string') {
      return NextResponse.json({ error: 'item inválido: url, categoria e veiculo são obrigatórios' }, { status: 400 });
    }
  }

  const categorias = Array.isArray(body.categorias) ? body.categorias.filter((c) => typeof c === 'string') : [];

  try {
    const { rows, checked, failed } = await checkUrls(items, categorias, deadline);
    await saveVerdicts(rows);
    return NextResponse.json({ rows, checked, failed });
  } catch (e) {
    console.error('[url-check] falhou:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/**
 * Guarda cada veredicto da IA para formar o conjunto de rótulos de um classificador leve.
 * Grava aqui, rodada a rodada, e não em /url-write: se a aba dormir no meio da verificação,
 * o que já foi auditado fica salvo. Falha de banco nunca derruba a auditoria. `reviewed`
 * (correção humana) não é tocado ao reauditar a mesma URL.
 */
async function saveVerdicts(rows: UrlCheckedRow[]) {
  const values = rows
    .filter((r) => r.source) // sem `source` = regra determinística (home), não é veredicto de modelo
    .map((r) => ({
      url: r.url,
      categoria: r.categoria,
      status: r.status,
      categoriaSugerida: r.categoria_sugerida,
      reason: r.reason || null,
      source: r.source!,
      veiculo: r.veiculo,
      impressoes: Math.round(r.impressoes),
    }));
  // Mesma URL/categoria duas vezes no lote (veículos diferentes) estoura o ON CONFLICT.
  const unique = [...new Map(values.map((v) => [`${v.url}\u0000${v.categoria}\u0000${v.source}`, v])).values()];
  try {
    for (let i = 0; i < unique.length; i += 500) {
      await db.insert(urlVerdicts).values(unique.slice(i, i + 500)).onConflictDoUpdate({
        target: [urlVerdicts.url, urlVerdicts.categoria, urlVerdicts.source],
        set: {
          status: sql`excluded.status`,
          categoriaSugerida: sql`excluded.categoria_sugerida`,
          reason: sql`excluded.reason`,
          veiculo: sql`excluded.veiculo`,
          impressoes: sql`excluded.impressoes`,
        },
      });
    }
  } catch (e) {
    console.error('[url-check] não gravou veredictos:', e instanceof Error ? e.message : e);
  }
}
