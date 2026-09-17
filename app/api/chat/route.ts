import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, streamText, tool, stepCountIs } from 'ai';
import { Ollama, type Tool as OllamaTool } from 'ollama';
import { z } from 'zod/v3';
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/mysql';
import { getSystemPrompt, parseChartRequest, chartGate, DEFAULT_MODEL, MODELS, getModelProvider, type ModelId } from '@/lib/agent';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { fileExports } from '@/lib/db/schema';
import { generateExport, MIME, type ChartSpec, type ExportFormat } from '@/lib/exports/generate';
import { retrieveSimilarExamples } from '@/lib/rag';
import { sseResponse } from '@/lib/sse';

// Ollama-cloud Gemma with the multi-step SQL tool loop routinely runs past
// Vercel's default function duration; the platform then kills the function
// and returns a plain-text body the client can't JSON-parse.
export const maxDuration = 300;

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

const SAFE_QUERY = /^\s*(?:WITH\b|SELECT\b)(?![\s\S]*\b(?:INTO\s+(?:OUTFILE|DUMPFILE)|LOAD_FILE)\b)[\s\S]+\bFROM\b/i;
const BLOCKED_PATTERNS = /\b(UNION[\s\S]*SELECT|SLEEP\s*\(|BENCHMARK\s*\(|INFORMATION_SCHEMA|mysql\s*\.|sys\s*\.|performance_schema)\b|gold_platforms_/i;
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
  // 'pdf' is accepted as a legacy alias (stale history / model habit) and
  // normalized to 'html' before generation.
  format: ExportFormat | 'pdf';
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
  const format: ExportFormat = args.format === 'pdf' ? 'html' : args.format;
  const rows = await executeSql(args.sql_query);
  if (rows.length > EXPORT_ROW_CAP) {
    throw new Error(`Resultado muito grande (${rows.length} linhas). Refine a query (limite: ${EXPORT_ROW_CAP}).`);
  }

  const { buffer, mimeType, filename } = await generateExport({
    format,
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
      description: 'Generates a downloadable file (xlsx/csv/html) from a SELECT query and returns a URL. HTML reports open in a browser tab where the user saves them as PDF via the print dialog. Use ONLY when the user explicitly asks for a download/export/report file.',
      parameters: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['xlsx', 'csv', 'html'] },
          sql_query: { type: 'string', description: 'SELECT on gold_* tables; results become the file content.' },
          title: { type: 'string', description: 'Optional human-readable title.' },
          filename: { type: 'string', description: 'Optional base filename (extension auto-added).' },
          chart: {
            type: 'object',
            description: 'Optional chart, only used for HTML reports (rendered as inline SVG).',
            properties: {
              type: { type: 'string', enum: ['bar', 'line', 'area', 'pie'] },
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
            description: 'Structured report content for HTML reports. Use markers: [METRICS] Label: Valor | ... then [PLATFORMS] lista, then ## sections with * bullets using **negrito**.',
          },
        },
        required: ['format', 'sql_query'],
      },
    },
  },
] as unknown as OllamaTool[]);

type OllamaMessage = { role: string; content: string; tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[] };

/** Streaming callbacks. Both optional — omitted means the old buffered behaviour. */
interface Hooks {
  onDelta?: (text: string) => void;
  onStatus?: (phase: 'rag' | 'thinking' | 'sql' | 'answering') => void;
}

// A step that calls a tool sometimes emits a short preamble before the
// tool_calls arrive. Hold that much text back until we know which kind of step
// this is, so the preamble never reaches the client (or TTS).
// ponytail: fixed gate, not a parse of Ollama's chunk ordering. Ceiling — a
// genuine answer shorter than the gate is delivered at end-of-step instead of
// incrementally.
const PREAMBLE_GATE = 48;

