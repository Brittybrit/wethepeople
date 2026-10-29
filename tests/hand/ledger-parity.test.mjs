import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { buildIndex, runLedger, BALLOT305_SITE, PLATFORM_SITE } from '../../lib/ledger/ledger.mjs';
import { readLedgerRaw } from '../../lib/ledger/load.mjs';
import { matchOperation, checkParams } from '../../lib/api-schema.mjs';

// Parity: Ballot305's own src/api.js and this platform's ledger, over the same data files, must return the same
// status and the same body for every endpoint. Ballot305 is imported from a checkout (BALLOT305_CHECKOUT, default
// ../vote-informed); the suite is skipped when there is none. Both read this repo's copy (public/ledger-data/), so a
// difference is a logic difference, not a data one. Ballot305 is never written to.
const CHECKOUT = resolve(process.env.BALLOT305_CHECKOUT || new URL('../../../vote-informed', import.meta.url).pathname);
const API_JS = resolve(CHECKOUT, 'src/api.js');
const DATA = new URL('../../public/ledger-data/', import.meta.url);
const ORIGIN = 'https://ballot305.org';

// A request sample for every endpoint Ballot305 serves, including filters, paging, path ids that need encoding and 404s.
const SAMPLE = [
  '/api/v1',
  '/api/v1/bodies', '/api/v1/bodies/county', '/api/v1/bodies/flsenate', '/api/v1/bodies/nope',
  '/api/v1/actions', '/api/v1/actions?body=county&split=1&tied=1', '/api/v1/actions?person=vicki-l-lopez&limit=7&offset=3',
  '/api/v1/actions?since=2025-01-01&until=2025-06-30&limit=500', '/api/v1/actions?party=kendall%20associates&tied=1',
  '/api/v1/actions?q=zoning&kind=vote', '/api/v1/actions?limit=9999', '/api/v1/actions?limit=-3&offset=-1',
  '/api/v1/ties', '/api/v1/ties?person=vicki-l-lopez&timing=before&limit=10&offset=5', '/api/v1/ties?match=party&minAmount=1000',
  '/api/v1/ties?donor=llc&since=2024-01-01&until=2024-12-31', '/api/v1/ties?body=flhouse&limit=500&offset=100',
  '/api/v1/people', '/api/v1/people?q=lopez&onBallot=1', '/api/v1/people?onBallot=1&limit=500', '/api/v1/people?q=zzzz',
  '/api/v1/people/vicki-l-lopez', '/api/v1/people/byron-donalds', '/api/v1/people/nope',
  '/api/v1/transparency',
  '/api/v1/cycles', '/api/v1/cycles/mdc-commission', '/api/v1/cycles/city-aventura', '/api/v1/cycles/nope',
  '/api/v1/now?precinct=033.0&date=2026-10-23', '/api/v1/now?precinct=33&date=2026-11-04', '/api/v1/now?precinct=101.0&date=2026-10-29',
  '/api/v1/now', '/api/v1/now?precinct=999.9',
  '/api/v1/upcoming', '/api/v1/upcoming?precinct=033.0', '/api/v1/upcoming?precinct=033.0&tagged=money', '/api/v1/upcoming?body=county&since=2026-10-01&until=2026-12-31&limit=20',
  '/api/v1/upcoming?tagged=lobbied,hearing',
  '/api/v1/contacts', '/api/v1/contacts/city-aventura-mayor', '/api/v1/contacts/nope',
  '/api/v1/procurement', '/api/v1/procurement/county', '/api/v1/procurement/mdc-commission', '/api/v1/procurement/nope',
  '/api/v1/payments', '/api/v1/payments/county', '/api/v1/payments/city-miami-beach', '/api/v1/payments/nope',
  '/api/v1/connections', '/api/v1/connections/byron-donalds', '/api/v1/connections/vicki-l-lopez',
  '/api/v1/bulk'
];

// Ballot305's index lives at /api/v1; here /api/v1 is the platform index and the ledger index is /api/v1/ledger.
const platformPath = p => (p === '/api/v1' ? '/api/v1/ledger' : p);

const ledgerGet = (data, site, path) => {
  const url = new URL(ORIGIN + platformPath(path));
  const hit = matchOperation(url.pathname.replace(/\/+$/, ''));
  if (!hit) return { status: 404, body: { error: 'Not found' } };
  const args = { ...Object.fromEntries(url.searchParams), ...hit.pathArgs };
  const bad = checkParams(hit.op, args);
  if (bad) return { status: 400, body: { error: bad } };
  const r = runLedger(hit.op.id, data, args, { origin: url.origin, site });
  return { status: r.status, body: r.body };
};

describe.skipIf(!existsSync(API_JS))('parity with Ballot305 src/api.js', () => {
  let ballot305Get, sameLabels, platformLabels;
  beforeAll(async () => {
    const { handleApi } = await import(pathToFileURL(API_JS).href);
    // Ballot305 reads /data/<file> through its ASSETS binding: serve it this repo's copy.
    const env = { ASSETS: { fetch: async req => {
      const rel = new URL(req.url).pathname.replace(/^\/data\//, '');
      const u = new URL(rel, DATA);
      return existsSync(u) ? new Response(readFileSync(u), { status: 200 }) : new Response('no', { status: 404 });
    } } };
    ballot305Get = async path => {
      const url = new URL(ORIGIN + path);
      const res = await handleApi(new Request(url), env, url);
      return { status: res.status, body: await res.json(), total: res.headers.get('X-Total-Count') };
    };
    const raw = await readLedgerRaw(async rel => { const u = new URL(rel, DATA); return existsSync(u) ? JSON.parse(readFileSync(u, 'utf8')) : null; });
    sameLabels = buildIndex(raw, { dataPath: BALLOT305_SITE.dataPath });
    platformLabels = buildIndex(raw);
  }, 120000);

  it('covers every Ballot305 endpoint except openapi.json', () => {
    const tops = new Set(SAMPLE.map(p => new URL(ORIGIN + p).pathname.split('/')[3] || '(index)'));
    expect([...tops].sort()).toEqual(['(index)', 'actions', 'bodies', 'bulk', 'connections', 'contacts', 'cycles', 'now', 'payments', 'people', 'procurement', 'ties', 'transparency', 'upcoming'].sort());
  });

  // Day-dependent fields (now without a date) are compared only on samples that pass one.
  it.each(SAMPLE)('same body and status as Ballot305 for %s', async path => {
    const want = await ballot305Get(path);
    const got = ledgerGet(sameLabels, BALLOT305_SITE, path);
    expect(got.status).toBe(want.status);
    expect(got.body).toEqual(want.body);
  });

  it.each(SAMPLE)('served from the platform, %s differs only in the data path and index labels', async path => {
    const want = await ballot305Get(path);
    const got = ledgerGet(platformLabels, PLATFORM_SITE, path);
    expect(got.status).toBe(want.status);
    const normalized = JSON.parse(JSON.stringify(got.body).replaceAll(PLATFORM_SITE.dataPath + '/', BALLOT305_SITE.dataPath + '/'));
    if (path === '/api/v1') {
      for (const k of ['name', 'docs', 'methodology']) { delete normalized[k]; delete want.body[k]; }
    }
    expect(normalized).toEqual(want.body);
  });
});
