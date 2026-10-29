import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

// The ledger routes inside the Workers runtime, reading the real public/ledger-data/ through the ASSETS binding.
const get = (p, init) => SELF.fetch('https://wethepeople305.org' + p, init);

describe('ledger routes', () => {
  it('serves the ledger index and lists the ledger in the API index', async () => {
    const r = await get('/api/v1/ledger');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.version).toBe('1');
    expect(body.license.name).toBe('CC BY 4.0');
    expect(body.counts.actions).toBeGreaterThan(1000);
    expect(r.headers.get('X-Trace-Id')).toBeTruthy();
    const idx = await (await get('/api/v1')).json();
    expect(idx.operations.map(o => o.id)).toEqual(expect.arrayContaining(['ledger_people', 'ledger_actions', 'your_area']));
  });
  it('routes Ballot305 paths with path parameters, paging headers and CORS', async () => {
    const r = await get('/api/v1/ties?person=vicki-l-lopez&timing=before&limit=10&offset=5');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.items).toHaveLength(10);
    expect(r.headers.get('X-Total-Count')).toBe(String(body.total));
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(r.headers.get('Access-Control-Expose-Headers')).toMatch(/X-Total-Count/);
    expect(r.headers.get('X-Data-Updated')).toBeTruthy();
    expect(r.headers.get('Cache-Control')).toBe('public, max-age=300');
    const p = await (await get('/api/v1/people/vicki-l-lopez')).json();
    expect(p.name).toBe('Vicki L. Lopez');
    const one = (await (await get('/api/v1/actions?body=county&limit=1')).json()).items[0];
    const a = await get('/api/v1/actions/county/' + encodeURIComponent(one.id));
    expect((await a.json()).id).toBe(one.id);
    expect((await (await get('/api/v1/ties?limit=9999')).json()).limit).toBe(500);
  });
  it('answers If-None-Match with 304', async () => {
    const first = await get('/api/v1/bodies');
    const etag = first.headers.get('ETag');
    expect(etag).toMatch(/^"v1-/);
    const again = await get('/api/v1/bodies', { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
  });
  it('404s and 400s like Ballot305', async () => {
    for (const p of ['/api/v1/bodies/nope', '/api/v1/people/nope', '/api/v1/actions/county/nope', '/api/v1/cycles/nope', '/api/v1/contacts/nope', '/api/v1/procurement/nope', '/api/v1/payments/nope', '/api/v1/actions/county']) {
      const r = await get(p);
      expect(r.status, p).toBe(404);
      if (p !== '/api/v1/actions/county') expect(r.headers.get('Cache-Control')).toBe('no-store');
    }
    expect((await get('/api/v1/now')).status).toBe(400);
    expect((await get('/api/v1/now?precinct=033.0&date=2026-10-23')).status).toBe(200);
    expect((await get('/api/v1/bodies', { method: 'POST' })).status).toBe(405);
  });
  it('serves the bulk files it lists as static assets', async () => {
    const bulk = await (await get('/api/v1/bulk')).json();
    const f = bulk.files.find(x => x.path.endsWith('/decisions/index.json'));
    expect(f.path).toBe('https://wethepeople305.org/ledger-data/decisions/index.json');
    const r = await SELF.fetch(f.path);
    expect(r.status).toBe(200);
    expect((await get('/ledger-data/SOURCE.json')).status).toBe(200);
  });
  it('ledger operations are MCP tools, except bulk', async () => {
    const post = body => SELF.fetch('https://wethepeople305.org/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const list = await (await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).json();
    const names = list.result.tools.map(t => t.name);
    expect(names).toContain('ledger_person');
    expect(names).not.toContain('ledger_bulk');
    const call = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ledger_person', arguments: { id: 'vicki-l-lopez' } } })).json();
    expect(call.result.isError).toBe(false);
    expect(call.result.structuredContent.name).toBe('Vicki L. Lopez');
    const miss = await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ledger_person', arguments: { id: 'nope' } } })).json();
    expect(miss.result.isError).toBe(true);
  });
  it('OpenAPI lists the ledger paths with templates', async () => {
    const spec = await (await get('/api/v1/openapi.json')).json();
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/api/v1/people/{id}', '/api/v1/actions/{body}/{id}', '/api/v1/your-area']));
    expect(spec.paths['/api/v1/bulk'].get['x-mcp-tool']).toBeNull();
  });
});
