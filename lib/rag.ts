import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { embed as aiEmbed } from 'ai';
import { db } from '@/lib/db';
import { sqlExamples } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * RAG over the sql_examples library: embed the user question with Google
 * gemini-embedding-001 (the GOOGLE_GENERATIVE_AI_API_KEY is already used
 * for chat; the project's Ollama instance is ollama.com cloud, which has
 * no embedding models), brute-force cosine similarity against the stored
 * example embeddings (≤ a few hundred rows — microseconds), and return
 * the top-k as a prompt block.
 *
 * Failure-safe by design: any error (API down, empty table) returns ''
 * so the chat flow is never broken by RAG.
 */

export const EMBED_MODEL = process.env.EMBED_MODEL ?? 'gemini-embedding-001';
const EMBED_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });

export async function embed(text: string): Promise<number[]> {
  const res = await aiEmbed({ model: google.textEmbedding(EMBED_MODEL), value: text });
  if (!res.embedding?.length) throw new Error('empty embedding');
  return res.embedding;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

type CachedExample = { question: string; sql: string; embedding: number[] };
let cache: { rows: CachedExample[]; loadedAt: number } | null = null;

async function loadExamples(): Promise<CachedExample[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.rows;
  const rows = await db
    .select({ question: sqlExamples.question, sql: sqlExamples.sql, embedding: sqlExamples.embedding })
    .from(sqlExamples)
    .where(eq(sqlExamples.enabled, true));
  const valid = rows.filter((r): r is CachedExample => Array.isArray(r.embedding) && r.embedding.length > 0);
  cache = { rows: valid, loadedAt: Date.now() };
  return valid;
}

/** Invalidate the in-memory cache (used by the seed/admin paths). */
export function invalidateExampleCache() {
  cache = null;
}

/**
 * Returns a system-prompt block with the k most similar (question → SQL)
 * examples, or '' when unavailable. Never throws.
 */
export async function retrieveSimilarExamples(question: string, k = 3): Promise<string> {
  try {
    const examples = await loadExamples();
    if (!examples.length) return '';

    const queryVec = await Promise.race([
      embed(question),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('embed timeout')), EMBED_TIMEOUT_MS)),
    ]);

    const top = examples
      .map((e) => ({ ...e, score: cosine(queryVec, e.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .filter((e) => e.score > 0.4);

    if (!top.length) return '';

    const blocks = top
      .map((e) => `Pergunta: ${e.question}\nSQL:\n${e.sql}`)
      .join('\n\n');
    return `\n\n═══════════════════════════════════════════════
EXEMPLOS RECUPERADOS — perguntas semelhantes à do usuário (use como referência de SQL)
═══════════════════════════════════════════════
${blocks}`;
  } catch (e) {
    console.warn('[rag] retrieval skipped:', e instanceof Error ? e.message : e);
    return '';
  }
}
