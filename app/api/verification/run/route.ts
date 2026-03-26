import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai';

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

type UrlSampleItem  = { url: string; categoria: string; veiculo: string };
type UrlAnomalyItem = { url: string; categoria: string; veiculo: string; reason: string };

async function checkUrlCategory(item: UrlSampleItem): Promise<UrlAnomalyItem | null> {
  try {
    const { text } = await generateText({
      model: groq('llama-3.1-8b-instant'),
      prompt: `Você é um classificador de brand safety. Dado uma URL e a categoria de conteúdo indevido atribuída a ela pelo adserver, determine se essa classificação é CORRETA ou INCORRETA.

URL: ${item.url}
Categoria atribuída: ${item.categoria}

Responda com exatamente uma das opções:
- "SIM" (a URL realmente contém esse tipo de conteúdo indevido)
- "NÃO: <uma frase explicando por que a classificação parece incorreta>"`,
      maxOutputTokens: 80,
    });

    const trimmed = text.trim();
    if (/^NÃO|^NAO/i.test(trimmed)) {
      const reason = trimmed.replace(/^N[ÃA]O[:\s]*/i, '').trim() || 'Classificação suspeita';
      return { url: item.url, categoria: item.categoria, veiculo: item.veiculo, reason };
    }
    return null;
  } catch {
    return null; // falha silenciosa por timeout ou rate limit
  }
}

const ENGINE_PATH = path.join(process.cwd(), 'app', 'verification', 'engine.py');

function runEngine(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [ENGINE_PATH, ...args], {
      cwd: path.dirname(ENGINE_PATH),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout.on('data', (d: Buffer) => { stdoutChunks.push(d); });
    proc.stderr.on('data', (d: Buffer) => { stderrChunks.push(d); });

    proc.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      if (stderr) console.log('[engine.py stderr]\n' + stderr);
      if (code !== 0) {
        reject(new Error(stderr || `engine.py exited with code ${code}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on('error', reject);
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tmpDir = path.join(os.tmpdir(), `secom-verif-${randomUUID()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    const form = await req.formData();

    // ── Salvar arquivo consolidado ─────────────────────────────────────────
    const consolidadoFile = form.get('consolidado') as File | null;
    if (!consolidadoFile) {
      return NextResponse.json({ error: 'Arquivo consolidado não enviado.' }, { status: 400 });
    }

    const consolidadoPath = path.join(tmpDir, 'consolidado.xlsx');
    await fs.writeFile(consolidadoPath, Buffer.from(await consolidadoFile.arrayBuffer()));

    // ── Adserver ───────────────────────────────────────────────────────────
    const adserver = form.get('adserver') as string | null;
    if (!adserver) {
      return NextResponse.json({ error: 'Adserver não informado.' }, { status: 400 });
    }

    // ── Salvar comprovantes ────────────────────────────────────────────────
    const compFiles = form.getAll('comprovante') as File[];
    if (!compFiles.length) {
      return NextResponse.json({ error: 'Nenhum comprovante enviado.' }, { status: 400 });
    }

    const compPaths: string[] = [];
    for (const file of compFiles) {
      const dest = path.join(tmpDir, file.name);
      await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()));
      compPaths.push(dest);
    }

    // ── Salvar verification files (opcional) ──────────────────────────────
    const verifFiles = form.getAll('verif') as File[];
    const verifPaths: string[] = [];
    for (const file of verifFiles) {
      const dest = path.join(tmpDir, file.name);
      await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()));
      verifPaths.push(dest);
    }

    // ── Parâmetros opcionais de data ───────────────────────────────────────
    const ini = form.get('ini') as string | null;
    const fim = form.get('fim') as string | null;

    const args = [consolidadoPath, '--adserver', adserver];
    if (compPaths.length > 0)  args.push('--comp',  ...compPaths);
    if (verifPaths.length > 0) args.push('--verif', ...verifPaths);
    if (ini) args.push('--ini', ini);
    if (fim) args.push('--fim', fim);

    // ── Executar engine ────────────────────────────────────────────────────
    const stdout = await runEngine(args);

    // engine.py imprime apenas JSON no stdout (resumo vai para stderr)
    const engineResult = JSON.parse(stdout.trim());

    const outputPath: string = engineResult.output;

    // ── AI URL check (5%, máx 50 URLs, 10 por vez para evitar rate limit) ────
    let urlCheckAnomalies: UrlAnomalyItem[] = [];
    const urlSample: UrlSampleItem[] = engineResult.url_sample ?? [];
    if (urlSample.length > 0 && process.env.GROQ_API_KEY) {
      const capped = urlSample.slice(0, 50);
      const BATCH = 10;
      for (let i = 0; i < capped.length; i += BATCH) {
        const settled = await Promise.allSettled(
          capped.slice(i, i + BATCH).map(checkUrlCategory)
        );
        urlCheckAnomalies.push(
          ...settled
            .filter((r): r is PromiseFulfilledResult<UrlAnomalyItem> =>
              r.status === 'fulfilled' && r.value !== null
            )
            .map((r) => r.value)
        );
      }
    }

    // ── Escrever URL info (col 30) no arquivo verificado ─────────────────────
    if (urlCheckAnomalies.length > 0) {
      // Mapear nome do veículo no parser → nome no consolidado
      const matchToConsol = new Map<string, string>();
      for (const v of (engineResult.veiculos ?? []) as { veiculo: string; match: string | null }[]) {
        if (v.match) matchToConsol.set(v.match, v.veiculo);
      }
      // Agregar anomalias por veículo (nome do consolidado)
      const urlInfoByVeiculo: Record<string, string[]> = {};
      for (const a of urlCheckAnomalies) {
        const consolName = matchToConsol.get(a.veiculo) ?? a.veiculo;
        if (!urlInfoByVeiculo[consolName]) urlInfoByVeiculo[consolName] = [];
        urlInfoByVeiculo[consolName].push(`${a.url} → ${a.reason}`);
      }
      const WRITE_URL_INFO = path.join(path.dirname(ENGINE_PATH), 'parsers', 'write_url_info.py');
      try {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn('python3', [WRITE_URL_INFO, outputPath, JSON.stringify(
            Object.fromEntries(Object.entries(urlInfoByVeiculo).map(([k, v]) => [k, v.join('\n')]))
          )], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
          proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`write_url_info exited ${code}`)));
          proc.on('error', reject);
        });
      } catch {
        // falha não-crítica: arquivo segue sem col 30
      }
    }

    // ── Ler arquivo verificado (após write_url_info) e embutir como base64 ───
    let fileBase64: string | null = null;
    try {
      fileBase64 = (await fs.readFile(outputPath)).toString('base64');
    } catch {
      // arquivo pode não ter sido gerado se houve erro
    }

    return NextResponse.json({
      veiculos:            engineResult.veiculos,
      sem_comprovante:     engineResult.sem_comprovante,
      sem_consolidado:     engineResult.sem_consolidado,
      parse_errors:        engineResult.parse_errors,
      file_base64:         fileBase64,
      file_name:           path.basename(outputPath),
      url_check_anomalies: urlCheckAnomalies,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    // Limpeza dos arquivos temporários
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
