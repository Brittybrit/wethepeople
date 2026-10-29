// Wires the identity service (lib/identity/) to the Worker: the WebAuthn library, the D1 store, fetch and the
// Google JWKS cache. src/worker.js calls identityFetch for /auth/* and the account routes.
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { handleIdentity, isIdentityPath } from '../lib/identity/service.mjs';
import { storeFromEnv } from '../lib/identity/store.mjs';
import { jwksCache } from '../lib/identity/google.mjs';

const webauthn = { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse };
// One JWKS cache per isolate; Google's keys are refetched when Cache-Control says they are stale.
const jwks = jwksCache({ fetch: (u, i) => fetch(u, i) });

export { isIdentityPath };

export function identityFetch(request, env, ctx, trace) {
  return handleIdentity(request, env, {
    store: storeFromEnv(env),
    webauthn, jwks,
    fetch: (u, i) => fetch(u, i),
    // Events carry the route outcome only: never a name, email, Google subject, credential id or IP.
    emit: e => trace && trace.emit(e),
    waitUntil: ctx && ctx.waitUntil ? p => ctx.waitUntil(p) : null
  });
}
