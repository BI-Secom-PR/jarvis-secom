import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const ENGINE_PATH = path.join(process.cwd(), 'app', 'verification', 'engine.py');

function runEngine(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [ENGINE_PATH, ...args], {
      cwd: path.dirname(ENGINE_PATH),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
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

    // ── Salvar comprovantes + verif files ─────────────────────────────────
    const otherFiles = form.getAll('files') as File[];
    if (!otherFiles.length) {
      return NextResponse.json({ error: 'Nenhum comprovante enviado.' }, { status: 400 });
    }

    const otherPaths: string[] = [];
    for (const file of otherFiles) {
      const dest = path.join(tmpDir, file.name);
      await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()));
      otherPaths.push(dest);
    }

    // ── Parâmetros opcionais de data ───────────────────────────────────────
    const ini = form.get('ini') as string | null;
    const fim = form.get('fim') as string | null;

    const args = [consolidadoPath, ...otherPaths];
    if (ini) args.push('--ini', ini);
    if (fim) args.push('--fim', fim);

    // ── Executar engine ────────────────────────────────────────────────────
    const stdout = await runEngine(args);

    // engine.py imprime resumo de texto + JSON no final (após "\n\n")
    const jsonStart = stdout.lastIndexOf('\n{');
    if (jsonStart === -1) {
      return NextResponse.json({ error: 'Resposta inesperada do engine.', detail: stdout }, { status: 500 });
    }
    const engineResult = JSON.parse(stdout.slice(jsonStart + 1));

    // ── Ler arquivo verificado e embutir como base64 ───────────────────────
    let fileBase64: string | null = null;
    const outputPath: string = engineResult.output;
    try {
      const fileBuffer = await fs.readFile(outputPath);
      fileBase64 = fileBuffer.toString('base64');
    } catch {
      // arquivo pode não ter sido gerado se houve erro
    }

    return NextResponse.json({
      veiculos:        engineResult.veiculos,
      sem_comprovante: engineResult.sem_comprovante,
      sem_consolidado: engineResult.sem_consolidado,
      parse_errors:    engineResult.parse_errors,
      file_base64:     fileBase64,
      file_name:       path.basename(outputPath),
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    // Limpeza dos arquivos temporários
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
