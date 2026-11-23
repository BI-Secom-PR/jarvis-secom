// Mede o prompt do url-check contra os vereditos da equipe (191 URLs). Uso:
//   URL_CHECK_OLLAMA_URL= npx tsx --env-file=.env.local scripts/eval-url-prompt.ts <modulo.ts> <full|compact> <saida.json>
// Chama o Google direto (temperature 0), lotes de 10, concorrência 4. Não toca em banco.
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { Ollama } from 'ollama';
import fs from 'node:fs';
import path from 'node:path';

const R = 'verification/verifications_url/_rotulos';
const [modPath, kind, outPath] = process.argv.slice(2);
const rows = (JSON.parse(fs.readFileSync(process.argv[5] ?? `${R}/humano_equipe.json`, 'utf8')) as any[]).filter((r) => r.h === 'CORRETA' || r.h === 'INCORRETA');
const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
const MODEL = process.env.URL_CHECK_MODEL ?? 'gemini-3.5-flash-lite';
// EVAL_PROVIDER=ollama → Ollama Cloud (OLLAMA_BASE_URL + OLLAMA_API_KEY), modelo EVAL_OLLAMA_MODEL (padrão gemma4:31b-cloud)
const USE_OLLAMA = process.env.EVAL_PROVIDER === 'ollama';
const OLLAMA_MODEL = process.env.EVAL_OLLAMA_MODEL ?? 'gemma4:31b-cloud';
const ollama = USE_OLLAMA ? new Ollama({ host: process.env.OLLAMA_BASE_URL, headers: { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } }) : null;
async function ask(prompt: string, n: number): Promise<string> {
  if (ollama) {
    const r = await ollama.chat({ model: OLLAMA_MODEL, think: false, options: { temperature: 0, num_predict: 220 * n }, messages: [{ role: 'user', content: prompt }] });
    return r.message.content.trim();
  }
  const { text } = await generateText({ model: google(MODEL), prompt, maxOutputTokens: 220 * n, temperature: 0, maxRetries: 0, abortSignal: AbortSignal.timeout(90_000) });
  return text.trim();
}

async function main() {
const mod = await import(path.resolve(modPath));
const build = kind === 'compact' ? mod.buildCompactPrompt : mod.buildFullPrompt;
const chunks: any[][] = [];
for (let i = 0; i < rows.length; i += 10) chunks.push(rows.slice(i, i + 10));
const prev: Record<string, { status: string; sug: string; why: string; rot?: string; pag?: string; raw?: string }> = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
const out: Record<string, { status: string; sug: string; why: string; rot?: string; pag?: string; raw?: string }> = Object.fromEntries(Object.entries(prev).filter(([, v]) => v.status !== 'ERRO'));
let next = 0;
async function worker() {
  while (next < chunks.length) {
    const c = chunks[next++].filter((r) => !out[r.id]);
    if (!c.length) continue;
    const items = c.map((r) => ({ url: r.url, categoria: r.categoria, veiculo: '', impressoes: 0 }));
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const text = await ask(build(items, []), items.length);
        const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
        const arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
        c.forEach((r, idx) => {
          const e = arr.find((x: any) => x.i === idx + 1) ?? arr[idx];
          out[r.id] = { status: (mod.deriveStatus?.(mod.rotuloFamily(r.categoria), e?.pagina) ?? String(e?.status ?? '').trim().toUpperCase()), sug: e?.categoria_sugerida ?? '', pag: e?.pagina ?? '', raw: String(e?.status ?? ''), why: e?.justificativa_brand_safety ?? '' };
        });
        fs.writeFileSync(outPath, JSON.stringify(out));
        break;
      } catch (err) {
        if (attempt === 2) { console.error('lote falhou', String(err).slice(0, 150)); c.forEach((r) => (out[r.id] = { status: 'ERRO', sug: '', why: '' })); }
        else await new Promise((r) => setTimeout(r, 25000 * (attempt + 1)));
      }
    }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
fs.writeFileSync(outPath, JSON.stringify(out));
console.log('ok', Object.keys(out).length, 'erros', Object.values(out).filter((v) => v.status === 'ERRO').length);
}
main();
