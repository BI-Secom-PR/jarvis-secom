/**
 * Voice text pipeline: chartGate holds back the CHART_REQUEST sentinel from
 * the streamed text, speakableText strips markdown before it is spoken.
 * Run: npx tsx scripts/test-chart-gate.ts
 */
import assert from 'node:assert';
import { chartGate, parseChartRequest, CHART_SENTINEL } from '../lib/agent';
import { speakableText, nextSentenceBoundary } from '../lib/markdown';

/** Feeds deltas through the gate and returns everything it emitted. */
function drain(deltas: string[]): string {
  let out = '';
  const gate = chartGate((t) => { out += t; });
  for (const d of deltas) gate.push(d);
  gate.flush();
  return out;
}

/** Same, but WITHOUT the mandatory flush — only for asserting it is required. */
function drainNoFlush(deltas: string[]): string {
  let out = '';
  const gate = chartGate((t) => { out += t; });
  for (const d of deltas) gate.push(d);
  return out;
}

// 1. Sentinel-free text must survive EXACTLY — losing the held-back tail
//    truncated real replies mid-number ("foi de **R$" with the value gone).
const plain = ['Meta entregou ', '1.234.567 impressões ', 'em agosto de 2026.'];
const full = plain.join('');
assert.strictEqual(drain(plain), full);

// 1b. And the flush is what makes that true — prove it is load-bearing.
const withoutFlush = drainNoFlush(plain);
assert(
  withoutFlush.length < full.length,
  'expected the un-flushed gate to hold text back; if not, the flush is dead code',
);
assert(full.startsWith(withoutFlush), 'held-back output must still be a prefix');

// 2. Sentinel arriving whole in one delta: nothing from it onward is emitted.
assert.strictEqual(
  drain(['Veja o gráfico. ', 'CHART_REQUEST:{"type":"bar","labels":[]}']),
  'Veja o gráfico. ',
);

// 3. Sentinel split across deltas — the killer case. Every split point.
for (let cut = 1; cut < CHART_SENTINEL.length; cut++) {
  const out = drain([
    'Resumo pronto. ',
    CHART_SENTINEL.slice(0, cut),
    CHART_SENTINEL.slice(cut) + '{"type":"pie"}',
  ]);
  assert.strictEqual(out, 'Resumo pronto. ', `leaked at split ${cut}: ${JSON.stringify(out)}`);
}

// 4. One char at a time — the worst-case delta size.
assert.strictEqual(
  drain(('Oi. ' + CHART_SENTINEL + '{"type":"line"}').split('')),
  'Oi. ',
);

// 5. The gate's output must agree with what parseChartRequest keeps.
const withChart = 'Total: 42 impressões. CHART_REQUEST:{"type":"bar","labels":["a"],"datasets":[]}';
const { cleanText, chartData } = parseChartRequest(withChart);
assert(chartData !== null, 'parseChartRequest should have found the chart');
assert.strictEqual(drain([withChart]).trim(), cleanText);

// ── speakableText ─────────────────────────────────────────────────────────

// 6. The exact shape seen live in the voice overlay: bold + the ∣ substitute.
assert.strictEqual(
  speakableText('A campanha mais recente é a **2026 ∣ CADERNETA 20260021 ∣ NACIONAL**, na plataforma **TikTok**.'),
  'A campanha mais recente é a 2026 CADERNETA 20260021 NACIONAL, na plataforma TikTok.',
);

// 7. A markdown table becomes prose, not punctuation soup.
const table = [
  '| Plataforma | Impressões |',
  '|---|---:|',
  '| TikTok | 91.504.430 |',
].join('\n');
const spokenTable = speakableText(table);
assert(!/[|∣]/.test(spokenTable), `pipes survived: ${JSON.stringify(spokenTable)}`);
assert(!/---/.test(spokenTable), `table rule survived: ${JSON.stringify(spokenTable)}`);
assert(spokenTable.includes('91.504.430'), 'the number must survive');

