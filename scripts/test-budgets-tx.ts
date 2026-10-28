// Check do caminho de escrita dos orçamentos, SEMPRE em transação com ROLLBACK (nada persiste):
//   npx tsx --env-file=.env.local scripts/test-budgets-tx.ts
// Prova os GRANTs do usuário RW, a chave única (platform, campaign_id, ad_group_key) e que
// a edição + a linha de auditoria cabem na mesma transação.
import assert from 'node:assert/strict';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getRwPool } from '../lib/mysql';

(async () => {
  const pool = getRwPool();
  assert.ok(pool, 'MYSQL_RW_* não configurado');
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [before] = await c.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM gold_campaign_budgets_audit`);

    const [ins] = await c.query<ResultSetHeader>(
      `INSERT INTO gold_campaign_budgets (platform, level, campaign_id, ad_group_id, name, budget_total, budget_type,
         start_date, end_date, source_amount, source, active, updated_by)
       VALUES ('kwai', 'campaign', 'TEST-ROLLBACK', NULL, 'teste', 123.45, 'lifetime', '2026-10-01', '2026-10-31', NULL, 'manual', 1, 'test@example.invalid')`);
    await c.query(
      `INSERT INTO gold_campaign_budgets_audit (budget_id, action, old_values, new_values, changed_by) VALUES (?, 'create', NULL, ?, ?)`,
      [ins.insertId, JSON.stringify({ budget_total: 123.45 }), 'test@example.invalid']);

    // a mesma chave não entra duas vezes (ad_group_key gerada trata o NULL)
    await assert.rejects(c.query(
      `INSERT INTO gold_campaign_budgets (platform, level, campaign_id, ad_group_id, name, budget_total, budget_type, source, active)
       VALUES ('kwai', 'campaign', 'TEST-ROLLBACK', NULL, 'dup', 1, 'lifetime', 'manual', 1)`), /Duplicate/);

    await c.query(`UPDATE gold_campaign_budgets SET budget_total = 200, source = 'manual', updated_by = ? WHERE id = ?`, ['test@example.invalid', ins.insertId]);
    const [row] = await c.query<RowDataPacket[]>(`SELECT budget_total, source, updated_by FROM gold_campaign_budgets WHERE id = ?`, [ins.insertId]);
    assert.equal(Number(row[0]!.budget_total), 200);
    const [mid] = await c.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM gold_campaign_budgets_audit`);
    assert.equal(Number(mid[0]!.n), Number(before[0]!.n) + 1);

    // a auditoria é só-inserção para o app: UPDATE/DELETE nela têm de ser negados
    await assert.rejects(c.query(`UPDATE gold_campaign_budgets_audit SET changed_by = 'x' WHERE budget_id = ?`, [ins.insertId]), /denied|command/i);
    console.log('budgets-tx: ok (insert, chave única, update, audit, grants)');
  } finally {
    await c.rollback();
    const [after] = await c.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM gold_campaign_budgets WHERE campaign_id = 'TEST-ROLLBACK'`);
    console.log('linhas de teste após rollback:', after[0]!.n);
    c.release();
    process.exit(0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
