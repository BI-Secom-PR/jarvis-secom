'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ModelId } from '@/lib/agent';

type OrbState = 'connecting' | 'idle' | 'listening' | 'responding';

const STATE_LABEL: Record<OrbState, string> = {
  connecting: 'Conectando…',
  idle: 'Ouvindo…',
  listening: 'Ouvindo…',
  responding: 'Respondendo…',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const SpeechRecognitionCtor: (new () => SpeechRecognition) | null =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null
    : null;
/* eslint-enable @typescript-eslint/no-explicit-any */

function setupAudio(stream: MediaStream): { ctx: AudioContext; analyser: AnalyserNode } {
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  const source = ctx.createMediaStreamSource(stream);
  source.connect(analyser);
  return { ctx, analyser };
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
}

export default function VoiceMode({ onClose, model }: Props) {
  const [mounted, setMounted] = useState(false);
  const [orbState, setOrbState] = useState<OrbState>('connecting');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');

  const orbCoreRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const rafRef = useRef<number>(0);
  const orbStateRef = useRef<OrbState>('connecting');
  const busyRef = useRef(false);
  orbStateRef.current = orbState;

  useEffect(() => setMounted(true), []);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    recognitionRef.current?.abort();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
  }, []);

  const animateOrb = useCallback(() => {
    if (micAnalyserRef.current && orbCoreRef.current) {
      const data = new Uint8Array(micAnalyserRef.current.frequencyBinCount);
      micAnalyserRef.current.getByteFrequencyData(data);
      const avg = data.reduce((s, v) => s + v, 0) / data.length;
      const amplitude = Math.min(avg / 80, 1);

      if (orbStateRef.current !== 'responding') {
        if (amplitude > 0.15) setOrbState('listening');
        else if (orbStateRef.current === 'listening') setOrbState('idle');
      }

      const scale = 1 + amplitude * 0.35;
      const glow = Math.round(50 + amplitude * 90);
      orbCoreRef.current.style.transform = `scale(${scale.toFixed(3)})`;
      orbCoreRef.current.style.boxShadow = [
        `0 0 ${glow}px rgba(41,151,255,0.6)`,
        `0 0 ${glow * 2}px rgba(41,151,255,0.3)`,
        `0 0 ${glow * 3}px rgba(80,40,200,0.15)`,
      ].join(', ');
    }
    rafRef.current = requestAnimationFrame(animateOrb);
  }, []);

  // Decode base64 PCM (16-bit signed LE) to Float32Array
  const decodePcm16 = (base64: string, sampleRate: number): AudioBuffer => {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const i16 = new Int16Array(bytes.buffer);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
    const ctx = audioCtxRef.current!;
    const buf = ctx.createBuffer(1, f32.length, sampleRate);
    buf.copyToChannel(f32, 0);
    return buf;
  };

  const playAudio = useCallback(
    (base64: string, mimeType: string): Promise<void> => {
      const ctx = audioCtxRef.current;
      if (!ctx) return Promise.resolve();

      // Parse sample rate from mimeType like "audio/L16;rate=24000"
      const rateMatch = mimeType.match(/rate=(\d+)/);
      const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;

      const buf = decodePcm16(base64, sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();

      return new Promise((resolve) => {
        src.onended = () => resolve();
      });
    },
    [],
  );

  const handleVoiceQuery = useCallback(
    async (text: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setOrbState('responding');
      recognitionRef.current?.stop();

      try {
        // 1. Send to existing chat API
        const chatRes = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatInput: text, model }),
        });
        const chatData = await chatRes.json();
        if (!chatRes.ok) throw new Error(chatData.error ?? `HTTP ${chatRes.status}`);

        const output: string = chatData.output ?? '';
        setTranscript(output);

        // 2. Get TTS audio
        const ttsRes = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: output }),
        });
        const ttsData = await ttsRes.json();

        if (ttsRes.ok && ttsData.audio) {
          await playAudio(ttsData.audio, ttsData.mimeType ?? 'audio/L16;rate=24000');
        }
      } catch (err) {
        setError(`Erro: ${(err as Error).message}`);
      } finally {
        busyRef.current = false;
        setOrbState('idle');
        setTranscript('');
        // Restart listening
        try {
          recognitionRef.current?.start();
        } catch {
          /* already started */
        }
      }
    },
    [model, playAudio],
  );

  useEffect(() => {
    if (!SpeechRecognitionCtor) {
      setError('Navegador não suporta reconhecimento de voz. Use Chrome ou Edge.');
      return;
    }

    let cancelled = false;

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

        // 2. Set up AudioContext + AnalyserNode for orb animation
        const { ctx, analyser } = setupAudio(stream);
        audioCtxRef.current = ctx;
        micAnalyserRef.current = analyser;

        // 3. Set up SpeechRecognition
        const recognition = setupRecognition(
          (e: SpeechRecognitionEvent) => {
            const last = e.results[e.results.length - 1];
            const text = last[0].transcript;
            setTranscript(text);
            if (last.isFinal && text.trim()) handleVoiceQuery(text.trim());
          },
          (e: SpeechRecognitionErrorEvent) => {
            if (e.error === 'no-speech' || e.error === 'aborted') return;
            setError(`Erro de reconhecimento: ${e.error}`);
          },
          () => {
            if (!cancelled && !busyRef.current) {
              try { recognition.start(); } catch { /* already started */ }
            }
          },
        );
        recognitionRef.current = recognition;

        recognition.start();
        setOrbState('idle');
        rafRef.current = requestAnimationFrame(animateOrb);
      } catch {
        setError('Permissão de microfone negada ou indisponível.');
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [animateOrb, cleanup, handleVoiceQuery]);

  const handleClose = () => {
    cleanup();
    onClose();
  };

  const isSpeaking = orbState === 'listening' || orbState === 'responding';
  const orbAnimClass = orbState === 'responding' ? 'animate-orb-respond' : 'animate-orb-breathe';

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center msg-appear"
      style={{ background: 'rgba(3,3,12,0.96)', backdropFilter: 'blur(28px)' }}
    >
      {/* Orb area */}
      <div className="relative flex items-center justify-center mb-12" style={{ width: 260, height: 260 }}>
        {/* Ripple rings — shown while speaking */}
        {isSpeaking && (
          <>
            <div
              className="absolute inset-0 rounded-full animate-orb-ripple"
              style={{ background: 'rgba(41,151,255,0.1)' }}
            />
            <div
              className="absolute inset-0 rounded-full animate-orb-ripple"
              style={{ background: 'rgba(41,151,255,0.07)', animationDelay: '0.5s' }}
            />
            <div
              className="absolute inset-0 rounded-full animate-orb-ripple"
              style={{ background: 'rgba(41,151,255,0.04)', animationDelay: '1s' }}
            />
          </>
        )}

        {/* Core orb */}
        <div
          ref={orbCoreRef}
          className={`w-48 h-48 rounded-full ${orbAnimClass}`}
          style={{
            background:
              'radial-gradient(circle at 38% 32%, rgba(155,205,255,0.95) 0%, rgba(41,151,255,0.88) 38%, rgba(55,30,150,0.75) 72%, rgba(20,10,60,0.6) 100%)',
            boxShadow:
              '0 0 60px rgba(41,151,255,0.5), 0 0 120px rgba(41,151,255,0.25), 0 0 200px rgba(80,40,200,0.15)',
            transition: 'box-shadow 80ms ease-out',
          }}
        />
      </div>

      {/* Status label + transcript */}
      <div className="text-center mb-12 px-10 max-w-xs">
        <p
          className="text-[11px] text-white/35 mb-3 uppercase tracking-[0.12em]"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {STATE_LABEL[orbState]}
        </p>
        {error ? (
          <p className="text-[15px] text-red-400/75 leading-relaxed">{error}</p>
        ) : transcript ? (
          <p className="text-[16px] text-white/75 leading-relaxed">{transcript}</p>
        ) : null}
      </div>

      {/* End button */}
      <button
        onClick={handleClose}
        className="flex items-center gap-2.5 px-7 py-3 rounded-full border-[0.5px] border-white/[0.16] bg-white/[0.07] text-white/65 text-[14px] font-medium tracking-[-0.1px] hover:bg-white/[0.12] hover:text-white/90 active:scale-95 transition-all duration-150"
      >
        <span className="w-2 h-2 rounded-full bg-red-400/90 inline-block flex-shrink-0" />
        Encerrar
      </button>
    </div>,
    document.body,
  );
}
