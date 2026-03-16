import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY!,
});

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Missing text' }, { status: 400 });
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
