'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ModelId } from '@/lib/agent';
import type { Message } from '@/types/chat';
import { hudSignal } from '@/lib/hudSignal';
import { speakableText, nextSentenceBoundary } from '@/lib/markdown';
import HudBackground from './HudBackground';
import HudCorners from './HudCorners';

type OrbState = 'connecting' | 'idle' | 'listening' | 'thinking' | 'speaking';

const STATE_LABEL: Record<OrbState, string> = {
  connecting: 'Conectando…',
  idle: 'Ouvindo…',
  listening: 'Ouvindo…',
  thinking: 'Consultando dados…',
  speaking: 'Falando…',
};

// Gold while it works, cyan while it listens or talks.
const STATE_ACCENT: Record<OrbState, 'cyan' | 'gold'> = {
  connecting: 'cyan',
  idle: 'cyan',
  listening: 'cyan',
  thinking: 'gold',
  speaking: 'cyan',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const SpeechRecognitionCtor: (new () => SpeechRecognition) | null =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null
    : null;
/* eslint-enable @typescript-eslint/no-explicit-any */

const FFT_SIZE = 256;
/** Don't speak a fragment shorter than this — one utterance per clause stutters. */
const MIN_CHUNK = 60;
const VAD_THRESHOLD = 0.15;
/** Sustained-above-threshold time before the orb commits to "listening". */
const VAD_TRIGGER_MS = 250;
/** Sustained-below-threshold time before it releases back to "idle". */
const VAD_RELEASE_MS = 600;
/** How much conversation to carry, in turns. Matches what the text chat sends. */
const HISTORY_TURNS = 12;

/**
 * Gemini TTS sounds better but the free tier allows **10 requests per day**
 * (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`), and past it the SDK
 * retries until the call takes minutes — measured 109s and 218s. The browser's
 * own pt-BR voices start in ~34ms with no quota, so they are the default and
 * Gemini is opt-in for demos.
 */
const USE_GEMINI_TTS = process.env.NEXT_PUBLIC_USE_GEMINI_TTS === 'true';

interface TtsAudio {
  audio: string;
  mimeType: string;
}

/**
 * Watchdog bound for a single speechSynthesis utterance — generous enough
 * that real speech never trips it (~8 chars/sec is a slow floor; typical
 * speech is faster), tight enough to recover a hung utterance in seconds
 * rather than leaving a turn stuck until the user's next question forces it.
 * Exported for scripts/test-voice-echo.ts.
 */
export function estimateSpeechMs(text: string): number {
  return Math.max(8000, text.length * 120);
}

/** Best available local pt-BR voice, or null before the list has loaded. */
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const pt = voices.filter((v) => v.lang?.toLowerCase().startsWith('pt-br'));
  return pt.find((v) => /luciana/i.test(v.name)) ?? pt.find((v) => v.localService) ?? pt[0] ?? null;
}

