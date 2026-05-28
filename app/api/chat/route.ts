import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, tool, stepCountIs } from 'ai';
import { Ollama, type Tool as OllamaTool } from 'ollama';
import { z } from 'zod/v3';
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/mysql';
import { getSystemPrompt, parseChartRequest, DEFAULT_MODEL, MODELS, getModelProvider, type ModelId } from '@/lib/agent';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { fileExports } from '@/lib/db/schema';
import { generateExport, MIME, type ChartSpec, type ExportFormat } from '@/lib/exports/generate';

const VALID_MODEL_IDS = new Set(MODELS.map((m) => m.id));

const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
const ollamaClient = new Ollama({
  host: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  headers: process.env.OLLAMA_API_KEY
    ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` }
    : {},
});

function resolveModel(id: ModelId) {
  return google(id);
}

const SAFE_QUERY = /^\s*SELECT\b(?![\s\S]*\b(?:INTO\s+(?:OUTFILE|DUMPFILE)|LOAD_FILE)\b)[\s\S]+\bFROM\b/i;
const BLOCKED_PATTERNS = /\b(UNION[\s\S]*SELECT|SLEEP\s*\(|BENCHMARK\s*\(|INFORMATION_SCHEMA|mysql\s*\.|sys\s*\.|performance_schema)\b/i;
const EXPORT_TTL_DAYS = 7;
const EXPORT_ROW_CAP = 50_000;

async function executeSql(sql_query: string): Promise<Record<string, unknown>[]> {
  if (!SAFE_QUERY.test(sql_query) || BLOCKED_PATTERNS.test(sql_query))
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

interface CreateDownloadArgs {
  format: ExportFormat;
  sql_query: string;
  title?: string;
  filename?: string;
  chart?: ChartSpec;
  report_text?: string;
}

interface CreateDownloadCtx {
  userId: string;
  chatSessionId?: string | null;
}

async function createDownloadFile(args: CreateDownloadArgs, ctx: CreateDownloadCtx) {
  const rows = await executeSql(args.sql_query);
  if (rows.length > EXPORT_ROW_CAP) {
    throw new Error(`Resultado muito grande (${rows.length} linhas). Refine a query (limite: ${EXPORT_ROW_CAP}).`);
  }

  const { buffer, mimeType, filename } = await generateExport({
    format: args.format,
    rows,
    title: args.title,
    filename: args.filename,
    chart: args.chart,
    report_text: args.report_text,
  });

  const expiresAt = new Date(Date.now() + EXPORT_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(fileExports)
    .values({
      userId: ctx.userId,
      chatSessionId: ctx.chatSessionId ?? null,
      filename,
      mimeType,
      bytes: buffer,
      sizeBytes: buffer.byteLength,
      expiresAt,
    })
    .returning({ id: fileExports.id });

  return {
    url: `/api/exports/${row.id}`,
    filename,
    rowCount: rows.length,
    sizeBytes: buffer.byteLength,
    mimeType,
  };
}

const OLLAMA_TOOL_DEFS = ([
  {
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
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_download_file',
      description: 'Generates a downloadable file (xlsx/csv/pdf) from a SELECT query and returns a URL. Use ONLY when the user explicitly asks for a download/export.',
      parameters: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['xlsx', 'csv', 'pdf'] },
          sql_query: { type: 'string', description: 'SELECT on gold_* tables; results become the file content.' },
          title: { type: 'string', description: 'Optional human-readable title.' },
          filename: { type: 'string', description: 'Optional base filename (extension auto-added).' },
          chart: {
            type: 'object',
            description: 'Optional chart, only used for PDF.',
            properties: {
              type: { type: 'string', enum: ['bar', 'line', 'pie'] },
              title: { type: 'string' },
              labels: { type: 'array', items: { type: 'string' } },
              datasets: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    data: { type: 'array', items: { type: 'number' } },
                  },
                  required: ['label', 'data'],
                },
              },
            },
            required: ['type', 'labels', 'datasets'],
          },
          report_text: {
            type: 'string',
            description: 'Structured report content for PDF. Use markers: [METRICS] Label: Valor | ... then [PLATFORMS] lista, then ## sections with * bullets using **negrito**.',
          },
        },
        required: ['format', 'sql_query'],
      },
    },
  },
] as unknown as OllamaTool[]);

type OllamaMessage = { role: string; content: string; tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[] };

async function runOllamaChat(
  modelId: string,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  ctx: CreateDownloadCtx,
): Promise<string> {
  const conv: OllamaMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })),
  ];

  for (let step = 0; step < 6; step++) {
    const response = await ollamaClient.chat({
      model: modelId,
      messages: conv,
      tools: OLLAMA_TOOL_DEFS,
    });

    const msg = response.message as OllamaMessage;
    conv.push(msg);

    if (!msg.tool_calls?.length) return msg.content ?? '';

    for (const tc of msg.tool_calls) {
      const name = tc.function.name;
      const args = tc.function.arguments as Record<string, unknown>;
      let result: unknown;
      try {
        if (name === 'execute_sql_query') {
          result = await executeSql(String(args.sql_query ?? ''));
        } else if (name === 'create_download_file') {
          result = await createDownloadFile(args as unknown as CreateDownloadArgs, ctx);
        } else {
          result = { error: `Unknown tool: ${name}` };
        }
      } catch (e) {
        console.error(`[${name}] error:`, e);
        result = { error: e instanceof Error ? e.message : String(e) };
      }
      conv.push({ role: 'tool', content: JSON.stringify(result) });
    }
  }

  return conv.at(-1)?.content ?? '';
}

const CHART_SPEC_SCHEMA = z.object({
  type: z.enum(['bar', 'line', 'pie']),
  title: z.string().optional(),
  labels: z.array(z.string()),
  datasets: z.array(z.object({ label: z.string(), data: z.array(z.number()) })),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { chatInput, messages: history = [], model: requestedModel, chatSessionId } = await req.json();
  const modelId: ModelId = VALID_MODEL_IDS.has(requestedModel) ? requestedModel : DEFAULT_MODEL;

  const messages = [
    ...history,
    { role: 'user' as const, content: chatInput },
  ];

  const ctx: CreateDownloadCtx = {
    userId: session.id,
    chatSessionId: typeof chatSessionId === 'string' ? chatSessionId : null,
  };

  try {
    let text: string;

    if (getModelProvider(modelId) === 'ollama') {
      text = await runOllamaChat(modelId, getSystemPrompt(), messages, ctx);
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
          create_download_file: tool({
            description:
              'Generates a downloadable file (xlsx/csv/pdf) from a SELECT and returns a URL. Use ONLY when the user explicitly asks to export/download/save as file.',
            inputSchema: z.object({
              format: z.enum(['xlsx', 'csv', 'pdf']),
              sql_query: z.string().describe('SELECT on gold_* tables; rows become the file content.'),
              title: z.string().optional(),
              filename: z.string().optional(),
              chart: CHART_SPEC_SCHEMA.optional().describe('Optional chart embedded in PDF only.'),
              report_text: z.string().optional().describe('Structured report content for PDF: [METRICS] blocks, [PLATFORMS] block, ## sections, * bullets with **negrito**.'),
            }),
            execute: async (args) => {
              try {
                return await createDownloadFile(args as CreateDownloadArgs, ctx);
              } catch (e) {
                console.error('[create_download_file] error:', e);
                throw e;
              }
            },
          }),
        },
      });
      text = result.text;
    }

    const { cleanText, chartData } = parseChartRequest(text);
    return NextResponse.json({ output: cleanText, chartData });
  } catch (err) {
    console.error('[POST /api/chat] error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Suppress unused-import warning for MIME (re-exported for callers).
void MIME;
