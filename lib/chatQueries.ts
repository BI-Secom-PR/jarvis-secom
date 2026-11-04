import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { chatQueries, chatSessions } from '@/lib/db/schema';

/**
 * Memória de consultas por conversa. O modelo é stateless e o histórico que o cliente
 * reenvia é só texto: sem isso, "adicione a plataforma" fazia o modelo reescrever o SQL
 * do zero (e às vezes nem executá-lo, copiando a tabela anterior). Aqui o servidor guarda
 * o SQL executado e o devolve no prompt do turno seguinte.
 *
 * Failure-safe como o RAG: qualquer erro (inclusive tabela ainda não migrada) vira
 * no-op / '' e o chat segue normalmente.
 */

const KEEP = 3;          // consultas devolvidas ao modelo
const MAX_SQL = 8000;    // teto por consulta guardada

/** O `chatSessionId` vem do cliente: só vale se a conversa for do usuário logado. */
export async function ownedChatSession(userId: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  try {
    const [row] = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, userId)))
      .limit(1);
    return row?.id ?? null;
  } catch {
    return null; // id malformado ou banco indisponível
  }
}

/** Guarda um SQL executado com sucesso. Fire-and-forget — nunca lança. */
export async function recordQuery(chatSessionId: string | null, sql: string, rowCount: number): Promise<void> {
  if (!chatSessionId) return;
  try {
    await db.insert(chatQueries).values({ chatSessionId, sql: sql.slice(0, MAX_SQL), rowCount });
  } catch (e) {
    console.warn('[chat_queries] record failed:', e instanceof Error ? e.message : e);
  }
}

/** Bloco de prompt com as últimas consultas da conversa ('' se não houver / em erro). */
export async function lastQueriesBlock(chatSessionId: string | null): Promise<string> {
  if (!chatSessionId) return '';
  try {
    const rows = await db
      .select({ sql: chatQueries.sql, rowCount: chatQueries.rowCount })
      .from(chatQueries)
      .where(eq(chatQueries.chatSessionId, chatSessionId))
      .orderBy(desc(chatQueries.createdAt))
      .limit(KEEP);
    if (!rows.length) return '';
    const list = rows.map((r, i) => `[${i + 1}] (${r.rowCount} linhas)\n${r.sql}`).join('\n\n');
    return (
      '\n\nCONSULTAS JÁ EXECUTADAS NESTA CONVERSA (da mais recente para a mais antiga):\n' +
      list +
      '\n\nSe o usuário pedir para adicionar, remover ou detalhar algo do resultado anterior, PARTA do SQL [1] e ' +
      'altere só o necessário, mantendo filtros, agrupamento, ranking e LIMIT, e execute de novo com ' +
      'execute_sql_query. Se a pergunta for nova e não relacionada, ignore este bloco.'
    );
  } catch {
    return '';
  }
}
