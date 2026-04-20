import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod/v3';
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/mysql';
import { getSystemPrompt, parseChartRequest, DEFAULT_MODEL, MODELS, getModelProvider, type ModelId } from '@/lib/agent';

const VALID_MODEL_IDS = new Set(MODELS.map((m) => m.id));

const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });

function resolveModel(id: ModelId) {
  return google(id);
}

export async function POST(req: NextRequest) {
  // Bearer token auth — no session cookie required
  const authHeader = req.headers.get('authorization');
  const key = authHeader?.replace(/^Bearer\s+/i, '');
  if (!key || key !== process.env.EXTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { query, model: requestedModel } = await req.json();
  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'Missing required field: query' }, { status: 400 });
  }

  const modelId: ModelId = VALID_MODEL_IDS.has(requestedModel) ? requestedModel : DEFAULT_MODEL;
  const pool = getPool();

  try {
    const { text } = await generateText({
      model: resolveModel(modelId),
      system: getSystemPrompt(),
      messages: [{ role: 'user' as const, content: query }],
      stopWhen: stepCountIs(6),
      tools: {
        execute_sql_query: tool({
          description:
            'Executes a SELECT SQL query against airbyte_secom. Only SELECT on gold_* tables.',
          inputSchema: z.object({
            sql_query: z
              .string()
              .describe('A valid SELECT targeting only airbyte_secom.gold_* tables.'),
          }),
          execute: async ({ sql_query }): Promise<unknown> => {
            const SAFE_QUERY = /^\s*SELECT\b(?![\s\S]*\b(?:INTO\s+(?:OUTFILE|DUMPFILE)|LOAD_FILE)\b)[\s\S]+\bFROM\b/i;
            if (!SAFE_QUERY.test(sql_query))
              throw new Error('Only SELECT queries on airbyte_secom are allowed.');
            console.log('[SQL][external]', sql_query);
            const [rows] = await pool.query(sql_query);
            const sanitized = (rows as Record<string, unknown>[]).map((row) => {
              const clean: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(row)) {
                clean[k] = typeof v === 'string' ? v.replace(/\|/g, '∣') : v;
              }
              return clean;
            });
            return sanitized;
          },
        }),
      },
    });

    const { cleanText, chartData } = parseChartRequest(text);
    return NextResponse.json({ output: cleanText, chartData: chartData ?? null });
  } catch (err) {
    const status = (err as { statusCode?: number; status?: number }).statusCode
      ?? (err as { statusCode?: number; status?: number }).status;
    if (status === 429) {
      return NextResponse.json(
        { error: `Rate limit reached for model "${modelId}". Try again shortly.` },
        { status: 429 },
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
