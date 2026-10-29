// Google OpenID Connect: authorization code flow with PKCE, state and nonce; server-side code exchange;
// ID token signature checked against Google's JWKS (fetched and cached); iss, aud, exp and nonce checked.
// Plain JavaScript and Web Crypto only. `fetch` is injected so tests never touch the network.

export const GOOGLE = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  jwks: 'https://www.googleapis.com/oauth2/v3/certs',
  issuers: ['https://accounts.google.com', 'accounts.google.com']
};

const enc = new TextEncoder();

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
export function randomToken(bytes = 32) { return b64url(crypto.getRandomValues(new Uint8Array(bytes))); }

// Constant-time string comparison for state values and the like.
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// PKCE (RFC 7636), S256 only.
export async function pkcePair() {
  const verifier = randomToken(48);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
  return { verifier, challenge };
}
export async function pkceMatches(verifier, challenge) {
  return safeEqual(b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier)))), challenge);
}

// The URL the browser is sent to. Scope is "openid" alone unless the person ticked the box to save their Google email.
export function authorizationUrl({ clientId, redirectUri, state, nonce, codeChallenge, wantEmail }) {
  const p = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: wantEmail ? 'openid email' : 'openid',
    state, nonce, code_challenge: codeChallenge, code_challenge_method: 'S256',
    prompt: 'select_account'
  });
  return GOOGLE.authorize + '?' + p.toString();
}

// Server-side code exchange. Returns the raw ID token string, or throws.
export async function exchangeCode({ code, verifier, clientId, clientSecret, redirectUri, fetch }) {
  const r = await fetch(GOOGLE.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ code, code_verifier: verifier, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString()
  });
  if (!r.ok) throw new Error('token exchange failed: ' + r.status);
  const body = await r.json();
  if (!body || typeof body.id_token !== 'string') throw new Error('token response has no id_token');
  return body.id_token;
}

// JWKS cache: one per isolate. Refetched when stale or when a token names a key we do not have (at most once a minute).
export function jwksCache({ fetch, url = GOOGLE.jwks, now = () => Date.now() }) {
  let keys = null, expires = 0, lastFetch = -Infinity;
  async function load() {
    lastFetch = now();
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('JWKS fetch failed: ' + r.status);
    const body = await r.json();
    if (!body || !Array.isArray(body.keys)) throw new Error('JWKS has no keys');
    const m = /max-age=(\d+)/.exec(r.headers.get('Cache-Control') || '');
    keys = body.keys;
    expires = now() + (m ? Math.min(Number(m[1]), 86400) : 3600) * 1000;
  }
  return {
    async key(kid) {
      if (!keys || now() >= expires) await load();
      let k = keys.find(x => x.kid === kid);
      if (!k && now() - lastFetch > 60000) { await load(); k = keys.find(x => x.kid === kid); }
      return k || null;
    }
  };
}

function decodePart(part) { return JSON.parse(new TextDecoder().decode(b64urlDecode(part))); }

// Verify a Google ID token. Returns { sub, email, email_verified } or throws with a short reason.
export async function verifyIdToken(idToken, { clientId, nonce, jwks, now = () => Date.now(), skewSeconds = 60 }) {
  if (typeof idToken !== 'string') throw new Error('id token missing');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('id token malformed');
  let header, claims;
  try { header = decodePart(parts[0]); claims = decodePart(parts[1]); } catch { throw new Error('id token malformed'); }
  if (header.alg !== 'RS256') throw new Error('id token alg not allowed');
  const jwk = await jwks.key(header.kid);
  if (!jwk) throw new Error('id token key unknown');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('id token signature invalid');
  if (!GOOGLE.issuers.includes(claims.iss)) throw new Error('id token issuer wrong');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new Error('id token audience wrong');
  if (aud.length > 1 && claims.azp !== clientId) throw new Error('id token azp wrong');
  const t = Math.floor(now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + skewSeconds < t) throw new Error('id token expired');
  if (typeof claims.iat === 'number' && claims.iat - skewSeconds > t) throw new Error('id token issued in the future');
  if (!nonce || !safeEqual(String(claims.nonce || ''), nonce)) throw new Error('id token nonce wrong');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw new Error('id token subject missing');
  return { sub: claims.sub, email: typeof claims.email === 'string' ? claims.email : null, email_verified: claims.email_verified === true };
}
