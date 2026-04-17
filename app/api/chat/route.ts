import { createGroq } from '@ai-sdk/groq';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, tool, stepCountIs } from 'ai';
import { Ollama } from 'ollama';
import { z } from 'zod/v3';
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/mysql';
import { getSystemPrompt, parseChartRequest, DEFAULT_MODEL, MODELS, getModelProvider, type ModelId } from '@/lib/agent';
import { getSession } from '@/lib/auth';

const VALID_MODEL_IDS = new Set(MODELS.map((m) => m.id));

const groq   = createGroq({ apiKey: process.env.GROQ_API_KEY });
const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
const ollamaClient = new Ollama({
  host: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  headers: process.env.OLLAMA_API_KEY
    ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` }
    : {},
});

function resolveModel(id: ModelId) {
  return getModelProvider(id) === 'google' ? google(id) : groq(id);
}

const SAFE_QUERY = /^\s*SELECT\b(?![\s\S]*\b(?:INTO\s+(?:OUTFILE|DUMPFILE)|LOAD_FILE)\b)[\s\S]+\bFROM\b/i;

async function executeSql(sql_query: string): Promise<unknown> {
  if (!SAFE_QUERY.test(sql_query))
    throw new Error('Only SELECT queries on airbyte_secom are allowed.');
  console.log('[SQL]', sql_query);
  const pool = getPool();
  const [rows] = await pool.query(sql_query);
  return (rows as Record<string, unknown>[]).map((row) => {
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row))
      clean[key] = typeof val === 'string' ? val.replace(/\|/g, '∣') : val;
    return clean;
  });
}

const OLLAMA_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'execute_sql_query',
    description: 'Executes a SELECT SQL query against airbyte_secom. Only SELECT on gold_* tables.',
    parameters: {
      type: 'object',
      properties: { sql_query: { type: 'string', description: 'A valid SELECT targeting only airbyte_secom.gold_* tables.' } },
      required: ['sql_query'],
    },
  },
};

type OllamaMessage = { role: string; content: string; tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[] };

async function runOllamaChat(
  modelId: string,
  systemPrompt: string,
  messages: { role: string; content: string }[],
): Promise<string> {
  const conv: OllamaMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })),
  ];

  for (let step = 0; step < 6; step++) {
    const response = await ollamaClient.chat({
      model: modelId,
      messages: conv,
      tools: [OLLAMA_TOOL_DEF],
    });

    const msg = response.message as OllamaMessage;
    conv.push(msg);

    if (!msg.tool_calls?.length) return msg.content ?? '';

    for (const tc of msg.tool_calls) {
      const args = tc.function.arguments as { sql_query?: string };
      let result: unknown;
      try {
        result = await executeSql(args.sql_query ?? '');
      } catch (e) {
        result = { error: e instanceof Error ? e.message : String(e) };
      }
      conv.push({ role: 'tool', content: JSON.stringify(result) });
    }
  }

  return conv.at(-1)?.content ?? '';
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { chatInput, messages: history = [], model: requestedModel } = await req.json();
  const modelId: ModelId = VALID_MODEL_IDS.has(requestedModel) ? requestedModel : DEFAULT_MODEL;

  const messages = [
    ...history,
    { role: 'user' as const, content: chatInput },
  ];

  try {
    let text: string;

    if (getModelProvider(modelId) === 'ollama') {
      text = await runOllamaChat(modelId, getSystemPrompt(), messages);
    } else {
      const result = await generateText({
        model: resolveModel(modelId),
        system: getSystemPrompt(),
        messages,
        stopWhen: stepCountIs(6),
        tools: {
          execute_sql_query: tool({
            description: 'Executes a SELECT SQL query against airbyte_secom. Only SELECT on gold_* tables.',
            inputSchema: z.object({
              sql_query: z.string().describe('A valid SELECT targeting only airbyte_secom.gold_* tables.'),
            }),
            execute: async ({ sql_query }) => executeSql(sql_query),
          }),
        },
      });
      text = result.text;
    }

    const { cleanText, chartData } = parseChartRequest(text);
    return NextResponse.json({ output: cleanText, chartData });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
