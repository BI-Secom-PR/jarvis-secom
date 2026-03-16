import { createGroq } from '@ai-sdk/groq';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod/v3';
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/mysql';
import { SYSTEM_PROMPT, parseChartRequest, DEFAULT_MODEL, MODELS, getModelProvider, type ModelId } from '@/lib/agent';

const VALID_MODEL_IDS = new Set(MODELS.map((m) => m.id));

const groq   = createGroq({ apiKey: process.env.GROQ_API_KEY });
const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });

function resolveModel(id: ModelId) {
  return getModelProvider(id) === 'google' ? google(id) : groq(id);
}

export async function POST(req: NextRequest) {
  const { chatInput, messages: history = [], model: requestedModel } = await req.json();
  const modelId: ModelId = VALID_MODEL_IDS.has(requestedModel) ? requestedModel : DEFAULT_MODEL;
  const pool = getPool();

  const messages = [
    ...history,
    { role: 'user' as const, content: chatInput },
  ];

  try {
    const { text } = await generateText({
      model: resolveModel(modelId),
      system: SYSTEM_PROMPT,
      messages,
      stopWhen: stepCountIs(6),
      tools: {
        execute_sql_query: tool({
          description:
            'Executes a SELECT SQL query against airbyte_secom. Only SELECT on gold_* tables.',
          inputSchema: z.object({
            sql_query: z
              .string()
              .describe(
                'A valid SELECT targeting only airbyte_secom.gold_* tables.',
              ),
          }),
          execute: async ({ sql_query }): Promise<unknown> => {
            if (!/^\s*SELECT/i.test(sql_query))
              throw new Error('Only SELECT queries are allowed.');
            const [rows] = await pool.query(sql_query);
            return rows;
          },
        }),
      },
    });

    const { cleanText, chartData } = parseChartRequest(text);
    return NextResponse.json({ output: cleanText, chartData });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