// 8. Brazilian number formatting must not be mangled — the whole point.
for (const n of ['1.234,56', 'R$ 3,20', '12,5%', '91.504.430']) {
  assert(speakableText(`Total de ${n} no período.`).includes(n), `mangled ${n}`);
}

// 9. Headers, bullets and inline code go; numbered lists stay readable.
assert.strictEqual(speakableText('## Resumo\n- primeiro\n- segundo'), 'Resumo\nprimeiro\nsegundo');
assert.strictEqual(speakableText('use `gold_platforms_campaigns` aqui'), 'use gold_platforms_campaigns aqui');
assert.strictEqual(speakableText('1. um\n2. dois'), '1. um\n2. dois');

// 10. Idempotent — clean prose passes through untouched.
const clean = 'O CTR do Meta foi 1,8% em agosto de 2026.';
assert.strictEqual(speakableText(clean), clean);
assert.strictEqual(speakableText(speakableText(clean)), clean);

// ── nextSentenceBoundary ──────────────────────────────────────────────────

const MIN = 60;
/** Cuts a full reply the way the streaming pipeline does. */
function chunkAll(text: string): string[] {
  const out: string[] = [];
  let buf = text;
  for (;;) {
    const cut = nextSentenceBoundary(buf, MIN);
    if (cut < 0) break;
    out.push(buf.slice(0, cut).trim());
    buf = buf.slice(cut);
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// 11. Numbers must never be split — the failure that would garble every reply.
const numeric =
  'O Meta entregou 37.571.185 impressões com CTR de 1,82% no período analisado. ' +
  'O CPM médio ficou em R$ 3,20 e o investimento total somou R$ 1.234.567,89 no mês.';
for (const piece of chunkAll(numeric)) {
  assert(!/\d\.$/.test(piece.replace(/\s+$/, '')), `split inside a number: ${JSON.stringify(piece)}`);
}
assert(chunkAll(numeric).join(' ').includes('37.571.185'), 'lost a number across chunks');
assert(chunkAll(numeric).join(' ').includes('R$ 1.234.567,89'), 'lost the currency value');

// 12. Abbreviations are not sentence ends — "Sr." and "ago." must be skipped,
//     and the cut must land after "hoje.".
const abbrev = 'Segundo o Sr. Silva, a campanha de ago. teve bom desempenho geral hoje. E agora?';
assert.strictEqual(
  abbrev.slice(0, nextSentenceBoundary(abbrev, MIN)),
  'Segundo o Sr. Silva, a campanha de ago. teve bom desempenho geral hoje.',
);

// 13. Nothing is emitted until a sentence actually finishes. A trailing
//     terminator with nothing after it waits, because it could still be "1.234".
assert.strictEqual(nextSentenceBoundary('uma resposta ainda incompleta sem nenhum ponto final aqui', MIN), -1);
assert.strictEqual(nextSentenceBoundary('Uma frase completa de tamanho suficiente para passar do minimo.', MIN), -1);
// A terminator before `min` is held back so TTS is not called per clause.
assert.strictEqual(nextSentenceBoundary('Sim. Claro.', MIN), -1);

// 14. Feeding one character at a time yields the same chunks as one shot —
//     the property the streaming path depends on.
const streamed: string[] = [];
let acc = '';
for (const ch of numeric) {
  acc += ch;
  for (;;) {
    const cut = nextSentenceBoundary(acc, MIN);
    if (cut < 0) break;
    streamed.push(acc.slice(0, cut).trim());
    acc = acc.slice(cut);
  }
}
if (acc.trim()) streamed.push(acc.trim());
assert.deepStrictEqual(streamed, chunkAll(numeric), 'char-by-char chunking must match one-shot');

// 15. The first chunk is short enough to be the fast first utterance.
assert(chunkAll(numeric)[0].length < 200, 'first chunk should be one sentence, not the whole reply');

console.log(
  `OK — voice text pipeline: 15 checks passed. First spoken chunk would be: ${JSON.stringify(chunkAll(numeric)[0])}`,
);
