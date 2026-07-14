export function postJson(url: string, data: unknown, init?: { signal?: AbortSignal }): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: init?.signal,
  });
}

export function patchJson(url: string, data: unknown, init?: { signal?: AbortSignal }): Promise<Response> {
  return fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: init?.signal,
  });
}
