import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { getSession } from '@/lib/auth';
import { rateLimit, tooManyRequests } from '@/lib/rateLimit';

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY!,
});

const TTS_TEXT_MAX_CHARS = 1000;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = rateLimit(`tts:${session.id}`, 10, 10 * 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  try {
    const { text } = await req.json();
    if (!text || typeof text !== 'string' || text.length > TTS_TEXT_MAX_CHARS) {
      return NextResponse.json({ error: 'Missing or too-long text' }, { status: 400 });
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
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[tts] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
