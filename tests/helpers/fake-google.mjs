// A fake Google for tests: a locally generated RSA key, a JWKS, ID tokens signed with it, and a fetch that answers
// the token and JWKS endpoints. Nothing reaches the network.
import { b64url, GOOGLE } from '../../lib/identity/google.mjs';

const enc = new TextEncoder();

export async function fakeGoogle({ clientId = 'test-client.apps.googleusercontent.com', kid = 'test-kid-1' } = {}) {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const jwks = { keys: [{ kty: 'RSA', kid, use: 'sig', alg: 'RS256', n: pub.n, e: pub.e }] };
  const calls = [];

  async function sign(claims, { header = {}, key = keys.privateKey } = {}) {
    const h = b64url(enc.encode(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT', ...header })));
    const p = b64url(enc.encode(JSON.stringify(claims)));
    const s = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(h + '.' + p)));
    return h + '.' + p + '.' + b64url(s);
  }
  const claims = (over = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return { iss: 'https://accounts.google.com', aud: clientId, sub: '1234567890', iat: now, exp: now + 3600, nonce: 'n', email: 'person@example.com', email_verified: true, ...over };
  };

  // What the token endpoint returns next: set by the test (an ID token or a status).
  let next = null;
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url) === GOOGLE.jwks) return new Response(JSON.stringify(jwks), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
    if (String(url) === GOOGLE.token) {
      if (!next) return new Response('{"error":"invalid_grant"}', { status: 400 });
      const body = new URLSearchParams(init.body);
      const r = await next(body);
      return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  };
  return { clientId, kid, keys, jwks, sign, claims, fetch, calls, onToken(fn) { next = fn; } };
}
