import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

// Runs inside the Workers runtime against the real wrangler.toml bindings (assets included).
describe('public site', () => {
  it('serves the holding page at the root', async () => {
    const r = await SELF.fetch('https://wethepeople305.org/');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('We the People 305');
  });
  it('serves the open docs and the index lists only public files', async () => {
    const idx = await (await SELF.fetch('https://wethepeople305.org/docs/index.json')).json();
    expect(idx.files.length).toBeGreaterThanOrEqual(2);
    expect(idx.files).not.toContain('product.md');
    expect(idx.files).not.toContain('founder-board.md');
    for (const f of idx.files) expect((await SELF.fetch('https://wethepeople305.org/docs/' + f)).status).toBe(200);
  });
  it('has no admin on this host', async () => {
    for (const p of ['/admin', '/admin/board.html', '/api/admin/board']) expect((await SELF.fetch('https://wethepeople305.org' + p)).status).toBe(404);
  });
  it('serves the Your area page', async () => {
    const r = await SELF.fetch('https://wethepeople305.org/your-area');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Who works for you');
  });
  it('validates API input before calling any source', async () => {
    expect((await SELF.fetch('https://wethepeople305.org/api/v1/your-area?precinct=33')).status).toBe(400);
    expect((await SELF.fetch('https://wethepeople305.org/api/v1/precinct')).status).toBe(400);
    expect((await SELF.fetch('https://wethepeople305.org/api/v1/nope')).status).toBe(404);
    expect((await SELF.fetch('https://wethepeople305.org/api/v1/your-area', { method: 'POST' })).status).toBe(405);
  });
  it('serves the API index and the generated OpenAPI document with a trace id', async () => {
    const r = await SELF.fetch('https://wethepeople305.org/api/v1');
    expect(r.status).toBe(200);
    expect(r.headers.get('X-Trace-Id')).toBeTruthy();
    const spec = await (await SELF.fetch('https://wethepeople305.org/api/v1/openapi.json')).json();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toContain('/api/v1/your-area');
  });
  it('speaks MCP at /mcp', async () => {
    const post = body => SELF.fetch('https://wethepeople305.org/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });
    const init = await (await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } })).json();
    expect(init.result.serverInfo.name).toBe('wethepeople305');
    expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    const list = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    const names = list.result.tools.map(t => t.name);
    expect(names.slice(0, 2)).toEqual(['find_precinct', 'your_area']);
    expect(names.filter(n => !n.startsWith('ledger_'))).toEqual(['find_precinct', 'your_area']);
    const bad = await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'your_area', arguments: { precinct: '33' } } })).json();
    expect(bad.result.isError).toBe(true);
    expect((await SELF.fetch('https://wethepeople305.org/mcp')).status).toBe(405);
  });
  it('serves the files assistants and crawlers look for', async () => {
    for (const p of ['/llms.txt', '/llms-full.txt', '/robots.txt', '/sitemap.xml', '/.well-known/security.txt']) expect((await SELF.fetch('https://wethepeople305.org' + p)).status, p).toBe(200);
  });
});
