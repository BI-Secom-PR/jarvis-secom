/**
 * isEcho decides whether a recognition result during 'speaking' is Jarvis's
 * own voice leaking into the mic, or a genuine barge-in.
 * Run: npx tsx scripts/test-voice-echo.ts
 */
import assert from 'node:assert';
import { isEcho, estimateSpeechMs } from '../components/VoiceMode';

const SPOKEN =
  'O valor total investido na campanha de Atualização da Caderneta de Vacinação foi de R$ 297.702,56 no período.';

// 1. A literal fragment of what was spoken — the actual failure mode this
//    exists to catch (mic hears "campanha de atualização" while it's said).
assert.strictEqual(isEcho('campanha de atualização', SPOKEN), true);

// 2. Case/accent-insensitive — recognition rarely matches punctuation exactly.
assert.strictEqual(isEcho('CAMPANHA DE ATUALIZACAO', SPOKEN), true);

// 3. A real interruption sharing no vocabulary with the current sentence.
assert.strictEqual(isEcho('para, muda de assunto', SPOKEN), false);

// 4. A real interruption that happens to reuse the topic word ("campanha")
//    but is otherwise unrelated — below the 60% overlap line.
assert.strictEqual(isEcho('qual foi a outra campanha do mes passado', SPOKEN), false);

// 5. Empty/whitespace-only candidate is never treated as an echo (nothing to
//    compare) and never as a barge-in — the caller drops empty finals anyway.
assert.strictEqual(isEcho('', SPOKEN), false);
assert.strictEqual(isEcho('   ', SPOKEN), false);

// 6. Nothing spoken yet (start of a turn) — nothing can be an echo of silence.
assert.strictEqual(isEcho('interrompendo agora', ''), false);

// 7. A short genuine utterance that is a true substring by accident stays
//    classified as an echo — the documented heuristic ceiling, not a bug.
assert.strictEqual(isEcho('vacinação', SPOKEN), true);

// ── estimateSpeechMs (the watchdog bound for a stuck speechSynthesis call) ──

// 8. Never below the floor — a one-word reply must still get a bounded wait,
//    not an instant timeout that cuts off real (if unlikely) fast speech.
assert.strictEqual(estimateSpeechMs('Sim.'), 8000);
assert.strictEqual(estimateSpeechMs(''), 8000);

// 9. Scales with length past the floor, so a long reply gets a proportionally
//    longer grace period instead of being cut off mid-sentence.
const long = 'x'.repeat(200);
assert.strictEqual(estimateSpeechMs(long), 200 * 120);
assert(estimateSpeechMs(long) > estimateSpeechMs('Sim.'), 'longer text must get more time, not less');

console.log('OK — isEcho + estimateSpeechMs: 9 checks passed.');
