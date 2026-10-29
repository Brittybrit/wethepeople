import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { buildIndex, runLedger, cycleNow, normPrecinct, ledgerEtag, MAX_LIMIT } from '../../lib/ledger/ledger.mjs';
import { readLedgerRaw, createLedgerLoader } from '../../lib/ledger/load.mjs';
import { OPERATIONS, matchOperation, mcpTools, checkParams } from '../../lib/api-schema.mjs';

// The ledger over the committed copy of Ballot305's data (public/ledger-data/). Ported from Ballot305's
// tests/api.test.mjs; HTTP-only cases (CORS, OPTIONS, 304) are in tests/worker/ledger.test.mjs.
const DATA = new URL('../../public/ledger-data/', import.meta.url);
const readJson = async rel => { const u = new URL(rel, DATA); return existsSync(u) ? JSON.parse(readFileSync(u, 'utf8')) : null; };

// Same entry point the Worker uses: resolve the path to an operation, then run it.
let data, raw;
const get = path => {
  const url = new URL('https://wethepeople305.org' + path);
  const hit = matchOperation(url.pathname.replace(/\/+$/, ''));
  if (!hit) return { status: 404, body: { error: 'Not found' } };
  const args = { ...Object.fromEntries(url.searchParams), ...hit.pathArgs };
  const bad = checkParams(hit.op, args);
  if (bad) return { status: 400, body: { error: bad } };
  return runLedger(hit.op.id, data, args, { origin: url.origin });
};

beforeAll(async () => {
  raw = await readLedgerRaw(readJson);
  data = buildIndex(raw);
});

