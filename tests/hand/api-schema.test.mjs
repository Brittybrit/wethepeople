import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OPERATIONS, openApi, mcpTools, checkParams } from '../../lib/api-schema.mjs';
import { handleMcp, SUPPORTED_VERSIONS } from '../../lib/mcp.mjs';
import { yourArea } from '../../lib/your-area.mjs';

// Contract: the OpenAPI document and the MCP tools come from one schema and must describe the same operations.
describe('one schema, two outputs', () => {
  const spec = openApi('https://example.org');
  const tools = mcpTools();
  it('every operation is an HTTP path and an MCP tool with the same input', () => {
    for (const op of OPERATIONS) {
      const http = spec.paths[op.path][op.method.toLowerCase()];
      expect(http.operationId).toBe(op.id);
      const tool = tools.find(t => t.name === op.id);
      if (op.mcp === false) { expect(tool).toBeUndefined(); continue; }   // web-form helpers are HTTP only
      expect(tool).toBeTruthy();
      expect(http.parameters.map(p => p.name).sort()).toEqual(Object.keys(tool.inputSchema.properties).sort());
      expect(tool.outputSchema).toEqual(http.responses[200].content['application/json'].schema);
      expect(tool.annotations.readOnlyHint).toBe(true);
    }
  });
  it('is OpenAPI 3.1 with a server and unique operation ids', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.servers[0].url).toBe('https://example.org');
    const ids = OPERATIONS.map(o => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('flags the operation that carries personal data', () => {
    expect(spec.paths['/api/v1/precinct'].get['x-sends-personal-data']).toBe(true);
    expect(spec.paths['/api/v1/your-area'].get['x-sends-personal-data']).toBe(false);
  });
  it('a real your_area response has every required field the schema promises', () => {
    const now = JSON.parse(readFileSync(new URL('../fixtures/ballot305-now-033.0.json', import.meta.url)));
    const out = yourArea(now, { items: [] }, '2026-10-29');
    const op = OPERATIONS.find(o => o.id === 'your_area');
    for (const k of op.response.required) expect(out).toHaveProperty(k);
    for (const a of out.doNow) for (const k of op.response.properties.doNow.items.required) expect(a).toHaveProperty(k);
  });
});

describe('input checks', () => {
  const area = OPERATIONS.find(o => o.id === 'your_area');
  const pre = OPERATIONS.find(o => o.id === 'find_precinct');
  it('rejects missing and malformed input', () => {
    expect(checkParams(area, {})).toBe('Missing precinct');
    expect(checkParams(area, { precinct: '33' })).toMatch(/033\.0/);
    expect(checkParams(area, { precinct: '033.0' })).toBeNull();
    expect(checkParams(pre, { address: 'x' })).toMatch(/short/);
    expect(checkParams(pre, { address: 'a'.repeat(201) })).toMatch(/long/);
  });
});

describe('MCP', () => {
  const calls = [];
  const run = async (id, args) => { calls.push([id, args]); return id === 'your_area' ? { status: 200, body: { precinct: args.precinct } } : { status: 404, body: { error: 'Address not found.' } }; };
  it('initializes with a supported protocol version', async () => {
    const r = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, run);
    expect(r.body.result.protocolVersion).toBe('2025-03-26');
    expect(r.body.result.capabilities.tools).toBeTruthy();
    const r2 = await handleMcp({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, run);
    expect(r2.body.result.protocolVersion).toBe(SUPPORTED_VERSIONS[0]);
  });
  it('answers notifications with 202 and no body', async () => {
    expect(await handleMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, run)).toEqual({ status: 202, body: null });
  });
  it('lists tools and calls them through the shared handler', async () => {
    const list = await handleMcp({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, run);
    expect(list.body.result.tools.map(t => t.name)).toEqual(OPERATIONS.filter(o => o.mcp !== false).map(o => o.id));
    const ok = await handleMcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'your_area', arguments: { precinct: '033.0' } } }, run);
    expect(ok.body.result.isError).toBe(false);
    expect(ok.body.result.structuredContent).toEqual({ precinct: '033.0' });
  });
  it('returns tool errors as isError results, not protocol errors', async () => {
    const bad = await handleMcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'your_area', arguments: { precinct: 'x' } } }, run);
    expect(bad.body.result.isError).toBe(true);
    const nf = await handleMcp({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'find_precinct', arguments: { address: '1 Nowhere St' } } }, run);
    expect(nf.body.result.isError).toBe(true);
  });
  it('rejects unknown tools and methods with JSON-RPC errors', async () => {
    expect((await handleMcp({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'delete_everything' } }, run)).body.error.code).toBe(-32602);
    expect((await handleMcp({ jsonrpc: '2.0', id: 8, method: 'resources/list' }, run)).body.error.code).toBe(-32601);
    expect((await handleMcp({ id: 9 }, run)).body.error.code).toBe(-32600);
  });
  it('handles a batch', async () => {
    const r = await handleMcp([{ jsonrpc: '2.0', id: 10, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }], run);
    expect(r.body).toHaveLength(1);
  });
});
