// Mede o prompt do url-check contra os vereditos da equipe (191 URLs). Uso:
//   URL_CHECK_OLLAMA_URL= npx tsx --env-file=.env.local scripts/eval-url-prompt.ts <modulo.ts> <full|compact> <saida.json>
// Chama o Google direto (temperature 0), lotes de 10, concorrência 4. Não toca em banco.
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import fs from 'node:fs';
import path from 'node:path';

const R = 'verification/verifications_url/_rotulos';
const [modPath, kind, outPath] = process.argv.slice(2);
const rows = (JSON.parse(fs.readFileSync(`${R}/humano_equipe.json`, 'utf8')) as any[]).filter((r) => r.h === 'CORRETA' || r.h === 'INCORRETA');
const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
const MODEL = process.env.URL_CHECK_MODEL ?? 'gemini-3.5-flash-lite';

async function main() {
const mod = await import(path.resolve(modPath));
const build = kind === 'compact' ? mod.buildCompactPrompt : mod.buildFullPrompt;
const chunks: any[][] = [];
for (let i = 0; i < rows.length; i += 10) chunks.push(rows.slice(i, i + 10));
const prev: Record<string, { status: string; sug: string; why: string }> = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
const out: Record<string, { status: string; sug: string; why: string }> = Object.fromEntries(Object.entries(prev).filter(([, v]) => v.status !== 'ERRO'));
let next = 0;
async function worker() {
  while (next < chunks.length) {
    const c = chunks[next++].filter((r) => !out[r.id]);
    if (!c.length) continue;
    const items = c.map((r) => ({ url: r.url, categoria: r.categoria, veiculo: '', impressoes: 0 }));
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { text } = await generateText({ model: google(MODEL), prompt: build(items, []), maxOutputTokens: 220 * items.length, temperature: 0, maxRetries: 0, abortSignal: AbortSignal.timeout(90_000) });
        const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
        const arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
        c.forEach((r, idx) => {
          const e = arr.find((x: any) => x.i === idx + 1) ?? arr[idx];
          out[r.id] = { status: String(e?.status ?? '').trim().toUpperCase(), sug: e?.categoria_sugerida ?? '', why: e?.justificativa_brand_safety ?? '' };
        });
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