/** One Ollama round-trip. Streams content deltas through `onDelta` when given. */
async function ollamaStep(
  modelId: string,
  conv: OllamaMessage[],
  onDelta?: (text: string) => void,
): Promise<OllamaMessage> {
  if (!onDelta) {
    const res = await ollamaClient.chat({ model: modelId, messages: conv, tools: OLLAMA_TOOL_DEFS });
    return res.message as OllamaMessage;
  }

  const stream = await ollamaClient.chat({
    model: modelId,
    messages: conv,
    tools: OLLAMA_TOOL_DEFS,
    stream: true,
  });

  let content = '';
  let flushed = false;
  const toolCalls: NonNullable<OllamaMessage['tool_calls']> = [];

  for await (const chunk of stream) {
    const msg = chunk.message as OllamaMessage | undefined;
    if (!msg) continue;
    if (msg.tool_calls?.length) toolCalls.push(...msg.tool_calls);
    if (!msg.content) continue;
    content += msg.content;
    if (toolCalls.length) continue;          // tool step — never surface its text
    if (flushed) { onDelta(msg.content); continue; }
    if (content.length >= PREAMBLE_GATE) { flushed = true; onDelta(content); }
  }
  if (!flushed && !toolCalls.length && content) onDelta(content);

  return { role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
}

async function runOllamaChat(
  modelId: string,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  ctx: CreateDownloadCtx,
  hooks: Hooks = {},
): Promise<string> {
  const conv: OllamaMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })),
  ];

  for (let step = 0; step < 6; step++) {
    hooks.onStatus?.('thinking');
    const msg = await ollamaStep(modelId, conv, hooks.onDelta);
    conv.push(msg);

    if (!msg.tool_calls?.length) return msg.content ?? '';

    for (const tc of msg.tool_calls) {
      if (tc.function.name === 'execute_sql_query') hooks.onStatus?.('sql');
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
  type: z.enum(['bar', 'line', 'area', 'pie']),
  title: z.string().optional(),
  labels: z.array(z.string()),
  datasets: z.array(z.object({ label: z.string(), data: z.array(z.number()) })),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { chatInput, messages: history = [], model: requestedModel, chatSessionId, stream: wantsStream } = await req.json();
  const modelId: ModelId = VALID_MODEL_IDS.has(requestedModel) ? requestedModel : DEFAULT_MODEL;

  const messages = [
    ...history,
    { role: 'user' as const, content: chatInput },
  ];

  const ctx: CreateDownloadCtx = {
    userId: session.id,
    chatSessionId: typeof chatSessionId === 'string' ? chatSessionId : null,
  };

  /** Runs the model and returns the full reply. Streams through `hooks` if given. */
  const run = async (hooks: Hooks = {}): Promise<string> => {
    // RAG: append the most similar (question → SQL) examples; '' on any failure
    hooks.onStatus?.('rag');
    const ragBlock = await retrieveSimilarExamples(String(chatInput ?? ''));
    const systemPrompt = getSystemPrompt() + ragBlock;

    if (getModelProvider(modelId) === 'ollama') {
      return runOllamaChat(modelId, systemPrompt, messages, ctx, hooks);
    }

    const opts = {
      model: resolveModel(modelId),
      system: systemPrompt,
      messages,
      stopWhen: stepCountIs(6),
      tools: {
        execute_sql_query: tool({
          description: 'Executes a SELECT SQL query against airbyte_secom. Only SELECT on gold_* tables.',
          inputSchema: z.object({
            sql_query: z.string().describe('A valid SELECT targeting only airbyte_secom.gold_* tables.'),
          }),
          execute: async ({ sql_query }: { sql_query: string }) => {
            hooks.onStatus?.('sql');
            return executeSql(sql_query);
          },
        }),
        create_download_file: tool({
          description:
            'Generates a downloadable file (xlsx/csv/html) from a SELECT and returns a URL. HTML reports open in a browser tab where the user saves them as PDF via the print dialog. Use ONLY when the user explicitly asks to export/download/save as file.',
          inputSchema: z.object({
            // 'pdf' kept as undocumented alias so stale history doesn't fail validation
            format: z.enum(['xlsx', 'csv', 'html', 'pdf']),
            sql_query: z.string().describe('SELECT on gold_* tables; rows become the file content.'),
            title: z.string().optional(),
            filename: z.string().optional(),
            chart: CHART_SPEC_SCHEMA.optional().describe('Optional chart embedded in HTML reports only (inline SVG).'),
            report_text: z.string().optional().describe('Structured report content for HTML reports: [METRICS] blocks, [PLATFORMS] block, ## sections, * bullets with **negrito**.'),
          }),
          execute: async (args: CreateDownloadArgs) => {
            try {
              return await createDownloadFile(args, ctx);
            } catch (e) {
              console.error('[create_download_file] error:', e);
              throw e;
            }
          },
        }),
      },
    };

    hooks.onStatus?.('thinking');
    if (!hooks.onDelta) return (await generateText(opts)).text;

    const result = streamText(opts);
    for await (const delta of result.textStream) hooks.onDelta(delta);
    return result.text;
  };

  if (wantsStream !== true) {
    try {
      const { cleanText, chartData } = parseChartRequest(await run());
      return NextResponse.json({ output: cleanText, chartData });
    } catch (err) {
      console.error('[POST /api/chat] error:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Streaming branch. sseResponse turns a throw into a final
  // `{ type: 'error' }` frame, which is what makes a Vercel-killed run legible
  // to the client instead of an unparseable plain-text body.
  return sseResponse(async (send) => {
    let answering = false;
    const emit = chartGate((text) => {
      if (!answering) {
        answering = true;
        send({ type: 'status', phase: 'answering' });
      }
      send({ type: 'delta', text });
    });

    const text = await run({
      onDelta: emit.push,
      onStatus: (phase) => send({ type: 'status', phase }),
    });
    // Mandatory: releases the partial-sentinel tail the gate was holding.
    emit.flush();
    send({ type: 'done', chartData: parseChartRequest(text).chartData });
  });
}

// Suppress unused-import warning for MIME (re-exported for callers).
void MIME;
