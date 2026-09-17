import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { getSession } from '@/lib/auth';

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY!,
});

// The voice overlay now sends one sentence at a time, but a single request
// must still be allowed to outlive the platform's 10-15s default.
export const maxDuration = 60;

/** One utterance, not a whole report — the client chunks before calling. */
const MAX_TEXT = 2000;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { text } = await req.json();
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Missing text' }, { status: 400 });
    }
    if (text.length > MAX_TEXT) {
      return NextResponse.json({ error: 'Text too long' }, { status: 400 });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: text,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
        },
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData?.data,
    );

    if (!part?.inlineData) {
      return NextResponse.json({ error: 'No audio in response' }, { status: 502 });
    }

    return NextResponse.json({
      audio: part.inlineData.data,
      mimeType: part.inlineData.mimeType ?? 'audio/L16;rate=24000',
    });
  } catch (err) {
    // Logged server-side only — the provider message used to be echoed to the
    // client and printed verbatim in the overlay.
    console.error('[tts] error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'TTS unavailable' }, { status: 500 });
  }
}
