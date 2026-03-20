import { postJson, patchJson } from './fetchUtils';

export async function createSession(title: string): Promise<string | null> {
  try {
    const res = await postJson('/api/chat-sessions', { title });
    if (!res.ok) return null;
    const s = await res.json();
    return s.id as string;
  } catch {
    return null;
  }
}

export async function saveMessage(
  sessionId: string,
  role: 'USER' | 'AI',
  content: string,
  chartData?: unknown,
): Promise<void> {
  await postJson(`/api/chat-sessions/${sessionId}/messages`, {
    role,
    content,
    chartData: chartData ?? null,
  });
}

export async function updateSessionTitle(sessionId: string, title: string): Promise<void> {
  await patchJson(`/api/chat-sessions/${sessionId}`, { title });
}
