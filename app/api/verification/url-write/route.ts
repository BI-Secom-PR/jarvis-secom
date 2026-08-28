import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import type { UrlAnomalyItem, UrlCheckedRow } from '@/lib/urlCheck';

export const maxDuration = 300;

type Veiculo = { veiculo: string; match: string | null; entregue_consol?: number };

function pyHeaders(cookie: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(process.env.INTERNAL_API_KEY ? { 'x-internal-key': process.env.INTERNAL_API_KEY } : {}),
    cookie,
  };
}

/**
 * Fecha a auditoria: calcula o pct de impressões por veículo, separa as
 * anomalias e grava a col 30 no xlsx verificado.
 *
 * Roda depois que o cliente consumiu todos os lotes de /url-check — só aí o
 * conjunto de anomalias está completo.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    file_base64?: string;
    file_name?: string;
    rows?: UrlCheckedRow[];
    veiculos?: Veiculo[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  const veiculos = Array.isArray(body.veiculos) ? body.veiculos : [];
  const fileName = body.file_name || 'verificado.xlsx';
  let fileBase64 = body.file_base64 ?? null;
  if (!fileBase64) return NextResponse.json({ error: 'file_base64 é obrigatório' }, { status: 400 });

  // ── pct de impressões por veículo ────────────────────────────────────────
  const entregueByMatch = new Map<string, number>();
  for (const v of veiculos) {
    if (v.entregue_consol) {
      if (v.match) entregueByMatch.set(v.match, v.entregue_consol);
      entregueByMatch.set(v.veiculo, v.entregue_consol);
    }
  }
  const urlCheckRows: UrlCheckedRow[] = rows.map((a) => {
    const total = entregueByMatch.get(a.veiculo) ?? 0;
    return { ...a, pct: total > 0 ? Math.round((a.impressoes / total) * 10000) / 100 : 0 };
  });

  const anomalies: UrlAnomalyItem[] = urlCheckRows.filter((r) => r.status === 'INCORRETA');

  if (anomalies.length > 0) {
    const matchToConsol = new Map<string, string>();
    for (const v of veiculos) if (v.match) matchToConsol.set(v.match, v.veiculo);

    const urlInfoByVeiculo: Record<string, string[]> = {};
    for (const a of anomalies) {
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
        const pyResp = await fetch(`https://${process.env.VERCEL_URL}/api/py/verification`, {
          method: 'POST',
          headers: pyHeaders(req.headers.get('cookie') ?? ''),
          body: JSON.stringify({
            output_b64:          fileBase64,
            output_name:         fileName,
            url_info_by_veiculo: urlInfoFlat,
          }),
        });
        if (pyResp.ok) {
          const upd = await pyResp.json() as { output_b64?: string };
          if (upd.output_b64) fileBase64 = upd.output_b64;
        }
      } else {
        // On-prem o xlsx chega em base64 (o arquivo do engine já foi embora com
        // a requisição anterior), então grava-se num tmp para o script Python.
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), `urlinfo-${randomUUID()}-`));
        const outPath = path.join(dir, path.basename(fileName));
        try {
          await fs.writeFile(outPath, Buffer.from(fileBase64, 'base64'));
          const script = path.join(process.cwd(), 'app', 'verification', 'parsers', 'write_url_info.py');
          await new Promise<void>((resolve, reject) => {
            const proc = spawn('python3', [script, outPath, JSON.stringify(urlInfoFlat)], {
              env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
            });
            proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`write_url_info exited ${code}`)));
            proc.on('error', reject);
          });
          fileBase64 = (await fs.readFile(outPath)).toString('base64');
        } finally {
          await fs.rm(dir, { recursive: true, force: true });
        }
      }
    } catch (e) {
      // Não-crítico: o arquivo segue sem a col 30, mas as anomalias vão na resposta.
      console.error('[url-write] col 30 não gravada:', e);
    }
  }

  return NextResponse.json({
    file_base64:         fileBase64,
    file_name:           fileName,
    url_check_rows:      urlCheckRows,
    url_check_anomalies: anomalies,
  });
}
