import { NextRequest, NextResponse } from 'next/server';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getSession } from '@/lib/auth';
import { getPool, getRwPool, isTransientDbError, resetRwPool } from '@/lib/mysql';
import { ISO_DATE, type DashboardFilters } from '@/lib/dashboard';
import { loadBudgetList } from '@/lib/pacingQuery';

export const dynamic = 'force-dynamic';

// Orçamentos do pacing (`gold_campaign_budgets`, mantida pela sessão do MySQL). O job
// diário insere/atualiza as linhas `auto`; aqui o usuário ajusta. Toda escrita vira
// `source='manual'` (o job nunca mais mexe no valor) e grava a auditoria na MESMA
// transação — o MySQL não sabe quem é o usuário do app, então quem audita é esta rota.

const COLS = `id, platform, level, campaign_id, ad_group_id, name, budget_total, budget_type,
  start_date, end_date, source_amount, source, active, updated_by, updated_at`;

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
const day = (v: unknown): string | null | undefined => {
  if (v === null || v === '') return null;
  return typeof v === 'string' && ISO_DATE.test(v) ? v : undefined; // undefined = inválido
};
const amountOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e10 ? Math.round(v * 100) / 100 : null;

function failure(e: unknown) {
  console.error('[dashboard/budgets]', e);
  if (isTransientDbError(e)) {
    resetRwPool();
    return NextResponse.json({ error: 'Conexão com o banco esgotou. Tente novamente.' }, { status: 503 });
  }
  return NextResponse.json({ error: 'Erro ao salvar o orçamento' }, { status: 500 });
}

