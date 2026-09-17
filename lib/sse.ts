export type Send = (ev: object) => void;

/**
 * Wraps `work` in a `text/event-stream` response. Each `send(ev)` becomes one
 * `data: <json>` frame; a throw inside `work` is emitted as
 * `{ type: 'error', message }` before the stream closes, so the client always
 * gets a parseable body instead of a truncated one.
 */
export function sseResponse(work: (send: Send) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send: Send = (ev) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      try {
        await work(send);
      } catch (e) {
        try {
          send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
        } catch { /* controller may already be closed */ }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
