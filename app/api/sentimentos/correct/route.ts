import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getRwPool, isTransientDbError, resetRwPool } from '@/lib/mysql';
import { SENTIMENTS } from '@/lib/sentimentos';

export const dynamic = 'force-dynamic';

const MAX_BATCH = 500;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { id?: unknown; ids?: unknown; sentiment?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  // `ids` = correção em lote (máx. MAX_BATCH); `id` continua aceito para uma só.
  const raw = Array.isArray(body.ids) ? body.ids : [body.id];
  const ids = [...new Set(raw.map(Number))];
  const sentiment = String(body.sentiment ?? '');
  if (
    !ids.length ||
    ids.length > MAX_BATCH ||
    !ids.every((n) => Number.isInteger(n) && n > 0) ||
    !(SENTIMENTS as readonly string[]).includes(sentiment)
  )
    return NextResponse.json({ error: 'ids ou sentimento inválido' }, { status: 400 });

  const pool = getRwPool();
  if (!pool)
    return NextResponse.json(
      { error: 'Correção indisponível: credencial MYSQL_RW_* não configurada no servidor.' },
      { status: 503 }
    );

  try {
    const [result] = await pool.query(
      `UPDATE silver_social_comments
       SET sentiment = ?, sentiment_source = 'human', audited_by = ?, audited_at = NOW()
       WHERE id IN (?)`,
      [sentiment, session.email, ids]
    );
    const affected = (result as { affectedRows: number }).affectedRows;
    if (!affected) return NextResponse.json({ error: 'Comentário(s) não encontrado(s)' }, { status: 404 });

    console.log('[sentimentos/correct]', JSON.stringify({ ids, sentiment, by: session.email }));
    return NextResponse.json({ id: ids[0], ids, updated: affected, sentiment, sentiment_source: 'human', audited_by: session.email });
  } catch (e) {
    console.error('[sentimentos/correct]', e);
    if (isTransientDbError(e)) {
      resetRwPool();
      return NextResponse.json(
        { error: 'Conexão com o banco esgotou. Tente novamente.' },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: 'Erro ao gravar correção' }, { status: 500 });
  }
}
