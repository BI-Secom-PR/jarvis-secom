import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { del } from '@vercel/blob';
import { Ollama } from 'ollama';

export const maxDuration = 300;

const VALID_ADSERVERS = new Set(['00px', 'adforce', 'admotion', 'ahead', 'metrike', 'brz', 'sense']);
const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;

function validateAdserver(adserver: string): string | null {
  return VALID_ADSERVERS.has(adserver) ? null : `Adserver inválido: ${adserver}`;
}
function validateDate(label: string, val: string): string | null {
  return DATE_RE.test(val) ? null : `${label} deve estar no formato DD/MM/YYYY`;
}

const ollamaClient = new Ollama({
  host: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  headers: process.env.OLLAMA_API_KEY
    ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` }
    : undefined,
});

type UrlSampleItem  = { url: string; categoria: string; veiculo: string; impressoes: number };
type UrlAnomalyItem = { url: string; categoria: string; categoria_sugerida: string | null; veiculo: string; reason: string; impressoes: number; pct: number };
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
  url_check_anomalies: UrlAnomalyItem[];
};

async function checkUrlCategory(item: UrlSampleItem, categoriasDisponiveis: string[]): Promise<UrlAnomalyItem | null> {
  try {
    const response = await ollamaClient.chat({
      model: 'gemma4:31b-cloud',
      options: { num_predict: 350 },
      messages: [{ role: 'user', content: `Você é um classificador especialista em Brand Safety e auditoria de mídia programática para a SECOM (Secretaria de Comunicação Social do Governo Federal do Brasil). 

Sua missão é auditar a classificação de conteúdo feita por um adserver. Dado uma URL, o título/conteúdo da página e a categoria atribuída pelo adserver, avalie se a classificação está CORRETA ou INCORRETA.

### DIRETRIZES DE AVALIAÇÃO (Regras de Negócio)

1. TRATAMENTO DE CATEGORIAS TÉCNICAS (Safeframe, Aplicativo Móvel, Teste de Tag):
   - O adserver frequentemente classifica URLs reais incorretamente como "safeframe", "aplicativo móvel" ou "teste de tag" devido a falhas de rastreamento.
   - Você DEVE analisar o conteúdo real da URL. Se a URL apontar para uma notícia, blog ou portal de conteúdo, e o adserver a classificou como "safeframe" (ou similar), isso é uma classificação INCORRETA (Erro de categorização técnica). Indique a categoria real do conteúdo.
   - Só considere CORRETA se a URL for genuinamente apenas um frame técnico isolado, sem conteúdo editorial visível.

2. CONTEXTO DOMINANTE VS. PALAVRAS-CHAVE: Não classifique uma página como "indevida" apenas pela presença de palavras-chave isoladas. Analise o CONTEXTO DOMINANTE. 
   - Matérias jornalísticas, artigos de opinião política, análises históricas, avanços tecnológicos, geopolítica ou notícias de segurança pública NÃO devem ser classificados automaticamente como "Violência" ou "Crimes", a menos que haja exposição gráfica, apologia ou sensacionalismo extremo.

### CATEGORIAS INDEVIDAS DA SECOM (Definições Estritas)
- Língua estrangeira: Conteúdo principal fora do português brasileiro.
- Conteúdo adulto: Sexo explícito, pornografia, erotismo e afins.
- Violência: Imagens ou descrições explícitas de acidentes violentos, armas, mortes brutais, apologia à guerra. (Geopolítica, história militar, tecnologia de defesa ou notícias cotidianas de portais de grande mídia NÃO são violência).
- Crimes: Apologia ao crime, violação grave de direitos. (Atividade policial padrão ou notícias jurídicas/jornalísticas NÃO são crimes).
- Pirataria: Links e métodos para distribuição ilegal de conteúdo protegido.
- Terrorismo: Propaganda, recrutamento ou apologia a grupos extremistas/ataques.
- Discurso de ódio: Conteúdo explicitamente discriminatório (raça, gênero, religião, orientação sexual, etc.).
- Conteúdo gerado pelo usuário sem moderação: Fóruns abertos, chats anonimizados (alto risco de pedofilia/crimes).
- Drogas: Apologia, comércio ou tutorial de uso de substâncias ilícitas.

### INSTRUÇÕES DE SAÍDA (Formato de Resposta)
Você deve seguir estritamente o formato JSON abaixo para sua resposta. Pense passo a passo antes de definir o status.

{
  "analise_contexto": "Explique brevemente o foco principal da URL e o que de fato há na página.",
  "justificativa_brand_safety": "Avalie se o adserver errou a classificação (seja por falso positivo de Brand Safety ou por erro de categoria técnica como safeframe).",
  "status": "CORRETA" ou "INCORRETA",
  "categoria_sugerida": "Manter a atual se o status for CORRETA, ou indicar a categoria real (ex: 'Notícias', 'Tecnologia', 'Política') se for INCORRETA."
}

### EXEMPLOS PARA APRENDIZADO (Few-Shot)

Exemplo 1 (Falso Positivo de safeframe):
- URL: https://g1.globo.com/politica/noticia/2026/06/governo-anuncia-novas-medidas-economicas.html
- Categoria do Adserver: safeframe
- Resposta esperada:
{
  "analise_contexto": "A URL aponta para uma notícia jornalística real do portal G1 sobre política e economia governamental.",
  "justificativa_brand_safety": "INCORRETA. O adserver classificou erroneamente como 'safeframe' devido a uma limitação técnica de rastreamento no momento do leilão, mas a URL contém conteúdo editorial legítimo que deveria ser mapeado.",
  "status": "INCORRETA",
  "categoria_sugerida": "Política / Economia"
}

Exemplo 2 (Falso Positivo de Violência):
- URL: https://revistaforum.com.br/revista-forum/nem-portos-nem-barreiras-maior-marinha-do-mundo-cria-sistema-para-desembarcar-em-qualquer-costa/
- Categoria do Adserver: Violência
- Resposta esperada:
{
  "analise_contexto": "O artigo aborda um avanço tecnológico e logístico da marinha, focado em estratégia e engenharia.",
  "justificativa_brand_safety": "INCORRETA. Falso positivo. A presença de termos militares acionou o gatilho de 'Violência' do adserver, mas o texto não contém violência gráfica ou conflito armado. Trata-se de inovação/geopolítica.",
  "status": "INCORRETA",
  "categoria_sugerida": "Tecnologia / Geopolítica"
}
${categoriasDisponiveis.length > 0 ? `
Categorias usadas neste arquivo de verificação (prefira sugerir uma destas, ou uma categoria indevida do SECOM acima):
${categoriasDisponiveis.map((c) => `- ${c}`).join('\n')}
` : ''}
URL: ${item.url}
Categoria atribuída: ${item.categoria}` }],
    });

    const trimmed = response.message.content.trim();
    let status: string | null = null;
    let categoriaSugerida: string | null = null;
    let reason: string | null = null;

    try {
      const json = JSON.parse(trimmed) as { status?: string; categoria_sugerida?: string; justificativa_brand_safety?: string };
      status = (json.status ?? '').trim().toUpperCase();
      categoriaSugerida = json.categoria_sugerida?.trim() || null;
      reason = json.justificativa_brand_safety?.trim() || null;
    } catch {
      // fallback: plain-text "INCORRETA: cat | reason"
      const match = trimmed.match(/^INCORRETA[:\s]*(.*)$/i) ?? trimmed.match(/^N[ÃA]O[:\s]*(.*)$/i);
      if (match) {
        status = 'INCORRETA';
        const tail = match[1].trim();
        const pipeIdx = tail.indexOf('|');
        categoriaSugerida = pipeIdx >= 0 ? tail.slice(0, pipeIdx).trim() || null : null;
        reason = (pipeIdx >= 0 ? tail.slice(pipeIdx + 1).trim() : tail) || 'Classificação suspeita';
      }
    }

    if (status !== 'INCORRETA') return null;
    return { url: item.url, categoria: item.categoria, categoria_sugerida: categoriaSugerida, veiculo: item.veiculo, reason: reason ?? 'Classificação suspeita', impressoes: item.impressoes, pct: 0 };
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
      praca?: string;
    };
    const body = (await req.json()) as BlobBody;

    const { adserver, consolidado_url, consolidado_name, comp_urls, verif_urls = [] } = body;
    if (!adserver)          return NextResponse.json({ error: 'Adserver não informado.' }, { status: 400 });
    if (!consolidado_url)   return NextResponse.json({ error: 'Arquivo consolidado não enviado.' }, { status: 400 });
    if (!comp_urls?.length) return NextResponse.json({ error: 'Nenhum comprovante enviado.' }, { status: 400 });
    const adserverErr = validateAdserver(adserver);
    if (adserverErr) return NextResponse.json({ error: adserverErr }, { status: 400 });
    if (body.ini) { const e = validateDate('ini', body.ini); if (e) return NextResponse.json({ error: e }, { status: 400 }); }
    if (body.fim) { const e = validateDate('fim', body.fim); if (e) return NextResponse.json({ error: e }, { status: 400 }); }

    const allBlobUrls = [consolidado_url, ...comp_urls, ...verif_urls];
    const pyUrl = `https://${process.env.VERCEL_URL}/api/py/verification`;
    // proxy.ts gates /api/py/: shared secret when configured, else the
    // forwarded session cookie satisfies the token-presence check.
    const pyHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(process.env.INTERNAL_API_KEY
        ? { 'x-internal-key': process.env.INTERNAL_API_KEY }
        : { cookie: req.headers.get('cookie') ?? '' }),
    };
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
      ...(body.praca ? { praca: body.praca } : {}),
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
            headers: pyHeaders,
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
  const adserverErrFd = validateAdserver(adserver);
  if (adserverErrFd) return NextResponse.json({ error: adserverErrFd }, { status: 400 });

  const compFiles = form.getAll('comprovante') as File[];
  if (!compFiles.length) return NextResponse.json({ error: 'Nenhum comprovante enviado.' }, { status: 400 });

  const verifFiles = form.getAll('verif') as File[];
  const ini = form.get('ini') as string | null;
  const fim = form.get('fim') as string | null;
  if (ini) { const e = validateDate('ini', ini); if (e) return NextResponse.json({ error: e }, { status: 400 }); }
  if (fim) { const e = validateDate('fim', fim); if (e) return NextResponse.json({ error: e }, { status: 400 }); }
  const urlSamplePct = Number(form.get('url_sample_pct') ?? 10);
  const viewRulesRaw = form.get('view_rules') as string | null;
  const pracaRaw = form.get('praca') as string | null;

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
        ...(pracaRaw ? { praca: pracaRaw } : {}),
        ...(process.env.BLOB_READ_WRITE_TOKEN ? { blob_token: process.env.BLOB_READ_WRITE_TOKEN } : {}),
      };
      const pyHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(process.env.INTERNAL_API_KEY
          ? { 'x-internal-key': process.env.INTERNAL_API_KEY }
          : { cookie: req.headers.get('cookie') ?? '' }),
      };
      let pyResp: Response;
      try {
        pyResp = await fetch(pyUrl, {
          method: 'POST',
          headers: pyHeaders,
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
  const urlCategorias: string[] = (engineResult.url_categorias as string[]) ?? [];
  if (urlSample.length > 0 && process.env.OLLAMA_BASE_URL) {
    const BATCH = 20;
    send({ type: 'url_check_start', total: urlSample.length });
    let done = 0;
    for (let i = 0; i < urlSample.length; i += BATCH) {
      const batch = urlSample.slice(i, i + BATCH);
      const settled = await Promise.allSettled(batch.map((item) => checkUrlCategory(item, urlCategorias)));
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
      urlInfoByVeiculo[consolName].push(
        `${a.url} [${a.impressoes} imp, ${a.pct}%] → categoria atual: ${a.categoria}; sugerida: ${a.categoria_sugerida ?? '—'} (${a.reason})`
      );
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
    sem_consolidado:      engineResult.sem_consolidado,
    sem_consolidado_verif: engineResult.sem_consolidado_verif,
    sem_consolidado_comp:  engineResult.sem_consolidado_comp,
    parse_errors:        engineResult.parse_errors,
    file_base64:         fileBase64,
    file_name:           outputName,
    url_check_anomalies: urlCheckAnomalies,
  };
}