/** Exported for scripts/test-voice-echo.ts — not used elsewhere in the app. */
export function normalizeWords(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * True when `candidate` (a fresh recognition result) looks like the mic
 * picking up Jarvis's own voice rather than a real interruption — the
 * defense `echoCancellation` doesn't reliably provide for speechSynthesis
 * output, which never passes through our AudioContext.
 *
 * ponytail: a word-overlap heuristic, not real audio correlation. Ceiling —
 * a short genuine interruption that happens to reuse most of the words
 * Jarvis just said can be misread as an echo. Escalate to Silero VAD
 * (@ricky0123/vad-web) only if this proves too aggressive in live use.
 */
export function isEcho(candidate: string, spoken: string): boolean {
  const cWords = normalizeWords(candidate);
  if (cWords.length === 0) return false;
  const spokenNorm = ' ' + normalizeWords(spoken).join(' ') + ' ';
  if (spokenNorm.includes(' ' + cWords.join(' ') + ' ')) return true; // literal fragment
  const matched = cWords.filter((w) => spokenNorm.includes(' ' + w + ' ')).length;
  return matched / cWords.length > 0.6;
}

function makeAnalyser(ctx: AudioContext): AnalyserNode {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  return analyser;
}

function setupRecognition(
  onResult: (e: SpeechRecognitionEvent) => void,
  onError: (e: SpeechRecognitionErrorEvent) => void,
  onEnd: () => void,
): SpeechRecognition {
  const recognition = new SpeechRecognitionCtor!();
  recognition.lang = 'pt-BR';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = onResult;
  recognition.onerror = onError;
  recognition.onend = onEnd;
  return recognition;
}

interface Props {
  onClose: () => void;
  model: ModelId;
  /** Conversation so far, so follow-ups ("e o investimento?") resolve. */
  messages: Message[];
  chatSessionId: string | null;
  /** Hands the finished turn back so it lands in the transcript and Postgres. */
  onTurn: (userText: string, aiText: string) => void;
}

export default function VoiceMode({ onClose, model, messages, chatSessionId, onTurn }: Props) {
  const [mounted, setMounted] = useState(false);
  const [orbState, setOrbState] = useState<OrbState>('connecting');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');

  const audioCtxRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const ttsAnalyserRef = useRef<AnalyserNode | null>(null);
  // Allocated once, not per frame. Pinned to ArrayBuffer because
  // getByteFrequencyData rejects a possibly-shared backing buffer.
  const freqRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(FFT_SIZE / 2));
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const rafRef = useRef<number>(0);
  const orbStateRef = useRef<OrbState>('connecting');
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const closedRef = useRef(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  // Barge-in bookkeeping. sourcesRef holds Gemini-path buffer sources so a
  // new turn can stop them; spokenTextRef is what isEcho compares against;
  // turnEpochRef lets a superseded turn's `finally` recognize it is stale
  // (started interrupting it, then a newer turn began) and skip its cleanup
  // instead of stomping the new turn's state.
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const spokenTextRef = useRef('');
  const turnEpochRef = useRef(0);
  // Hangover state for the idle/listening VAD debounce below.
  const vadRef = useRef<{ above: boolean; since: number }>({ above: false, since: 0 });
  // speechSynthesis plays outside our AudioContext, so no analyser can see it.
  // Its onboundary event fires per word, which drives a decaying pulse instead
  // — word-synced rather than waveform-accurate.
  const speechPulseRef = useRef(0);

  // Live values read from inside the long-lived startup effect. Kept in refs so
  // the effect never re-runs — re-running it would tear down the mic and
  // re-prompt for permission on every new message.
  const messagesRef = useRef(messages);
  const sessionIdRef = useRef(chatSessionId);
  const onTurnRef = useRef(onTurn);
  const modelRef = useRef(model);
  useEffect(() => {
    messagesRef.current = messages;
    sessionIdRef.current = chatSessionId;
    onTurnRef.current = onTurn;
    modelRef.current = model;
  }, [messages, chatSessionId, onTurn, model]);

  useEffect(() => {
    orbStateRef.current = orbState;
  }, [orbState]);

  useEffect(() => setMounted(true), []);

  // getVoices() is empty on the first call in Chrome until the list loads.
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const refresh = () => {
      voiceRef.current = pickVoice();
    };
    refresh();
    synth.addEventListener('voiceschanged', refresh);
    return () => synth.removeEventListener('voiceschanged', refresh);
  }, []);

  const cleanup = useCallback(() => {
    closedRef.current = true;
    abortRef.current?.abort();
    cancelAnimationFrame(rafRef.current);
    recognitionRef.current?.abort();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    activeSourcesRef.current.forEach((s) => {
      try { s.stop(); } catch { /* already stopped */ }
    });
    activeSourcesRef.current.clear();
    audioCtxRef.current?.close().catch(() => {});
    window.speechSynthesis?.cancel();
    hudSignal.amplitude = 0;
    hudSignal.overlayOpen = false;
  }, []);

  // Samples whichever analyser is live and hands the level to the arc HUD.
  // No DOM writes and no per-frame allocation — the canvas does the drawing.
  const sampleAudio = useCallback(() => {
    const speaking = orbStateRef.current === 'speaking';

    // Native speech: no analyser exists, so use the word-boundary pulse.
    if (speaking && !USE_GEMINI_TTS) {
      speechPulseRef.current *= 0.9;
      hudSignal.amplitude = speechPulseRef.current;
      rafRef.current = requestAnimationFrame(sampleAudio);
      return;
    }

    const analyser = speaking ? ttsAnalyserRef.current : micAnalyserRef.current;
    if (analyser) {
      const data = freqRef.current;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const amplitude = Math.min(sum / data.length / 80, 1);
      hudSignal.amplitude = amplitude;

      // Hangover VAD: the orb only flips once the mic has been consistently
      // above/below the threshold for a stretch, not on the first noisy frame.
      const now = performance.now();
      const above = amplitude > VAD_THRESHOLD;
      if (above !== vadRef.current.above) vadRef.current = { above, since: now };
      const elapsed = now - vadRef.current.since;

      const state = orbStateRef.current;
      if (state === 'idle' && above && elapsed >= VAD_TRIGGER_MS) setOrbState('listening');
      else if (state === 'listening' && !above && elapsed >= VAD_RELEASE_MS) setOrbState('idle');
    }
    rafRef.current = requestAnimationFrame(sampleAudio);
  }, []);

  // Decode base64 PCM (16-bit signed LE) to an AudioBuffer
  const decodePcm16 = useCallback((base64: string, sampleRate: number): AudioBuffer | null => {
    const ctx = audioCtxRef.current;
    if (!ctx) return null;
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const i16 = new Int16Array(bytes.buffer);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
    const buf = ctx.createBuffer(1, f32.length, sampleRate);
    buf.copyToChannel(f32, 0);
    return buf;
  }, []);

  const playAudio = useCallback(
    (base64: string, mimeType: string): Promise<void> => {
      const ctx = audioCtxRef.current;
      if (!ctx) return Promise.resolve();

      // Parse sample rate from mimeType like "audio/L16;rate=24000"
      const rateMatch = mimeType.match(/rate=(\d+)/);
      const buf = decodePcm16(base64, rateMatch ? parseInt(rateMatch[1], 10) : 24000);
      if (!buf) return Promise.resolve();

      const src = ctx.createBufferSource();
      src.buffer = buf;

      // Through an analyser, not straight to the destination: this is what
      // lets the arc HUD pulse with Jarvis's own voice.
      const analyser = ttsAnalyserRef.current ?? makeAnalyser(ctx);
      ttsAnalyserRef.current = analyser;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      activeSourcesRef.current.add(src);
      src.start();

      return new Promise((resolve) => {
        src.onended = () => {
          activeSourcesRef.current.delete(src);
          resolve();
        };
      });
    },
    [decodePcm16],
  );

  /**
   * The default voice path: instant, unmetered, offline. Resolves when the
   * sentence has finished being spoken, so the caller can queue the next one.
   *
   * Two real-browser failure modes this guards against, neither of which the
   * mocked-synth tests exercise:
   *  - Chrome silently pauses `speechSynthesis` after ~15s of continuous
   *    speech unless nudged; `pause()`+`resume()` is the documented
   *    workaround, applied here every few seconds while an utterance runs.
   *  - `onend`/`onerror` occasionally never fire at all. Without a bound,
   *    that hangs the turn forever: `busyRef` stays true, the reply is never
   *    handed to `onTurn`, and the ONLY way out is the user's next question
   *    triggering the barge-in path — which correctly discards a genuinely
   *    interrupted turn, silently losing this one's Q&A from history. The
   *    watchdog below means a stuck utterance resolves on its own instead.
   */
  const speakNative = useCallback((text: string): Promise<void> => {
    const synth = window.speechSynthesis;
    if (!synth) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearInterval(keepAlive);
        clearTimeout(watchdog);
        resolve();
      };

      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'pt-BR';
      if (voiceRef.current) utter.voice = voiceRef.current;
      // Each word bumps the pulse that drives the arc HUD; sampleAudio decays it.
      utter.onboundary = () => {
        speechPulseRef.current = 0.85;
      };
      utter.onend = finish;
      utter.onerror = finish;

      const keepAlive = setInterval(() => {
        if (synth.speaking) { synth.pause(); synth.resume(); }
      }, 10000);
      // ~8 chars/sec is a slow, generous speech-rate floor — real speech is
      // faster, so this only ever fires when something has actually hung.
      const watchdog = setTimeout(finish, estimateSpeechMs(text));

      synth.speak(utter);
    });
  }, []);

  const handleVoiceQuery = useCallback(
    async (text: string) => {
      // A turn already in flight is a barge-in target, not a reason to drop
      // the new one: cancel whatever Jarvis is doing and take over. The mic
      // is never stopped (see the startup effect) so this can fire mid-speech.
      if (busyRef.current) {
        abortRef.current?.abort();
        window.speechSynthesis?.cancel();
        activeSourcesRef.current.forEach((s) => {
          try { s.stop(); } catch { /* already stopped */ }
        });
        activeSourcesRef.current.clear();
      }
      // Stamped so the turn this interrupts can tell, in its own `finally`,
      // that a newer turn has already taken over and skip resetting state.
      const myEpoch = ++turnEpochRef.current;
      busyRef.current = true;
      spokenTextRef.current = '';
      setError('');
      setTranscript('');
      setOrbState('thinking');

      const controller = new AbortController();
      abortRef.current = controller;

      // Sentence queue feeding a serial TTS pipeline, with one request in
      // flight ahead of playback so synthesis overlaps speech.
      const pending: string[] = [];
      let pumping = false;
      let spoke = false;
      let full = '';
      let buffered = '';

      const fetchTts = async (chunk: string): Promise<TtsAudio | null> => {
        try {
          const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: chunk }),
            signal: controller.signal,
          });
          if (!res.ok) return null;
          const data = await res.json();
          return data?.audio ? { audio: data.audio, mimeType: data.mimeType ?? 'audio/L16;rate=24000' } : null;
        } catch {
          return null;
        }
      };

      /** Speaks one sentence, resolving when it has finished playing. */
      const speakOne = async (sentence: string) => {
        if (!USE_GEMINI_TTS) return speakNative(sentence);
        const audio = await fetchTts(sentence);
        // Quota exhausted or the call failed — the local voice still speaks.
        if (!audio) return speakNative(sentence);
        return playAudio(audio.audio, audio.mimeType);
      };

      const pump = async () => {
        if (pumping) return;
        pumping = true;
        while (!controller.signal.aborted && pending.length) {
          const sentence = pending.shift()!;
          if (!spoke) {
            spoke = true;
            setOrbState('speaking');
          }
          spokenTextRef.current += ' ' + sentence;
          await speakOne(sentence);
        }
        pumping = false;
      };

      // The chunker needs the spoken text, so markdown is stripped per delta.
      const feed = (delta: string) => {
        buffered += delta;
        for (;;) {
          const cut = nextSentenceBoundary(buffered, MIN_CHUNK);
          if (cut < 0) break;
          const sentence = speakableText(buffered.slice(0, cut)).trim();
          buffered = buffered.slice(cut);
          if (sentence) {
            pending.push(sentence);
            void pump();
          }
        }
      };

      try {
        const history = messagesRef.current.slice(-HISTORY_TURNS).map((m) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.text,
        }));

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatInput: text,
            messages: history,
            model: modelRef.current,
            chatSessionId: sessionIdRef.current,
            stream: true,
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        // SSE reader — same shape as consumeVerifStream in VerificationContainer
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuf = '';
        let streamError = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuf += decoder.decode(value, { stream: true });
          const lines = sseBuf.split('\n');
          sseBuf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            let ev: { type?: string; text?: string; phase?: string; message?: string };
            try {
              ev = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            if (ev.type === 'delta' && ev.text) {
              full += ev.text;
              setTranscript(speakableText(full));
              feed(ev.text);
            } else if (ev.type === 'error') {
              streamError = ev.message ?? 'Erro no servidor.';
            }
          }
        }

        if (streamError) throw new Error(streamError);

        // Whatever never reached a sentence boundary still has to be spoken.
        const tail = speakableText(buffered).trim();
        if (tail) {
          pending.push(tail);
          void pump();
        }

        // Drain the queue before reopening the mic.
        while (!controller.signal.aborted && (pending.length || pumping)) {
          await new Promise((r) => setTimeout(r, 120));
        }

        const spokenFull = speakableText(full).trim();
        if (spokenFull && !controller.signal.aborted) {
          // A reply with no sentence boundary at all still has to be spoken.
          if (!spoke) {
            setOrbState('speaking');
            spokenTextRef.current += ' ' + spokenFull;
            await speakOne(spokenFull);
          }
          // Hands the turn to ChatContainer: history for the next question,
          // plus persistence to Postgres and the text transcript.
          onTurnRef.current(text, spokenFull);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(`Erro: ${(err as Error).message}`);
        }
      } finally {
        // A newer turn (barge-in) already took over — its own finally owns
        // the reset from here; applying ours too would stomp its state.
        if (turnEpochRef.current === myEpoch) {
          busyRef.current = false;
          abortRef.current = null;
          if (!closedRef.current) {
            setOrbState('idle');
            setTranscript('');
          }
        }
      }
    },
    [playAudio, speakNative],
  );

  // Held in a ref so the startup effect below has only stable dependencies.
  const queryRef = useRef(handleVoiceQuery);
  useEffect(() => {
    queryRef.current = handleVoiceQuery;
  }, [handleVoiceQuery]);

  useEffect(() => {
    if (!SpeechRecognitionCtor) {
      setError('Navegador não suporta reconhecimento de voz. Use Chrome ou Edge.');
      return;
    }

    let cancelled = false;
    closedRef.current = false;
    hudSignal.overlayOpen = true;

    (async () => {
      try {
        // 1. Get mic access
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        // 2. AudioContext + analysers feeding the arc HUD
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const micAnalyser = makeAnalyser(ctx);
        ctx.createMediaStreamSource(stream).connect(micAnalyser);
        micAnalyserRef.current = micAnalyser;
        ttsAnalyserRef.current = makeAnalyser(ctx);

        // 3. Set up SpeechRecognition. Never stopped between turns — that's
        // what makes barge-in possible — so it has to keep running (and keep
        // restarting on its own ~60s timeout) through 'thinking'/'speaking' too.
        const recognition = setupRecognition(
          (e: SpeechRecognitionEvent) => {
            const last = e.results[e.results.length - 1];
            const text = last[0].transcript;
            if (!last.isFinal) {
              if (!busyRef.current) setTranscript(text);
              return;
            }
            const trimmed = text.trim();
            if (!trimmed) return;
            // While Jarvis is talking, the mic can hear its own voice —
            // discard results that look like that instead of treating them
            // as a barge-in or a new question.
            if (busyRef.current && isEcho(trimmed, spokenTextRef.current)) return;
            queryRef.current(trimmed);
          },
          (e: SpeechRecognitionErrorEvent) => {
            if (e.error === 'no-speech' || e.error === 'aborted') return;
            setError(`Erro de reconhecimento: ${e.error}`);
          },
          () => {
            if (!cancelled) {
              try { recognition.start(); } catch { /* already started */ }
            }
          },
        );
        recognitionRef.current = recognition;

        recognition.start();
        setOrbState('idle');
        rafRef.current = requestAnimationFrame(sampleAudio);
      } catch (err) {
        console.error('[VoiceMode] startup failed:', err);
        setError(
          err instanceof DOMException
            ? 'Permissão de microfone negada ou indisponível.'
            : 'Não foi possível iniciar o modo de voz.',
        );
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [sampleAudio, cleanup]);

  const handleClose = () => {
    cleanup();
    onClose();
  };

  if (!mounted) return null;

  const accent = `var(--hud-${STATE_ACCENT[orbState]})`;

  return createPortal(
    <div className="hud-theme hud-void-bg fixed inset-0 z-50 overflow-hidden msg-appear">
      {/* The arc HUD itself — same sphere as the home page, pulsing with the
          live audio via hudSignal. Page-level instances idle while this is up. */}
      <HudBackground variant="full" role="overlay" />

      {/* Status + transcript, bottom-anchored so the sphere stays clear */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-7 px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        {/* Radial vignette only behind the text, so the sphere is not dimmed */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[52vh]"
          style={{
            background:
              'radial-gradient(ellipse 80% 70% at 50% 100%, color-mix(in srgb, var(--bg-base) 88%, transparent) 0%, transparent 72%)',
          }}
          aria-hidden
        />

        {/* hud-panel's glass is what keeps the text readable over the sphere —
            judge it from a production build, it renders flat under dev. */}
        <div
          className={`hud-panel relative w-full max-w-lg rounded-[10px] px-10 py-5 text-center ${
            STATE_ACCENT[orbState] === 'gold' ? 'hud-panel-gold' : ''
          }`}
        >
          <HudCorners accent={STATE_ACCENT[orbState]} />
          <p
            className="font-hud text-[10px] uppercase tracking-[0.3em]"
            style={{ color: accent, textShadow: `0 0 10px ${accent}` }}
            aria-live="polite"
          >
            {STATE_LABEL[orbState]}
          </p>
          {error ? (
            <p className="mt-3 text-[15px] leading-relaxed" style={{ color: 'var(--hud-red)' }}>
              {error}
            </p>
          ) : transcript ? (
            <p className="mt-3 max-h-[26vh] overflow-y-auto whitespace-pre-line text-left text-[15px] leading-relaxed text-ink-2">
              {transcript}
            </p>
          ) : null}
        </div>

        {/* Tokens, not white/[0.07] — that was invisible on the light theme. */}
        <button
          onClick={handleClose}
          className="font-hud relative z-10 flex items-center gap-2.5 rounded-full px-7 py-3 text-[11px] uppercase tracking-[0.2em] text-ink-2 transition-all duration-150 hover:text-ink active:scale-95"
          style={{
            border: '0.5px solid color-mix(in srgb, var(--ink) 22%, transparent)',
            background: 'color-mix(in srgb, var(--bg-base) 70%, transparent)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <span
            className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
            style={{ background: 'var(--hud-red)', boxShadow: '0 0 8px var(--hud-red-soft)' }}
          />
          Encerrar
        </button>
      </div>
    </div>,
    document.body,
  );
}
