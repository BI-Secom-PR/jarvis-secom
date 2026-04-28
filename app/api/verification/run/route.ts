import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Ollama } from 'ollama';

const ollamaClient = new Ollama({
  host: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  headers: process.env.OLLAMA_API_KEY
    ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` }
    : undefined,
});

type UrlSampleItem  = { url: string; categoria: string; veiculo: string; impressoes: number };
type UrlAnomalyItem = { url: string; categoria: string; veiculo: string; reason: string; impressoes: number; pct: number };

async function checkUrlCategory(item: UrlSampleItem): Promise<UrlAnomalyItem | null> {
  try {
    const response = await ollamaClient.chat({
      model: 'gemma4:31b-cloud',
      options: { num_predict: 80 },
      messages: [{ role: 'user', content: `Você é um classificador de brand safety. Dado uma URL e a categoria de conteúdo indevido atribuída a ela pelo adserver, determine se essa classificação é CORRETA ou INCORRETA.

URL: ${item.url}
Categoria atribuída: ${item.categoria}

Responda com exatamente uma das opções:
- "SIM" (a URL realmente contém esse tipo de conteúdo indevido)
- "NÃO: <uma frase explicando por que a classificação parece incorreta>"` }],
    });

    const trimmed = response.message.content.trim();
    if (/^NÃO|^NAO/i.test(trimmed)) {
      const reason = trimmed.replace(/^N[ÃA]O[:\s]*/i, '').trim() || 'Classificação suspeita';
      return { url: item.url, categoria: item.categoria, veiculo: item.veiculo, reason, impressoes: item.impressoes, pct: 0 };
    }
    return null;
  } catch {
    return null;
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

  const form = await req.formData();

  // ── Validar campos obrigatórios ────────────────────────────────────────────
  const consolidadoFile = form.get('consolidado') as File | null;
  if (!consolidadoFile) {
    return NextResponse.json({ error: 'Arquivo consolidado não enviado.' }, { status: 400 });
  }

  const adserver = form.get('adserver') as string | null;
  if (!adserver) {
    return NextResponse.json({ error: 'Adserver não informado.' }, { status: 400 });
  }

  const compFiles = form.getAll('comprovante') as File[];
  if (!compFiles.length) {
    return NextResponse.json({ error: 'Nenhum comprovante enviado.' }, { status: 400 });
  }

  const verifFiles = form.getAll('verif') as File[];
  const ini = form.get('ini') as string | null;
  const fim = form.get('fim') as string | null;

  // ── Executar engine ────────────────────────────────────────────────────────
  let engineResult: Record<string, unknown>;

  if (process.env.VERCEL_URL) {
    // On Vercel: call the Python serverless function via internal fetch
    // VERCEL_URL is set to the deployment hostname only on actual Vercel infra (not in local .env.local pulls)
    const pyUrl = `https://${process.env.VERCEL_URL}/api/py/verification`;

    const toB64 = async (f: File) =>
      Buffer.from(await f.arrayBuffer()).toString('base64');

    const pyBody = {
      consolidado_b64:  await toB64(consolidadoFile),
      consolidado_name: consolidadoFile.name,
      comp_files: await Promise.all(compFiles.map(async (f) => ({ name: f.name, b64: await toB64(f) }))),
      verif_files: await Promise.all(verifFiles.map(async (f) => ({ name: f.name, b64: await toB64(f) }))),
      adserver,
      ...(ini ? { ini } : {}),
      ...(fim ? { fim } : {}),
    };

    const pyResp = await fetch(pyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pyBody),
    });

    if (!pyResp.ok) {
      let errText = await pyResp.text();
      try {
        const errJson = JSON.parse(errText) as { error?: string; trace?: string };
        const trace = errJson.trace ? `\n${errJson.trace}` : '';
        errText = `${errJson.error ?? errText}${trace}`;
      } catch {
        // Keep raw body if response is not valid JSON.
      }
      return NextResponse.json({ error: `Python engine error: ${errText}` }, { status: 500 });
    }

    engineResult = await pyResp.json() as Record<string, unknown>;
  } else {
    // On-prem: spawn python3 as before
    const tmpDir = path.join(os.tmpdir(), `secom-verif-${randomUUID()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    try {
      const consolidadoPath = path.join(tmpDir, 'consolidado.xlsx');
      await fs.writeFile(consolidadoPath, Buffer.from(await consolidadoFile.arrayBuffer()));

      const compPaths: string[] = [];
      for (const file of compFiles) {
        const dest = path.join(tmpDir, file.name);
        await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()));
        compPaths.push(dest);
      }

      const verifPaths: string[] = [];
      for (const file of verifFiles) {
        const dest = path.join(tmpDir, file.name);
        await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()));
        verifPaths.push(dest);
      }

      const args = [consolidadoPath, '--adserver', adserver];
      if (compPaths.length > 0)  args.push('--comp',  ...compPaths);
      if (verifPaths.length > 0) args.push('--verif', ...verifPaths);
      if (ini) args.push('--ini', ini);
      if (fim) args.push('--fim', fim);

      const stdout = await runEngine(args);
      engineResult = JSON.parse(stdout.trim()) as Record<string, unknown>;

      // Read generated file before tmpDir cleanup so UI can show download button.
      const generatedOutputPath = (engineResult.output as string) ?? '';
      if (generatedOutputPath) {
        try {
          engineResult.output_b64 = (await fs.readFile(generatedOutputPath)).toString('base64');
        } catch {
          // Non-critical: fallback attempts below may still provide file_base64.
        }
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // On Vercel the engine returns output_b64 directly; on-prem we read the file.
  let fileBase64: string | null = (engineResult.output_b64 as string | null) ?? null;
  const outputPath: string = (engineResult.output as string) ?? '';
  const outputName: string = engineResult.output_name
    ? (engineResult.output_name as string)
    : outputPath ? path.basename(outputPath) : 'verificado.xlsx';

  // ── AI URL check (10%, máx 50 URLs, 10 por vez para evitar rate limit) ─────
  let urlCheckAnomalies: UrlAnomalyItem[] = [];
  const urlSample: UrlSampleItem[] = (engineResult.url_sample as UrlSampleItem[]) ?? [];
  if (urlSample.length > 0 && process.env.OLLAMA_BASE_URL) {
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

  // ── Calcular pct de impressões por veículo ────────────────────────────────────
  if (urlCheckAnomalies.length > 0) {
    // Build map keyed by both match name (parser) and consolidado name for broader coverage
    const entregueByMatch = new Map<string, number>();
    for (const v of (engineResult.veiculos ?? []) as { veiculo: string; match: string | null; entregue_consol: number }[]) {
      if (v.entregue_consol) {
        if (v.match) entregueByMatch.set(v.match, v.entregue_consol);
        entregueByMatch.set(v.veiculo, v.entregue_consol);
      }
    }
    urlCheckAnomalies = urlCheckAnomalies.map((a) => {
      const total = entregueByMatch.get(a.veiculo) ?? 0;
      return { ...a, pct: total > 0 ? Math.round((a.impressoes / total) * 10000) / 100 : 0 };
    });
  }

  // ── Escrever URL info (col 30) no arquivo verificado ────────────────────────
  if (urlCheckAnomalies.length > 0) {
    const matchToConsol = new Map<string, string>();
    for (const v of (engineResult.veiculos ?? []) as { veiculo: string; match: string | null }[]) {
      if (v.match) matchToConsol.set(v.match, v.veiculo);
    }
    const urlInfoByVeiculo: Record<string, string[]> = {};
    for (const a of urlCheckAnomalies) {
      const consolName = matchToConsol.get(a.veiculo) ?? a.veiculo;
      if (!urlInfoByVeiculo[consolName]) urlInfoByVeiculo[consolName] = [];
      urlInfoByVeiculo[consolName].push(`${a.url} [${a.impressoes} imp, ${a.pct}%] → ${a.reason}`);
    }
    const urlInfoFlat = Object.fromEntries(
      Object.entries(urlInfoByVeiculo).map(([k, v]) => [k, v.join('\n')])
    );

    try {
      if (process.env.VERCEL_URL) {
        // On Vercel: call the Python function again for url_info write
        const pyUrl = `https://${process.env.VERCEL_URL}/api/py/verification`;
        const pyResp = await fetch(pyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            output_b64:          fileBase64,
            output_name:         outputName,
            url_info_by_veiculo: urlInfoFlat,
          }),
        });
        if (pyResp.ok) {
          const upd = await pyResp.json() as { output_b64?: string };
          if (upd.output_b64) fileBase64 = upd.output_b64;
        }
      } else {
        // On-prem: spawn write_url_info.py
        const WRITE_URL_INFO = path.join(path.dirname(ENGINE_PATH), 'parsers', 'write_url_info.py');
        await new Promise<void>((resolve, reject) => {
          const proc = spawn('python3', [WRITE_URL_INFO, outputPath, JSON.stringify(urlInfoFlat)], {
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
          });
          proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`write_url_info exited ${code}`)));
          proc.on('error', reject);
        });
        // Re-read updated file
        try {
          fileBase64 = (await fs.readFile(outputPath)).toString('base64');
        } catch { /* non-critical */ }
      }
    } catch { /* falha não-crítica: arquivo segue sem col 30 */ }
  } else if (!fileBase64 && outputPath) {
    // On-prem without url_info: read the output file
    try {
      fileBase64 = (await fs.readFile(outputPath)).toString('base64');
    } catch { /* non-critical */ }
  }

  return NextResponse.json({
    veiculos:            engineResult.veiculos,
    sem_comprovante:     engineResult.sem_comprovante,
    sem_consolidado:     engineResult.sem_consolidado,
    parse_errors:        engineResult.parse_errors,
    file_base64:         fileBase64,
    file_name:           outputName,
    url_check_anomalies: urlCheckAnomalies,
  });
}
