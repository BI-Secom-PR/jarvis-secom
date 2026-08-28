import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createSignedDownloadUrl, removeFiles } from '@/lib/storage';
import type { UrlSampleItem, UrlAnomalyItem, UrlCheckedRow } from '@/lib/urlCheck';

export const maxDuration = 300;

const VALID_ADSERVERS = new Set(['00px', '00px25', 'adforce', 'admotion', 'ahead', 'metrike', 'sense', 'dgbrasil', 'teratech']);
const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;

function validateAdserver(adserver: string): string | null {
  return VALID_ADSERVERS.has(adserver) ? null : `Adserver inválido: ${adserver}`;
}
function validateDate(label: string, val: string): string | null {
  return DATE_RE.test(val) ? null : `${label} deve estar no formato DD/MM/YYYY`;
}

type Send = (ev: object) => void;
type VerificationResult = {
  veiculos: unknown;
  sem_comprovante: unknown;
  sem_consolidado: unknown;
  sem_consolidado_verif: unknown;
  sem_consolidado_comp: unknown;
  parse_errors: unknown;
  file_base64: string | null;
  file_name: string;
  url_sample: UrlSampleItem[];
  url_categorias: string[];
  url_check_anomalies: UrlAnomalyItem[];
  url_check_rows: UrlCheckedRow[];
  url_check_failed: number;
};

const ENGINE_PATH = path.join(process.cwd(), 'app', 'verification', 'engine.py');

