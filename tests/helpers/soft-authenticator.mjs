// A software passkey (ES256, "none" attestation) for tests. It builds the same JSON a browser sends, so the real
// @simplewebauthn/server verifies it. Web Crypto only: runs on Node and inside workerd.
import { b64url, b64urlDecode } from '../../lib/identity/google.mjs';

const enc = new TextEncoder();
const sha = async b => new Uint8Array(await crypto.subtle.digest('SHA-256', b));
const cat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { out.set(x, i); i += x.length; } return out; };

// Minimal CBOR encoder: unsigned/negative ints, byte strings, text strings, maps.
function head(major, n) {
  if (n < 24) return Uint8Array.of((major << 5) | n);
  if (n < 256) return Uint8Array.of((major << 5) | 24, n);
  if (n < 65536) return Uint8Array.of((major << 5) | 25, n >> 8, n & 255);
  return Uint8Array.of((major << 5) | 26, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}
function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (v instanceof Uint8Array) return cat(head(2, v.length), v);
  if (typeof v === 'string') { const b = enc.encode(v); return cat(head(3, b.length), b); }
  if (v instanceof Map) return cat(head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)]));
  throw new Error('cbor: unsupported');
}

// Web Crypto ECDSA gives r||s; WebAuthn wants DER.
function derInt(b) { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); if (b[0] & 0x80) b = cat(Uint8Array.of(0), b); return cat(Uint8Array.of(2, b.length), b); }
function toDer(raw) { const r = derInt(raw.slice(0, 32)), s = derInt(raw.slice(32)); return cat(Uint8Array.of(0x30, r.length + s.length), r, s); }

export async function softAuthenticator({ origin, rpID }) {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const credId = crypto.getRandomValues(new Uint8Array(16));
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, b64urlDecode(jwk.x)], [-3, b64urlDecode(jwk.y)]]));
  let counter = 0, userHandle = null;
  const rpHash = await sha(enc.encode(rpID));
  const ctr = n => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

  return {
    id: b64url(credId),
    // navigator.credentials.create() equivalent. Returns RegistrationResponseJSON.
    async create(options, { originOverride } = {}) {
      userHandle = options.user.id;
      const clientDataJSON = enc.encode(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: originOverride || origin, crossOrigin: false }));
      const flags = 0x01 | 0x04 | 0x40; // user present, user verified, attested credential data
      const authData = cat(rpHash, Uint8Array.of(flags), ctr(counter), new Uint8Array(16), Uint8Array.of(0, credId.length), credId, cose);
      const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      return { id: b64url(credId), rawId: b64url(credId), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject), transports: ['internal'] } };
    },
    // navigator.credentials.get() equivalent. Returns AuthenticationResponseJSON.
    async get(options, { originOverride, userHandleOverride } = {}) {
      counter += 1;
      const clientDataJSON = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: originOverride || origin, crossOrigin: false }));
      const authData = cat(rpHash, Uint8Array.of(0x01 | 0x04), ctr(counter));
      const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, cat(authData, await sha(clientDataJSON))));
      return { id: b64url(credId), rawId: b64url(credId), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), signature: b64url(toDer(sig)), userHandle: userHandleOverride ?? userHandle } };
    }
  };
}
