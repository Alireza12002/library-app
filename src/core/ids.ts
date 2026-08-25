/**
 * UUID helper — the single place the app generates identifiers.
 * Uses crypto.randomUUID (Hermes provides a compliant crypto.getRandomValues
 * since RN 0.75+); falls back to a v4-shaped random for safety.
 */
export function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }
  // RFC 4122 v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
