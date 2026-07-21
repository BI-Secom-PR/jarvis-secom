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

export async function getLatestSession(): Promise<{ id: string; updatedAt: string } | null> {
  try {
    const res = await fetch('/api/chat-sessions');
    if (!res.ok) return null;
    const list = await res.json();
    return list[0] ?? null;
  } catch {
    return null;
  }
}

export async function getMessages(
  sessionId: string,
): Promise<Array<{ role: 'USER' | 'AI'; content: string; chartData: unknown }>> {
  try {
    const res = await fetch(`/api/chat-sessions/${sessionId}/messages`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
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
