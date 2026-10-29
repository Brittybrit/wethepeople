// Passkeys in the browser, written against the WebAuthn API directly (no library, no CDN).
// The server (lib/identity/service.mjs, @simplewebauthn/server) sends options as JSON with base64url fields;
// this file turns them into ArrayBuffers, runs the ceremony, and sends the result back as JSON.
(function () {
  'use strict';
  function toBuf(s) {
    var b = s.replace(/-/g, '+').replace(/_/g, '/');
    b += '='.repeat((4 - b.length % 4) % 4);
    var bin = atob(b), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  function toB64url(buf) {
    var bytes = new Uint8Array(buf), s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function post(path, body) {
    var r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body || {}) });
    var data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    if (!r.ok) { var err = new Error((data && data.error) || ('Request failed (' + r.status + ')')); err.status = r.status; throw err; }
    return data;
  }
  function supported() { return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create); }
  function friendly(e) {
    if (e && e.name === 'NotAllowedError') return 'The passkey prompt was closed or timed out. Try again when you are ready.';
    if (e && e.name === 'InvalidStateError') return 'This device already has a passkey for this account.';
    return (e && e.message) || 'Something went wrong. Try again.';
  }

  // Create an account (signed out) or add a passkey to the signed-in account.
  async function register(displayName) {
    var start = await post('/auth/passkey/register/options', { displayName: displayName || null });
    var o = start.options;
    var publicKey = {
      rp: o.rp, challenge: toBuf(o.challenge),
      user: { id: toBuf(o.user.id), name: o.user.name, displayName: o.user.displayName },
      pubKeyCredParams: o.pubKeyCredParams, timeout: o.timeout, attestation: o.attestation,
      authenticatorSelection: o.authenticatorSelection, extensions: o.extensions,
      excludeCredentials: (o.excludeCredentials || []).map(function (c) { return { type: 'public-key', id: toBuf(c.id), transports: c.transports }; })
    };
    if (o.hints) publicKey.hints = o.hints;
    var cred = await navigator.credentials.create({ publicKey: publicKey });
    var resp = cred.response;
    var json = {
      id: cred.id, rawId: toB64url(cred.rawId), type: cred.type,
      clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
      authenticatorAttachment: cred.authenticatorAttachment || undefined,
      response: {
        clientDataJSON: toB64url(resp.clientDataJSON),
        attestationObject: toB64url(resp.attestationObject),
        transports: resp.getTransports ? resp.getTransports() : []
      }
    };
    return post('/auth/passkey/register/verify', { flowId: start.flowId, response: json });
  }

  // Sign in with any passkey for this site (discoverable credentials; no username needed).
  async function login() {
    var start = await post('/auth/passkey/login/options', {});
    var o = start.options;
    var cred = await navigator.credentials.get({ publicKey: {
      challenge: toBuf(o.challenge), rpId: o.rpId, timeout: o.timeout, userVerification: o.userVerification,
      allowCredentials: (o.allowCredentials || []).map(function (c) { return { type: 'public-key', id: toBuf(c.id), transports: c.transports }; })
    } });
    var resp = cred.response;
    var json = {
      id: cred.id, rawId: toB64url(cred.rawId), type: cred.type,
      clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
      authenticatorAttachment: cred.authenticatorAttachment || undefined,
      response: {
        clientDataJSON: toB64url(resp.clientDataJSON),
        authenticatorData: toB64url(resp.authenticatorData),
        signature: toB64url(resp.signature),
        userHandle: resp.userHandle ? toB64url(resp.userHandle) : undefined
      }
    };
    return post('/auth/passkey/login/verify', { flowId: start.flowId, response: json });
  }

  window.WTPPasskey = { supported: supported, register: register, login: login, post: post, friendly: friendly };
})();