describe('ledger data', () => {
  it('every action and tie is reachable and normalized', () => {
    const expected = raw.decisions.bodies.reduce((n, b) => n + b.actions.length, 0);
    expect(data.actions.length).toBe(expected);
    const gifts = raw.decisions.bodies.reduce((n, b) => n + b.actions.reduce((m, a) => m + (a.gifts || []).length, 0), 0);
    expect(data.ties.length).toBe(gifts);
    for (const t of data.ties) {
      expect(['before', 'after', 'same', 'unknown']).toContain(t.timing);
      expect(t.match).toBeTruthy();
      if (t.timing === 'before') expect(t.days).toBeLessThan(0);
      if (t.timing === 'after') expect(t.days).toBeGreaterThan(0);
    }
    const county = data.actions.find(a => a.body === 'county');
    expect(Object.keys(county.roll)).toContain('vicki-l-lopez');
  });
  it('every action carries provenance: the data file it came from and its date', () => {
    const a = data.actions.find(x => x.body === 'county');
    expect(a.source).toEqual({ file: '/ledger-data/decisions/county.json', updated: data.updated });
    expect(existsSync(new URL('decisions/county.json', DATA))).toBe(true);
  });
  it('SOURCE.json names the Ballot305 commit and copy time', async () => {
    const src = await readJson('SOURCE.json');
    expect(src.repo).toBe('https://github.com/Brittybrit/vote-informed');
    expect(src.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Date.parse(src.copiedAt)).not.toBeNaN();
    expect(src.files['decisions/index.json'].sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('the loader builds once and shares the result', async () => {
    let reads = 0;
    const load = createLedgerLoader();
    const counting = rel => { reads++; return readJson(rel); };
    const [a, b] = await Promise.all([load(counting), load(counting)]);
    const n = reads;
    expect(a).toBe(b);
    expect(await load(counting)).toBe(a);
    expect(reads).toBe(n);
  });
});

describe('ledger operations', () => {
  it('index lists counts, license and endpoints', () => {
    const { status, body } = get('/api/v1/ledger');
    expect(status).toBe(200);
    expect(body.version).toBe('1');
    expect(body.license.name).toBe('CC BY 4.0');
    expect(body.counts.actions).toBeGreaterThan(1000);
    expect(body.counts.ties).toBeGreaterThan(1000);
    expect(body.endpoints.openapi.endsWith('/api/v1/openapi.json')).toBe(true);
  });
  it('split and tied filters agree with the data', () => {
    const split = get('/api/v1/actions?body=county&split=1&limit=500').body;
    expect(split.total).toBeGreaterThanOrEqual(10);
    expect(split.total).toBeLessThan(500);
    for (const a of split.items) expect(a.split).toBe(true);
    const calusa = get('/api/v1/actions?party=kendall%20associates&tied=1').body;
    expect(calusa.total).toBeGreaterThanOrEqual(1);
    const a = calusa.items[0];
    expect(a.split).toBe(true);
    expect(a.ties.some(t => t.timing === 'before' && t.person === 'vicki-l-lopez')).toBe(true);
  });
  it('single action, person, body and 404s', () => {
    const one = get('/api/v1/actions?body=county&limit=1').body.items[0];
    const r = get('/api/v1/actions/county/' + encodeURIComponent(one.id));
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(one.id);
    const p = get('/api/v1/people/vicki-l-lopez').body;
    expect(p.name).toBe('Vicki L. Lopez');
    expect(p.onBallot).toBe(true);
    expect(p.terms.length).toBeGreaterThanOrEqual(1);
    expect(p.actions.length).toBeGreaterThanOrEqual(50);
    expect(p.ties.length).toBeGreaterThanOrEqual(50);
    expect(p.summary && p.summary.total).toBeGreaterThan(0);
    const b = get('/api/v1/bodies/county').body;
    expect(b.key).toBe('county');
    expect(b.members.filter(m => m.former !== true).length).toBe(13);
    for (const path of ['/api/v1/bodies/nope', '/api/v1/people/nope', '/api/v1/actions/county/nope', '/api/v1/whatever', '/api/v1/cycles/nope', '/api/v1/contacts/nope', '/api/v1/procurement/nope', '/api/v1/payments/nope']) {
      expect(get(path).status, path).toBe(404);
    }
  });
  it('ties filters, paging and totals', () => {
    const r = get('/api/v1/ties?person=vicki-l-lopez&timing=before&limit=10&offset=5');
    expect(r.total).toBe(r.body.total);
    expect(r.body.items.length).toBe(10);
    for (const t of r.body.items) { expect(t.person).toBe('vicki-l-lopez'); expect(t.timing).toBe('before'); }
    for (const t of get('/api/v1/ties?minAmount=25000').body.items) expect(t.amount).toBeGreaterThanOrEqual(25000);
    expect(get('/api/v1/ties?limit=9999').body.limit).toBe(MAX_LIMIT);
    expect(get('/api/v1/ties').body.limit).toBe(100);
    expect(get('/api/v1/actions?limit=0').body.limit).toBe(100);
  });
  it('people search, transparency, bulk', () => {
    expect(get('/api/v1/people?q=lopez&onBallot=1').body.items.some(p => p.id === 'vicki-l-lopez')).toBe(true);
    expect(get('/api/v1/transparency').body.cities.length).toBeGreaterThanOrEqual(18);
    const bulk = get('/api/v1/bulk').body;
    expect(bulk.files.some(f => f.path.endsWith('/ledger-data/decisions/index.json'))).toBe(true);
    expect(bulk.files.some(f => f.path.endsWith('/ledger-data/decisions/county.json'))).toBe(true);
    expect(bulk.files.some(f => f.path.endsWith('/decisions.json'))).toBe(false);
  });
  it('bulk links resolve to files in the copy (except the CSV Ballot305 lists but does not publish)', () => {
    for (const f of get('/api/v1/bulk').body.files) {
      const rel = f.path.split('/ledger-data/')[1];
      if (rel.endsWith('.csv')) continue;
      expect(existsSync(new URL(rel, DATA)), rel).toBe(true);
    }
  });
  it('now: one precinct gives my offices, holders, candidates and a cycle block where researched', () => {
    const r = get('/api/v1/now?precinct=033.0&date=2026-10-23');
    expect(r.status).toBe(200);
    expect(r.body.precinct).toBe('033.0');
    expect(r.body.districts.countyCommission).toBe(5);
    const county = r.body.bodies.find(b => b.body === 'mdc-commission');
    expect(county.seats.length).toBe(1);
    expect(county.seats[0].holders[0].person).toBe('vicki-l-lopez');
    expect(county.seats[0].onBallot[0].candidates.some(c => c.incumbent)).toBe(true);
    const city = r.body.bodies.find(b => b.level === 'municipal');
    expect(city.body).toBe('city-miami-beach');
    expect(city.seats.length).toBeGreaterThanOrEqual(5);
    for (const b of r.body.bodies) if (b.cycle) {
      expect(Array.isArray(b.cycle.levers)).toBe(true);
      for (const m of b.cycle.meetings.next) expect(m.date >= '2026-10-23').toBe(true);
    }
    expect(get('/api/v1/now?precinct=33&date=2026-10-23').body.precinct).toBe('033.0');
    expect(get('/api/v1/now').status).toBe(400);
    expect(get('/api/v1/now?precinct=999.9').status).toBe(404);
  });
  it('cycleNow: yearly phases wrap the year and next meetings are in the future', () => {
    const c = { key: 't', phases: [
      { key: 'budget-hearings', start: '2026-09-01', end: '2026-09-30', repeats: 'yearly', source: 'x' },
      { key: 'recess', start: '2026-12-15', end: '2027-01-10', repeats: 'yearly', source: 'x' },
      { key: 'election', start: '2026-11-03', end: '2026-11-03', repeats: 'once', source: 'x' }
    ], meetings: { schedule: [{ date: '2026-10-01', kind: 'regular', source: 'x' }, { date: '2026-11-04', kind: 'special', source: 'x' }, { date: '2026-11-05', kind: 'regular', source: 'x' }] }, levers: [{ key: 'public-comment', source: 'x' }] };
    expect(cycleNow(c, '2027-09-15').phases.current.map(p => p.key)).toEqual(['budget-hearings']);
    expect(cycleNow(c, '2027-01-05').phases.current.map(p => p.key)).toEqual(['recess']);
    const oct = cycleNow(c, '2026-10-23');
    expect(oct.meetings.next.map(m => m.date)).toEqual(['2026-11-04', '2026-11-05']);
    expect(oct.phases.upcoming[0].key).toBe('election');
    expect(oct.levers[0].nextMeeting).toBe('2026-11-05');
  });
  it('connections: only confirmed rows are public and every one cites a record', () => {
    const { body } = get('/api/v1/connections');
    for (const c of body.confirmed) {
      expect(c.record && (c.record.url || c.record.note)).toBeTruthy();
      expect(c.relationship).toBeTruthy();
    }
    expect(typeof body.underReview).toBe('object');
    expect(typeof get('/api/v1/people/vicki-l-lopez').body.connections.underReview).toBe('number');
    const one = get('/api/v1/connections/vicki-l-lopez').body;
    expect(one.person).toBe('vicki-l-lopez');
    expect(typeof one.underReview).toBe('number');
  });
  it('procurement, payments, contacts and cycles by body', () => {
    expect(get('/api/v1/procurement').body.bodies.length).toBeGreaterThanOrEqual(1);
    expect(get('/api/v1/procurement/county').body.rosterBody).toBe('mdc-commission');
    expect(get('/api/v1/payments/mdc-commission').body.body).toBe('county');
    expect(get('/api/v1/contacts').body.offices).toBeGreaterThan(10);
    expect(get('/api/v1/contacts/city-aventura-mayor').status).toBe(200);
    expect(get('/api/v1/cycles/mdc-commission').body.rosterBody).toBe('mdc-commission');
  });
  it('upcoming: precinct filter adds relevance; paging applies', () => {
    const r = get('/api/v1/upcoming?precinct=033.0&limit=5').body;
    expect(r.limit).toBe(5);
    for (const it of r.items) {
      expect(['mdc-commission', 'mdcps-board', 'city-miami-beach']).toContain(it.rosterBody);
      expect(it.relevance).toBeTruthy();
    }
  });
  it('normPrecinct and the ETag recipe match Ballot305', () => {
    expect(normPrecinct('33')).toBe('033.0');
    expect(normPrecinct('033.1')).toBe('033.1');
    expect(normPrecinct('x')).toBe('');
    expect(ledgerEtag(data, '/api/v1/bodies', '')).toMatch(/^"v1-[0-9a-f]+"$/);
  });
});

describe('ledger schema', () => {
  const ledgerOps = OPERATIONS.filter(o => o.ledger);
  it('every ledger operation is read-only GET with a handler, and bulk is not an MCP tool', async () => {
    const { LEDGER_OPERATIONS } = await import('../../lib/ledger/ledger.mjs');
    expect(ledgerOps.map(o => o.id).sort()).toEqual(Object.keys(LEDGER_OPERATIONS).sort());
    for (const o of ledgerOps) { expect(o.method).toBe('GET'); expect(o.sendsPersonalData).toBe(false); expect(o.id).toMatch(/^ledger_/); }
    const names = mcpTools().map(t => t.name);
    expect(names).not.toContain('ledger_bulk');
    for (const id of ['ledger_people', 'ledger_person', 'ledger_actions', 'ledger_ties', 'ledger_bodies', 'ledger_upcoming', 'ledger_cycles', 'ledger_procurement', 'ledger_payments', 'ledger_connections', 'ledger_transparency', 'ledger_contacts']) expect(names).toContain(id);
  });
  it('the existing operations are unchanged and still matched first', () => {
    expect(matchOperation('/api/v1/your-area').op.id).toBe('your_area');
    expect(matchOperation('/api/v1/precinct').op.id).toBe('find_precinct');
    expect(matchOperation('/api/v1/people/')).toBeNull();
    expect(matchOperation('/api/v1/actions/county/a%2Fb').pathArgs).toEqual({ body: 'county', id: 'a/b' });
  });
  it('every paged list keeps Ballot305\'s limit and offset parameters', () => {
    for (const id of ['ledger_actions', 'ledger_ties', 'ledger_people', 'ledger_upcoming']) {
      const op = OPERATIONS.find(o => o.id === id);
      expect(Object.keys(op.params)).toEqual(expect.arrayContaining(['limit', 'offset']));
    }
  });
});