// proxy.ts gates /api/py/: it validates x-internal-key only when its own env
// has INTERNAL_API_KEY, else it falls back to the session-cookie check. The
// middleware runs on the edge (env inlined at build) while this route reads env
// at runtime, so the two can disagree — send both credentials, never one.
function pyHeaders(cookie: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(process.env.INTERNAL_API_KEY ? { 'x-internal-key': process.env.INTERNAL_API_KEY } : {}),
    cookie,
  };
}

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

  // ── Branch: Supabase Storage paths (JSON) ─────────────────────────────────
  if (isJson) {
    // One file arrives as an ordered list of object paths: the browser slices
    // past Supabase's 50MB/object free-tier cap and Python concatenates them.
    type StoredFile = { paths: string[]; name: string };
    type StorageBody = {
      adserver: string;
      consolidado: StoredFile;
      comp_files: StoredFile[];
      verif_files?: StoredFile[];
      ini?: string;
      fim?: string;
      url_share_pct?: number;
      view_rules?: string;
      praca?: string;
    };
    const body = (await req.json()) as StorageBody;

    const { adserver, consolidado, comp_files, verif_files = [] } = body;
    const allPaths = [consolidado, ...(comp_files ?? []), ...verif_files].flatMap((f) => f?.paths ?? []);
    // Files are already uploaded by the client at this point — delete them on
    // validation failure too, or they leak into the bucket.
    const reject = async (msg: string) => {
      await removeFiles(allPaths);
      return NextResponse.json({ error: msg }, { status: 400 });
    };
    if (!adserver)           return reject('Adserver não informado.');
    if (!consolidado?.paths?.length) return reject('Arquivo consolidado não enviado.');
    if (!comp_files?.length) return reject('Nenhum comprovante enviado.');
    const adserverErr = validateAdserver(adserver);
    if (adserverErr) return reject(adserverErr);
    if (body.ini) { const e = validateDate('ini', body.ini); if (e) return reject(e); }
    if (body.fim) { const e = validateDate('fim', body.fim); if (e) return reject(e); }
    const pyUrl = `https://${process.env.VERCEL_URL}/api/py/verification`;
    const headers = pyHeaders(req.headers.get('cookie') ?? '');
    // Resolve signed download URLs here so the Python side stays storage-agnostic:
    // these need no auth header, so `_download_urls(urls, dest)` works unchanged.
    const signed = async (f: StoredFile) => ({ urls: await Promise.all(f.paths.map((p) => createSignedDownloadUrl(p))), name: f.name });
    const pyBody: Record<string, unknown> = {
      consolidado_urls: await Promise.all(consolidado.paths.map((p) => createSignedDownloadUrl(p))),
      consolidado_name: consolidado.name,
      comp_files: await Promise.all(comp_files.map(signed)),
      verif_files: await Promise.all(verif_files.map(signed)),
      adserver,
      url_share_pct: body.url_share_pct ?? 2,
      ...(body.ini ? { ini: body.ini } : {}),
      ...(body.fim ? { fim: body.fim } : {}),
      ...(body.view_rules ? { view_rules: body.view_rules } : {}),
      ...(body.praca ? { praca: body.praca } : {}),
    };

    return sseResponse(async (send) => {
      let engineResult: Record<string, unknown> = {};
      try {
        send({ type: 'engine_start' });
        let pyResp: Response;
        try {
          pyResp = await fetch(pyUrl, {
            method: 'POST',
            headers,
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
        await removeFiles(allPaths);
      }
      send({ type: 'engine_done' });
      const result = await buildEngineResponse(engineResult);
      send({ type: 'done', result });
    });
  }

  // ── On-prem: multipart FormData ────────────────────────────────────────────
  const form = await req.formData();

  const consolidadoFile = form.get('consolidado') as File | null;
  if (!consolidadoFile) return NextResponse.json({ error: 'Arquivo consolidado não enviado.' }, { status: 400 });

  const adserver = form.get('adserver') as string | null;
  if (!adserver) return NextResponse.json({ error: 'Adserver não informado.' }, { status: 400 });
  const adserverErrFd = validateAdserver(adserver);
  if (adserverErrFd) return NextResponse.json({ error: adserverErrFd }, { status: 400 });

  const compFiles = form.getAll('comprovante') as File[];
  if (!compFiles.length) return NextResponse.json({ error: 'Nenhum comprovante enviado.' }, { status: 400 });

  const verifFiles = form.getAll('verif') as File[];
  const ini = form.get('ini') as string | null;
  const fim = form.get('fim') as string | null;
  if (ini) { const e = validateDate('ini', ini); if (e) return NextResponse.json({ error: e }, { status: 400 }); }
  if (fim) { const e = validateDate('fim', fim); if (e) return NextResponse.json({ error: e }, { status: 400 }); }
  const urlSharePct = Number(form.get('url_share_pct') ?? 2);
  const viewRulesRaw = form.get('view_rules') as string | null;
  const pracaRaw = form.get('praca') as string | null;

  return sseResponse(async (send) => {
    let engineResult: Record<string, unknown>;
    send({ type: 'engine_start' });

    if (process.env.VERCEL_URL) {
      // On Vercel via FormData (fallback — shouldn't happen when direct upload is active)
      const pyUrl = `https://${process.env.VERCEL_URL}/api/py/verification`;
      const toB64 = async (f: File) => Buffer.from(await f.arrayBuffer()).toString('base64');
      const pyBody = {
        consolidado_b64:  await toB64(consolidadoFile),
        consolidado_name: consolidadoFile.name,
        comp_files: await Promise.all(compFiles.map(async (f) => ({ name: f.name, b64: await toB64(f) }))),
        verif_files: await Promise.all(verifFiles.map(async (f) => ({ name: f.name, b64: await toB64(f) }))),
        adserver,
        url_share_pct: urlSharePct,
        ...(ini ? { ini } : {}),
        ...(fim ? { fim } : {}),
        ...(viewRulesRaw ? { view_rules: viewRulesRaw } : {}),
        ...(pracaRaw ? { praca: pracaRaw } : {}),
        };
      const headers = pyHeaders(req.headers.get('cookie') ?? '');
      let pyResp: Response;
      try {
        pyResp = await fetch(pyUrl, {
          method: 'POST',
          headers,
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
        args.push('--url-share-pct', String(urlSharePct));
        if (viewRulesRaw) args.push('--view-rules', viewRulesRaw);
        if (pracaRaw) args.push('--praca', pracaRaw);

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
    const result = await buildEngineResponse(engineResult);
    send({ type: 'done', result });
  });
}

async function buildEngineResponse(
  engineResult: Record<string, unknown>,
): Promise<VerificationResult> {
  let fileBase64: string | null = (engineResult.output_b64 as string | null) ?? null;
  const outputPath: string = (engineResult.output as string) ?? '';
  const outputName: string = engineResult.output_name
    ? (engineResult.output_name as string)
    : outputPath ? path.basename(outputPath) : 'verificado.xlsx';

  // A checagem de URL saiu daqui: a amostra da regra de share (3.514 URLs nos
  // 29 verifs SENSE) não cabe nos 300s desta função. O cliente recebe a amostra
  // e a consome em lotes via /api/verification/url-check, depois fecha em
  // /api/verification/url-write. Ver lib/urlCheck.ts.
  if (!fileBase64 && outputPath) {
    try {
      fileBase64 = (await fs.readFile(outputPath)).toString('base64');
    } catch { /* non-critical */ }
  }

  return {
    veiculos:            engineResult.veiculos,
    sem_comprovante:     engineResult.sem_comprovante,
    sem_consolidado:      engineResult.sem_consolidado,
    sem_consolidado_verif: engineResult.sem_consolidado_verif,
    sem_consolidado_comp:  engineResult.sem_consolidado_comp,
    parse_errors:        engineResult.parse_errors,
    file_base64:         fileBase64,
    file_name:           outputName,
    url_sample:          (engineResult.url_sample as UrlSampleItem[]) ?? [],
    url_categorias:      (engineResult.url_categorias as string[]) ?? [],
    url_check_anomalies: [],
    url_check_rows:      [],
    url_check_failed:    0,
  };
}
