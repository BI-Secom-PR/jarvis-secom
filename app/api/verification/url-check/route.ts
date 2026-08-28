import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { checkUrls, URL_CHECK_BUDGET_MS, type UrlSampleItem } from '@/lib/urlCheck';

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
    return NextResponse.json({ rows, checked, failed });
  } catch (e) {
    console.error('[url-check] falhou:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
