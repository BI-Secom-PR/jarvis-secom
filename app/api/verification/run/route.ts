import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { del } from '@vercel/blob';
import { Ollama } from 'ollama';

const ollamaClient = new Ollama({
  host: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  headers: process.env.OLLAMA_API_KEY
    ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` }
    : undefined,
});

type UrlSampleItem  = { url: string; categoria: string; veiculo: string; impressoes: number };
type UrlAnomalyItem = { url: string; categoria: string; veiculo: string; reason: string; impressoes: number; pct: number };
type Send = (ev: object) => void;
type VerificationResult = {
  veiculos: unknown;
  sem_comprovante: unknown;
  sem_consolidado: unknown;
  parse_errors: unknown;
  file_base64: string | null;
  file_name: string;
  url_check_anomalies: UrlAnomalyItem[];
};

async function checkUrlCategory(item: UrlSampleItem): Promise<UrlAnomalyItem | null> {
  try {
    const response = await ollamaClient.chat({
      model: 'gemma4:31b-cloud',
      options: { num_predict: 80 },
      messages: [{ role: 'user', content: `Você é um classificador de brand safety para o SECOM (Secretaria de Comunicação Social do Governo Federal do Brasil). Dado uma URL e a categoria de conteúdo indevido atribuída a ela pelo adserver, determine se essa classificação é CORRETA ou INCORRETA.

As categorias de conteúdo consideradas indevidas pelo SECOM são:
- Língua estrangeira: conteúdo entregue fora do português brasileiro (já foi objeto de questionamento pelo TCU e CGU)
- Conteúdo adulto: sexo, sexualidade, pornografia e afins
- Violência: acidentes, armas, morte, guerra, conflitos militares
- Crimes: crimes, violação de direitos, atividade policial
- Pirataria: distribuição ilegal de conteúdo protegido
- Terrorismo: grupos terroristas, ataques, extremismo
- Discurso de ódio: conteúdo discriminatório por raça, gênero, religião, orientação sexual etc.
- Conteúdo gerado pelo usuário sem moderação: bate-papo, fóruns abertos — risco de conteúdo adulto e crimes, especialmente pedofilia
- Drogas: uso, venda ou apologia a substâncias ilícitas

Categorias que NÃO são conteúdo indevido:
- "safeframe": limitação técnica de rastreamento. O Safeframe pode restringir o acesso à URL da página por privacidade, afetando entregas em apps, programática ou iframes. Trate sempre como CORRETA.
- "aplicativo móvel" e "teste de tag": limitações técnicas, não conteúdo impróprio. Trate sempre como CORRETA.

URL: ${item.url}
Categoria atribuída: ${item.categoria}

Responda com exatamente uma das opções:
- "SIM" (a URL realmente contém esse tipo de conteúdo indevido, ou a categoria é uma limitação técnica)
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

function sseResponse(work: (send: Send) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send: Send = (ev) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      try {
        await work(send);
      } catch (e) {
        try {
          send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
        } catch { /* controller may already be closed */ }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isJson = req.headers.get('content-type')?.includes('application/json');

  // ── Branch: Vercel Blob URLs (JSON) ───────────────────────────────────────
  if (isJson) {
    type BlobBody = {
      adserver: string;
      consolidado_url: string;
      consolidado_name: string;
      comp_urls: string[];
      verif_urls?: string[];
      ini?: string;
      fim?: string;
      url_sample_pct?: number;
      view_rules?: string;
    };
    const body = (await req.json()) as BlobBody;

    const { adserver, consolidado_url, consolidado_name, comp_urls, verif_urls = [] } = body;
    if (!adserver)          return NextResponse.json({ error: 'Adserver não informado.' }, { status: 400 });
    if (!consolidado_url)   return NextResponse.json({ error: 'Arquivo consolidado não enviado.' }, { status: 400 });
    if (!comp_urls?.length) return NextResponse.json({ error: 'Nenhum comprovante enviado.' }, { status: 400 });

    const allBlobUrls = [consolidado_url, ...comp_urls, ...verif_urls];
    const pyUrl = `https://${process.env.VERCEL_URL}/api/py/verification`;
    const pyBody: Record<string, unknown> = {
      consolidado_url,
      consolidado_name,
      comp_urls,
      verif_urls,
      adserver,
      url_sample_pct: body.url_sample_pct ?? 10,
      ...(body.ini ? { ini: body.ini } : {}),
      ...(body.fim ? { fim: body.fim } : {}),
      ...(body.view_rules ? { view_rules: body.view_rules } : {}),
      ...(process.env.BLOB_READ_WRITE_TOKEN ? { blob_token: process.env.BLOB_READ_WRITE_TOKEN } : {}),
    };

    return sseResponse(async (send) => {
      let engineResult: Record<string, unknown> = {};
      try {
        send({ type: 'engine_start' });
        let pyResp: Response;
        try {
          pyResp = await fetch(pyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pyBody),
          });
        } catch (fetchErr) {
          throw new Error(`Failed to reach Python engine: ${fetchErr}`);
        }
        const pyRespText = await pyResp.text();
        if (!pyResp.ok) {
          let errText = pyRespText;
          try {
            const errJson = JSON.parse(pyRespText) as { error?: string; trace?: string; openpyxl_version?: string; python_version?: string };
            const meta = [errJson.openpyxl_version && `openpyxl=${errJson.openpyxl_version}`, errJson.python_version && `py=${errJson.python_version.split(' ')[0]}`].filter(Boolean).join(' ');
            const trace = errJson.trace ? `\n${errJson.trace}` : '';
            errText = `${errJson.error ?? pyRespText}${meta ? ` [${meta}]` : ''}${trace}`;
          } catch { /* keep raw body */ }
          throw new Error(`Python engine error (HTTP ${pyResp.status}): ${errText}`);
        }
        try {
          engineResult = JSON.parse(pyRespText) as Record<string, unknown>;
        } catch {
          throw new Error(`Python engine returned non-JSON (HTTP ${pyResp.status}): ${pyRespText.slice(0, 500)}`);
        }
      } finally {
        await del(allBlobUrls).catch(() => {});
      }
      send({ type: 'engine_done' });
      const result = await buildEngineResponse(engineResult, send);
      send({ type: 'done', result });
    });
  }

  // ── On-prem: multipart FormData ────────────────────────────────────────────
  const form = await req.formData();

  const consolidadoFile = form.get('consolidado') as File | null;
  if (!consolidadoFile) return NextResponse.json({ error: 'Arquivo consolidado não enviado.' }, { status: 400 });

  const adserver = form.get('adserver') as string | null;
  if (!adserver) return NextResponse.json({ error: 'Adserver não informado.' }, { status: 400 });

  const compFiles = form.getAll('comprovante') as File[];
  if (!compFiles.length) return NextResponse.json({ error: 'Nenhum comprovante enviado.' }, { status: 400 });

  const verifFiles = form.getAll('verif') as File[];
  const ini = form.get('ini') as string | null;
  const fim = form.get('fim') as string | null;
  const urlSamplePct = Number(form.get('url_sample_pct') ?? 10);
  const viewRulesRaw = form.get('view_rules') as string | null;

  return sseResponse(async (send) => {
    let engineResult: Record<string, unknown>;
    send({ type: 'engine_start' });

    if (process.env.VERCEL_URL) {
      // On Vercel via FormData (fallback — shouldn't happen when blob upload is active)
      const pyUrl = `https://${process.env.VERCEL_URL}/api/py/verification`;
      const toB64 = async (f: File) => Buffer.from(await f.arrayBuffer()).toString('base64');
      const pyBody = {
        consolidado_b64:  await toB64(consolidadoFile),
        consolidado_name: consolidadoFile.name,
        comp_files: await Promise.all(compFiles.map(async (f) => ({ name: f.name, b64: await toB64(f) }))),
        verif_files: await Promise.all(verifFiles.map(async (f) => ({ name: f.name, b64: await toB64(f) }))),
        adserver,
        url_sample_pct: urlSamplePct,
        ...(ini ? { ini } : {}),
        ...(fim ? { fim } : {}),
        ...(viewRulesRaw ? { view_rules: viewRulesRaw } : {}),
        ...(process.env.BLOB_READ_WRITE_TOKEN ? { blob_token: process.env.BLOB_READ_WRITE_TOKEN } : {}),
      };
      let pyResp: Response;
      try {
        pyResp = await fetch(pyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pyBody),
        });
      } catch (fetchErr) {
        throw new Error(`Failed to reach Python engine: ${fetchErr}`);
      }
      const pyRespText = await pyResp.text();
      if (!pyResp.ok) {
        let errText = pyRespText;
        try {
          const errJson = JSON.parse(pyRespText) as { error?: string; trace?: string; openpyxl_version?: string; python_version?: string };
          const meta = [errJson.openpyxl_version && `openpyxl=${errJson.openpyxl_version}`, errJson.python_version && `py=${errJson.python_version.split(' ')[0]}`].filter(Boolean).join(' ');
          const trace = errJson.trace ? `\n${errJson.trace}` : '';
          errText = `${errJson.error ?? pyRespText}${meta ? ` [${meta}]` : ''}${trace}`;
        } catch { /* keep raw body if response is not valid JSON (e.g. Vercel HTML error page) */ }
        throw new Error(`Python engine error (HTTP ${pyResp.status}): ${errText}`);
      }
      try {
        engineResult = JSON.parse(pyRespText) as Record<string, unknown>;
      } catch {
        throw new Error(`Python engine returned non-JSON response (HTTP ${pyResp.status}): ${pyRespText.slice(0, 500)}`);
      }
    } else {
      // On-prem: spawn python3
      const tmpDir = path.join(os.tmpdir(), `secom-verif-${randomUUID()}`);
      await fs.mkdir(tmpDir, { recursive: true });
      try {
        const consolidadoPath = path.join(tmpDir, consolidadoFile.name);
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
        args.push('--url-pct', String(urlSamplePct));
        if (viewRulesRaw) args.push('--view-rules', viewRulesRaw);

        const stdout = await runEngine(args);
        engineResult = JSON.parse(stdout.trim()) as Record<string, unknown>;

        // Read generated file before tmpDir cleanup so UI can show download button.
        const generatedOutputPath = (engineResult.output as string) ?? '';
        if (generatedOutputPath) {
          try {
            engineResult.output_b64 = (await fs.readFile(generatedOutputPath)).toString('base64');
          } catch { /* non-critical */ }
        }
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }

    send({ type: 'engine_done' });
    const result = await buildEngineResponse(engineResult, send);
    send({ type: 'done', result });
  });
}

