// Check dos filtros lembrados do dashboard:  npx tsx scripts/test-dashboard-prefs.ts
//
// Só parsePrefs (puro) — nada de DOM nem banco.

import assert from 'node:assert/strict';
import { parsePrefs, prefsKey } from '../lib/dashboardPrefs';

// Round-trip completo.
const full = {
  days: 30, campaigns: ['A'], platforms: ['meta', 'google'], networks: [], ads: ['x'],
  objectives: [], buyingTypes: ['CPV'], temas: ['ECO'],
  tab: 'regiao', metric: 'cliques', gran: 'semana', tmode: 'anuncio', engMode: 'partes', byNetwork: true,
};
assert.deepEqual(parsePrefs(JSON.stringify(full)), full);

// Datas exatas voltam em par; o atalho relativo não carrega from/to.
assert.deepEqual(parsePrefs('{"from":"2026-09-01","to":"2026-09-30"}'), { from: '2026-09-01', to: '2026-09-30' });
// Um lado só, formato ruim ou período invertido: descarta as datas, nada quebra.
assert.deepEqual(parsePrefs('{"from":"2026-09-01"}'), {});
assert.deepEqual(parsePrefs('{"from":"01/09/2026","to":"2026-09-30"}'), {});
assert.deepEqual(parsePrefs('{"from":"2026-10-01","to":"2026-09-01"}'), {});

// days só aceita os atalhos da UI.
assert.deepEqual(parsePrefs('{"days":14}'), { days: 14 });
assert.deepEqual(parsePrefs('{"days":45}'), {});

// Campo inválido cai sozinho; o resto sobrevive.
assert.deepEqual(parsePrefs('{"tab":"xyz","gran":"mes","metric":"__proto__","byNetwork":"sim"}'), { gran: 'mes' });
// Arrays: só strings não vazias.
assert.deepEqual(parsePrefs('{"campaigns":["A",3,null,"","B"],"platforms":"meta"}'), { campaigns: ['A', 'B'] });

// Lixo, vazio, ausente, não-objeto: abre nos padrões.
for (const raw of [null, '', '{', 'null', '[]', '"x"', '42']) assert.deepEqual(parsePrefs(raw), {}, `raw=${raw}`);

// Chave por usuário.
assert.notEqual(prefsKey('u1'), prefsKey('u2'));

console.log('ok — filtros lembrados do dashboard');
