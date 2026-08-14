/**
 * Sobe arquivos pro bucket de staging e imprime [{url, name, path}] em JSON —
 * as mesmas signed URLs que a rota /run entrega ao Python.
 * Com --cleanup, apaga os paths passados em vez de subir.
 * Usado por scripts/test-storage-roundtrip.py.
 */
import { basename } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  createSignedUploadUrl,
  createSignedDownloadUrl,
  removeFiles,
  safeObjectPath,
} from '../lib/storage';

const args = process.argv.slice(2);
if (!args.length) throw new Error('uso: upload-fixtures.ts [--cleanup] <arquivo|path...>');

if (args[0] === '--cleanup') {
  await removeFiles(args.slice(1));
  console.log(JSON.stringify({ removed: args.length - 1 }));
} else {
  const out = [];
  for (const f of args) {
    const name = basename(f);
    const path = safeObjectPath(name);
    const uploadUrl = await createSignedUploadUrl(path);
    const put = await fetch(uploadUrl, { method: 'PUT', body: new Uint8Array(readFileSync(f)) });
    if (!put.ok) throw new Error(`upload de ${name} falhou (HTTP ${put.status}): ${await put.text()}`);
    out.push({ url: await createSignedDownloadUrl(path, 900), name, path });
  }
  console.log(JSON.stringify(out));
}
