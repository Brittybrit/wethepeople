import { describe, it, expect } from 'vitest';
import { verifyIdToken, jwksCache, pkcePair, pkceMatches, authorizationUrl, exchangeCode, safeEqual, b64url, GOOGLE } from '../../lib/identity/google.mjs';
import { fakeGoogle } from '../helpers/fake-google.mjs';

describe('Google ID token verification', async () => {
  const g = await fakeGoogle();
  const jwks = jwksCache({ fetch: g.fetch });
  const opts = { clientId: g.clientId, nonce: 'n', jwks };

  it('accepts a token signed by a key in the JWKS with the right iss, aud, exp and nonce', async () => {
    const out = await verifyIdToken(await g.sign(g.claims()), opts);
    expect(out).toEqual({ sub: '1234567890', email: 'person@example.com', email_verified: true });
  });
  it('accepts the bare issuer form Google also uses', async () => {
    expect((await verifyIdToken(await g.sign(g.claims({ iss: 'accounts.google.com' })), opts)).sub).toBe('1234567890');
  });
  it('rejects a bad signature, an unknown key and a wrong algorithm', async () => {
    const other = await fakeGoogle();
    await expect(verifyIdToken(await other.sign(g.claims()), opts)).rejects.toThrow(/signature/);
    await expect(verifyIdToken(await g.sign(g.claims(), { header: { kid: 'nope' } }), opts)).rejects.toThrow(/key unknown/);
    await expect(verifyIdToken(await g.sign(g.claims(), { header: { alg: 'none' } }), opts)).rejects.toThrow(/alg/);
    const t = await g.sign(g.claims());
    const [h, p] = t.split('.');
    const tampered = h + '.' + b64url(new TextEncoder().encode(JSON.stringify(g.claims({ sub: 'attacker' })))) + '.' + t.split('.')[2];
    await expect(verifyIdToken(tampered, opts)).rejects.toThrow(/signature/);
    await expect(verifyIdToken(h + '.' + p, opts)).rejects.toThrow(/malformed/);
  });
  it('checks issuer, audience, azp, expiry, issued-at and nonce', async () => {
    await expect(verifyIdToken(await g.sign(g.claims({ iss: 'https://evil.example' })), opts)).rejects.toThrow(/issuer/);
    await expect(verifyIdToken(await g.sign(g.claims({ aud: 'someone-else' })), opts)).rejects.toThrow(/audience/);
    await expect(verifyIdToken(await g.sign(g.claims({ aud: [g.clientId, 'x'], azp: 'x' })), opts)).rejects.toThrow(/azp/);
    await expect(verifyIdToken(await g.sign(g.claims({ exp: Math.floor(Date.now() / 1000) - 120 })), opts)).rejects.toThrow(/expired/);
    await expect(verifyIdToken(await g.sign(g.claims({ iat: Math.floor(Date.now() / 1000) + 600 })), opts)).rejects.toThrow(/future/);
    await expect(verifyIdToken(await g.sign(g.claims({ nonce: 'other' })), opts)).rejects.toThrow(/nonce/);
    await expect(verifyIdToken(await g.sign(g.claims({ nonce: undefined })), opts)).rejects.toThrow(/nonce/);
    await expect(verifyIdToken(await g.sign(g.claims()), { ...opts, nonce: '' })).rejects.toThrow(/nonce/);
    await expect(verifyIdToken(await g.sign(g.claims({ sub: '' })), opts)).rejects.toThrow(/subject/);
  });
});

describe('JWKS cache', () => {
  it('fetches once, reuses until stale, and refetches for an unknown kid at most once a minute', async () => {
    const g = await fakeGoogle();
    let t = 0;
    const cache = jwksCache({ fetch: g.fetch, now: () => t });
    expect(await cache.key(g.kid)).toBeTruthy();
    expect(await cache.key(g.kid)).toBeTruthy();
    expect(g.calls.filter(c => c.url === GOOGLE.jwks)).toHaveLength(1);
    expect(await cache.key('rotated')).toBeNull();          // within a minute of the last fetch: no refetch
    expect(g.calls.filter(c => c.url === GOOGLE.jwks)).toHaveLength(1);
    t = 61000;
    expect(await cache.key('rotated')).toBeNull();          // refetch allowed
    expect(g.calls.filter(c => c.url === GOOGLE.jwks)).toHaveLength(2);
    t = 3600 * 1000 + 62000;
    await cache.key(g.kid);                                 // max-age passed
    expect(g.calls.filter(c => c.url === GOOGLE.jwks)).toHaveLength(3);
  });
});

describe('PKCE, state and the authorization URL', () => {
  it('makes an S256 pair that matches, and a wrong verifier does not', async () => {
    const { verifier, challenge } = await pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(await pkceMatches(verifier, challenge)).toBe(true);
    expect(await pkceMatches(verifier + 'x', challenge)).toBe(false);
  });
  it('compares state in constant time and refuses non-strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
    expect(safeEqual(undefined, undefined)).toBe(false);
  });
  it('asks only for openid unless the person consents to sharing email', () => {
    const u = new URL(authorizationUrl({ clientId: 'c', redirectUri: 'https://wethepeople305.org/auth/google/callback', state: 's', nonce: 'n', codeChallenge: 'cc' }));
    expect(u.origin + u.pathname).toBe(GOOGLE.authorize);
    expect(u.searchParams.get('scope')).toBe('openid');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('response_type')).toBe('code');
    for (const k of ['state', 'nonce', 'code_challenge', 'redirect_uri', 'client_id']) expect(u.searchParams.get(k)).toBeTruthy();
    expect(new URL(authorizationUrl({ clientId: 'c', redirectUri: 'r', state: 's', nonce: 'n', codeChallenge: 'cc', wantEmail: true })).searchParams.get('scope')).toBe('openid email');
  });
  it('exchanges the code server side with the PKCE verifier and the secret', async () => {
    const g = await fakeGoogle();
    let seen;
    g.onToken(b => { seen = Object.fromEntries(b); return { id_token: 'tok' }; });
    expect(await exchangeCode({ code: 'c1', verifier: 'v1', clientId: 'id', clientSecret: 'sec', redirectUri: 'r', fetch: g.fetch })).toBe('tok');
    expect(seen).toMatchObject({ code: 'c1', code_verifier: 'v1', client_secret: 'sec', grant_type: 'authorization_code' });
    g.onToken(() => ({}));
    await expect(exchangeCode({ code: 'c', verifier: 'v', clientId: 'id', clientSecret: 's', redirectUri: 'r', fetch: g.fetch })).rejects.toThrow(/id_token/);
  });
});
