// Content hashing, same on Workers, Node, Bun, Deno and browsers (Web Crypto only).
export async function sha256(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Stable JSON: keys sorted at every level so the same object always hashes the same.
export function stable(obj) {
  return JSON.stringify(obj, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v);
}
export async function hashOf(obj) { return sha256(typeof obj === 'string' ? obj : stable(obj)); }
export function newId() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}