async function buildEngineResponse(
  engineResult: Record<string, unknown>,
  send: Send,
): Promise<VerificationResult> {
  let fileBase64: string | null = (engineResult.output_b64 as string | null) ?? null;
  const outputPath: string = (engineResult.output as string) ?? '';
  const outputName: string = engineResult.output_name
    ? (engineResult.output_name as string)
    : outputPath ? path.basename(outputPath) : 'verificado.xlsx';

  // ── AI URL check ──────────────────────────────────────────────────────────
  let urlCheckAnomalies: UrlAnomalyItem[] = [];
  const urlSample: UrlSampleItem[] = (engineResult.url_sample as UrlSampleItem[]) ?? [];
  if (urlSample.length > 0 && process.env.OLLAMA_BASE_URL) {
    const BATCH = 10;
    send({ type: 'url_check_start', total: urlSample.length });
    let done = 0;
    for (let i = 0; i < urlSample.length; i += BATCH) {
      const batch = urlSample.slice(i, i + BATCH);
      const settled = await Promise.allSettled(batch.map(checkUrlCategory));
      done += batch.length;
      send({ type: 'url_check_progress', done, total: urlSample.length });
      urlCheckAnomalies.push(
        ...settled
          .filter((r): r is PromiseFulfilledResult<UrlAnomalyItem> =>
            r.status === 'fulfilled' && r.value !== null
          )
          .map((r) => r.value as UrlAnomalyItem)
      );
    }
  }

  // ── Calcular pct de impressões por veículo ────────────────────────────────
  if (urlCheckAnomalies.length > 0) {
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

  // ── Escrever URL info (col 30) no arquivo verificado ─────────────────────
  if (urlCheckAnomalies.length > 0) {
    send({ type: 'writing' });
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
        const WRITE_URL_INFO = path.join(path.dirname(ENGINE_PATH), 'parsers', 'write_url_info.py');
        await new Promise<void>((resolve, reject) => {
          const proc = spawn('python3', [WRITE_URL_INFO, outputPath, JSON.stringify(urlInfoFlat)], {
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
          });
          proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`write_url_info exited ${code}`)));
          proc.on('error', reject);
        });
        try {
          fileBase64 = (await fs.readFile(outputPath)).toString('base64');
        } catch { /* non-critical */ }
      }
    } catch { /* falha não-crítica: arquivo segue sem col 30 */ }
  } else if (!fileBase64 && outputPath) {
    try {
      fileBase64 = (await fs.readFile(outputPath)).toString('base64');
    } catch { /* non-critical */ }
  }

  return {
    veiculos:            engineResult.veiculos,
    sem_comprovante:     engineResult.sem_comprovante,
    sem_consolidado:     engineResult.sem_consolidado,
    parse_errors:        engineResult.parse_errors,
    file_base64:         fileBase64,
    file_name:           outputName,
    url_check_anomalies: urlCheckAnomalies,
  };
}
