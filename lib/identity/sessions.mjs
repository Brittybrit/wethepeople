// Sessions: an opaque random id in an HttpOnly, Secure, SameSite=Lax cookie with the __Host- prefix.
// The server keeps only a SHA-256 hash of the id, with an expiry 30 days out that rolls forward on use.
// A session is revoked by deleting its row (sign out, account deletion). No JWT ever reaches the browser.
import { sha256 } from '../hash.mjs';
import { randomToken, safeEqual } from './google.mjs';

export const SESSION_COOKIE = '__Host-wtp305_session';
export const SESSION_DAYS = 30;
export const SESSION_MS = SESSION_DAYS * 86400 * 1000;
// Rolling expiry is written at most once a day per session, to keep writes cheap.
export const REFRESH_AFTER_MS = 86400 * 1000;

export const iso = ms => new Date(ms).toISOString();

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// __Host- cookies must be Secure, Path=/ and carry no Domain attribute.
export function setCookie(name, value, maxAgeSeconds) {
  return name + '=' + encodeURIComponent(value) + '; Path=/; Max-Age=' + Math.max(0, Math.floor(maxAgeSeconds)) + '; HttpOnly; Secure; SameSite=Lax';
}
export const clearCookie = name => name + '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';

export const hashSessionId = id => sha256('wtp305-session:' + id);

// Create a session for a user. Returns { cookie } (a Set-Cookie value). The raw id exists only in the cookie.
export async function startSession(store, userId, now = Date.now()) {
  const id = randomToken(32);
  await store.createSession({ idHash: await hashSessionId(id), userId, createdAt: iso(now), expiresAt: iso(now + SESSION_MS) });
  return { cookie: setCookie(SESSION_COOKIE, id, SESSION_MS / 1000) };
}

// Look up the session named by the request's cookie.
// Returns { userId, idHash, cookie? } where cookie is a refreshed Set-Cookie value when the expiry rolled, or null.
export async function currentSession(store, request, now = Date.now()) {
  const id = readCookie(request, SESSION_COOKIE);
  if (!id || id.length < 20 || id.length > 100) return null;
  const idHash = await hashSessionId(id);
  const s = await store.getSession(idHash);
  if (!s || !safeEqual(s.idHash, idHash)) return null;
  if (Date.parse(s.expiresAt) <= now) { await store.deleteSession(idHash); return null; }
  const out = { userId: s.userId, idHash };
  if (now - Date.parse(s.refreshedAt) >= REFRESH_AFTER_MS) {
    await store.refreshSession(idHash, { expiresAt: iso(now + SESSION_MS), at: iso(now) });
    out.cookie = setCookie(SESSION_COOKIE, id, SESSION_MS / 1000);
  }
  return out;
}

export async function endSession(store, request) {
  const id = readCookie(request, SESSION_COOKIE);
  if (id) await store.deleteSession(await hashSessionId(id));
  return clearCookie(SESSION_COOKIE);
}

// CSRF for state-changing requests: the cookie is SameSite=Lax, and the Origin header must be this site's origin.
// A request with no Origin header is refused (every current browser sends Origin on POST and DELETE).
export function sameOrigin(request, expectedOrigin) {
  const o = request.headers.get('Origin');
  return !!o && o === expectedOrigin;
}