/** BEGIN … COMMIT numa conexão do pool de escrita; qualquer erro desfaz tudo. */
async function inTx<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T | 'no-rw'> {
  const pool = getRwPool();
  if (!pool) return 'no-rw';
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const out = await fn(c);
    await c.commit();
    return out;
  } catch (e) {
    await c.rollback().catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const audit = (c: PoolConnection, budgetId: number, action: 'create' | 'update' | 'delete',
  oldValues: unknown, newValues: unknown, email: string) =>
  c.query(
    `INSERT INTO gold_campaign_budgets_audit (budget_id, action, old_values, new_values, changed_by)
     VALUES (?, ?, ?, ?, ?)`,
    [budgetId, action, oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null, email]
  );

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const q = req.nextUrl.searchParams;
  try {
    const history = q.get('history');
    if (history) {
      const [rows] = await getPool().query(
        `SELECT id, action, old_values, new_values, changed_by, changed_at
           FROM gold_campaign_budgets_audit WHERE budget_id = ? ORDER BY id DESC LIMIT 50`,
        [Number(history) || 0]
      );
      return NextResponse.json({ history: rows });
    }
    const all = (k: string) => q.getAll(k).filter(Boolean);
    const f: DashboardFilters = {
      from: ISO_DATE.test(q.get('from') ?? '') ? q.get('from')! : undefined,
      to: ISO_DATE.test(q.get('to') ?? '') ? q.get('to')! : undefined,
      campaigns: all('campaign'), platform: all('platform'), network: all('networks'), account: all('account'),
      adGroup: all('adGroup'), objective: all('objective'), buyingType: all('buyingType'), tema: all('tema'),
    };
    const { rows, truncated } = await loadBudgetList(getPool(), f);
    return NextResponse.json({ budgets: rows, truncated });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const email = session.email;

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return bad('JSON inválido'); }
  const platform = typeof b.platform === 'string' ? b.platform.trim() : '';
  const level = b.level === 'ad_group' ? 'ad_group' : b.level === 'campaign' ? 'campaign' : null;
  const campaignId = typeof b.campaign_id === 'string' ? b.campaign_id.trim() : '';
  const adGroupId = level === 'ad_group' && typeof b.ad_group_id === 'string' ? b.ad_group_id.trim() : '';
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 500) : '';
  const amount = amountOf(b.budget_total);
  const type = b.budget_type === 'daily' ? 'daily' : 'lifetime';
  const start = day(b.start_date), end = day(b.end_date);
  if (!platform || platform.length > 30 || !level || !campaignId || campaignId.length > 100) return bad('Plataforma, nível e campanha são obrigatórios');
  if (level === 'ad_group' && (!adGroupId || adGroupId.length > 100)) return bad('Conjunto sem id');
  if (amount === null) return bad('Valor inválido');
  if (start === undefined || end === undefined) return bad('Data inválida (AAAA-MM-DD)');
  if (start && end && start > end) return bad('A data final vem antes da inicial');

  try {
    const out = await inTx(async (c) => {
      // Mesma chave do job: uma linha por (plataforma, campanha, conjunto). Se o usuário
      // já a apagou (active=0), recadastrar ressuscita a linha em vez de duplicar.
      const [ex] = await c.query<RowDataPacket[]>(
        `SELECT ${COLS} FROM gold_campaign_budgets
          WHERE platform = ? AND campaign_id = ? AND ad_group_key = ? FOR UPDATE`,
        [platform, campaignId, adGroupId]
      );
      const next = { name, budget_total: amount, budget_type: type, start_date: start, end_date: end, active: 1 };
      if (ex[0]) {
        if (ex[0].active) return { conflict: true as const };
        await c.query(
          `UPDATE gold_campaign_budgets SET name=?, budget_total=?, budget_type=?, start_date=?, end_date=?,
                  active=1, source='manual', updated_by=? WHERE id=?`,
          [name || ex[0].name, amount, type, start, end, email, ex[0].id]
        );
        await audit(c, ex[0].id, 'create', ex[0], next, email);
        return { id: ex[0].id as number };
      }
      const [r] = await c.query<import('mysql2/promise').ResultSetHeader>(
        `INSERT INTO gold_campaign_budgets
           (platform, level, campaign_id, ad_group_id, name, budget_total, budget_type, start_date, end_date,
            source_amount, source, active, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'manual', 1, ?)`,
        [platform, level, campaignId, level === 'ad_group' ? adGroupId : null, name, amount, type, start, end, email]
      );
      await audit(c, r.insertId, 'create', null, { platform, level, campaign_id: campaignId, ad_group_id: adGroupId || null, ...next }, email);
      return { id: r.insertId };
    });
    if (out === 'no-rw') return NextResponse.json({ error: 'Escrita no MySQL não configurada' }, { status: 503 });
    if ('conflict' in out) return NextResponse.json({ error: 'Já existe orçamento para essa campanha/conjunto — edite a linha existente' }, { status: 409 });
    console.log(`[budgets] ${email} criou #${out.id}`);
    return NextResponse.json({ ok: true, id: out.id });
  } catch (e) {
    return failure(e);
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const email = session.email;

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return bad('JSON inválido'); }
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return bad('id inválido');
  const amount = amountOf(b.budget_total);
  const start = day(b.start_date), end = day(b.end_date);
  const type = b.budget_type === 'daily' ? 'daily' : 'lifetime';
  if (amount === null) return bad('Valor inválido');
  if (start === undefined || end === undefined) return bad('Data inválida (AAAA-MM-DD)');
  if (start && end && start > end) return bad('A data final vem antes da inicial');

  try {
    const out = await inTx(async (c) => {
      const [ex] = await c.query<RowDataPacket[]>(`SELECT ${COLS} FROM gold_campaign_budgets WHERE id = ? AND active = 1 FOR UPDATE`, [id]);
      if (!ex[0]) return null;
      await c.query(
        `UPDATE gold_campaign_budgets SET budget_total=?, budget_type=?, start_date=?, end_date=?,
                source='manual', updated_by=? WHERE id=?`,
        [amount, type, start, end, email, id]
      );
      const pick = (r: Record<string, unknown>) => ({
        budget_total: Number(r.budget_total), budget_type: r.budget_type, start_date: day(r.start_date instanceof Date ? r.start_date.toISOString().slice(0, 10) : r.start_date),
        end_date: day(r.end_date instanceof Date ? r.end_date.toISOString().slice(0, 10) : r.end_date),
      });
      await audit(c, id, 'update', pick(ex[0]), { budget_total: amount, budget_type: type, start_date: start, end_date: end }, email);
      return true;
    });
    if (out === 'no-rw') return NextResponse.json({ error: 'Escrita no MySQL não configurada' }, { status: 503 });
    if (!out) return NextResponse.json({ error: 'Orçamento não encontrado' }, { status: 404 });
    console.log(`[budgets] ${email} editou #${id}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const email = session.email;
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return bad('id inválido');

  try {
    // Soft-delete: `active=0` é o que impede o job diário de recriar a linha.
    const out = await inTx(async (c) => {
      const [ex] = await c.query<RowDataPacket[]>(`SELECT ${COLS} FROM gold_campaign_budgets WHERE id = ? AND active = 1 FOR UPDATE`, [id]);
      if (!ex[0]) return null;
      await c.query(`UPDATE gold_campaign_budgets SET active=0, source='manual', updated_by=? WHERE id=?`, [email, id]);
      await audit(c, id, 'delete', { budget_total: Number(ex[0].budget_total), active: 1 }, { active: 0 }, email);
      return true;
    });
    if (out === 'no-rw') return NextResponse.json({ error: 'Escrita no MySQL não configurada' }, { status: 503 });
    if (!out) return NextResponse.json({ error: 'Orçamento não encontrado' }, { status: 404 });
    console.log(`[budgets] ${email} apagou #${id}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
