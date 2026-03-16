/**
 * Returns a stable session ID for this browser tab.
 * Persists in sessionStorage so it survives page refreshes
 * but resets on new tabs (matching the original behavior).
 */
export function getSessionId(): string {
  const key = 'jarvis_session';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = 'j-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem(key, id);
  }
  return id;
}
