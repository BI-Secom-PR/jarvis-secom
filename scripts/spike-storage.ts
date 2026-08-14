/**
 * Passo 0 do plano: prova que o staging no Supabase Storage funciona ponta a
 * ponta (bucket → signed upload → PUT → signed download → delete).
 *
 * Uso:  bun --env-file=.env.local scripts/spike-storage.ts
 *
 * Cobre a metade servidor. A metade CORS (browser fazendo PUT cross-origin)
 * roda depois, com a signed URL que este script imprime no fim.
 */
import { readFileSync } from 'node:fs';
import {
  ensureBucket,
  createSignedUploadUrl,
  createSignedDownloadUrl,
  removeFiles,
  BUCKET,
} from '../lib/storage';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FIXTURE = 'verification/TEMPLATE - Consolidado Verification - ADFORCE.xlsx';

async function main() {
  const bytes = readFileSync(FIXTURE);
  console.log(`fixture: ${FIXTURE} (${bytes.length} bytes)`);

  // 1. Bucket privado — idempotente, então rodar de novo não quebra.
  console.log(`✓ bucket "${BUCKET}": ${await ensureBucket()}`);

  // 2. Signed upload URL.
  const path = `spike/${crypto.randomUUID()}/teste.xlsx`;
  const uploadUrl = await createSignedUploadUrl(path);
  console.log(`✓ signed upload URL criada`);

  // 3. PUT dos bytes — o mesmo que o browser vai fazer.
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': XLSX_MIME },
    body: new Uint8Array(bytes),
  });
  if (!put.ok) throw new Error(`upload falhou (HTTP ${put.status}): ${await put.text()}`);
  console.log(`✓ upload ok — ${path}`);

  // 4. Signed download URL SEM header de auth — exatamente o que o
  //    api/py/verification.py faz hoje com _download_url(url, dest).
  const downloadUrl = await createSignedDownloadUrl(path);
  const dl = await fetch(downloadUrl);
  if (!dl.ok) throw new Error(`download falhou (HTTP ${dl.status}): ${await dl.text()}`);
  const back = new Uint8Array(await dl.arrayBuffer());
  if (back.length !== bytes.length) {
    throw new Error(`download divergente: subiu ${bytes.length} bytes, voltou ${back.length}`);
  }
  console.log(`✓ download sem auth ok — ${back.length} bytes, idêntico ao original`);

  // 5. Cleanup + prova de que sumiu.
  //    Checar relistando, não rebaixando a signed URL: o Supabase serve essas
  //    URLs por CDN, então a borda ainda entrega o arquivo por um tempo depois
  //    do delete. A listagem é a fonte de verdade.
  await removeFiles([path]);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const list = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: path.split('/').slice(0, 2).join('/'), limit: 10 }),
  });
  const remaining = (await list.json()) as { name: string }[];
  if (remaining.length) throw new Error(`arquivo ainda no bucket após delete: ${JSON.stringify(remaining)}`);
  console.log(`✓ delete ok (bucket vazio no prefixo)`);

  // 6. URL virgem pro teste de CORS no browser.
  const corsPath = `spike/${crypto.randomUUID()}/cors.xlsx`;
  const corsUrl = await createSignedUploadUrl(corsPath);
  console.log(`\n── metade servidor PASSOU ──\n`);
  console.log(`Agora o CORS. Com o dev server rodando, cole no console de http://localhost:3000:\n`);
  console.log(
    `fetch(${JSON.stringify(corsUrl)},{method:'PUT',headers:{'Content-Type':${JSON.stringify(XLSX_MIME)}},body:new Blob([new Uint8Array(${bytes.length})])}).then(r=>console.log('status',r.status))\n`,
  );
  console.log(`Esperado: status 200. Se der erro de CORS, o upload direto do browser morre — pare aqui.`);
}

main().catch((e) => {
  console.error(`✗ FALHOU: ${e.message}`);
  process.exit(1);
});
