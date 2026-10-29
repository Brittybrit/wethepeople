// We the People 305 public Worker: wethepeople305.org.
//   GET  /                          landing page
//   GET  /your-area                 Your area page (public/your-area.html, served by the asset handler)
//   GET  /api/v1                    index of operations
//   GET  /api/v1/openapi.json       OpenAPI 3.1, generated from lib/api-schema.mjs
//   GET  /api/v1/precinct?address=  street address -> Miami-Dade precinct code(s); the address is never logged or stored
//   GET  /api/v1/your-area?precinct=033.0
//                                   who serves this precinct, what is about to be decided, and what to do now
//   POST /mcp                       MCP (Streamable HTTP, stateless): the same operations as tools
// Every API and MCP response carries X-Trace-Id. The founder board is a separate private Worker and is not in this repo.
import { geocode, precinctAt, precinctCodes, SOURCES } from '../lib/geo.mjs';
import { ballot305Source, BALLOT305 } from '../lib/sources/ballot305.mjs';
import { yourArea, todayIn } from '../lib/your-area.mjs';
import { tracer, sinks } from '../lib/events.mjs';
import { OPERATIONS, checkParams, openApi, API_VERSION } from '../lib/api-schema.mjs';
import { handleMcp } from '../lib/mcp.mjs';

const BASE_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Trace-Id' };
const json = (body, status, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extra } });

// Upstream reads of public data go through the edge cache for 15 minutes; address lookups never do.
const cachedFetch = (u, init = {}) => fetch(u, { ...init, cf: { cacheTtl: 900, cacheEverything: true } });

// Handlers return { status, body, cache } so the HTTP route and the MCP tool share them.
const HANDLERS = {
  async find_precinct({ address }) {
    const hit = await geocode(address, { fetch });
    if (!hit) return { status: 404, body: { error: 'Address not found. Try the house number, street and city in Miami-Dade.' } };
    const whole = await precinctAt(hit.lat, hit.lng, { fetch });
    if (!whole) return { status: 404, body: { error: 'That address is not in a Miami-Dade precinct.' } };
    const codes = precinctCodes(whole, await ballot305Source({ fetch: cachedFetch }).precinctCodes());
    return {
      status: 200, cache: 'no-store',
      body: {
        precincts: codes, split: codes.length > 1, matchedAddress: hit.matched,
        note: codes.length > 1 ? 'The county splits this precinct. The precinct number on your ballot or voter card says which half you are in.' : null,
        sources: { geocoder: hit.geocoder === 'esri' ? SOURCES.esri : SOURCES.census, precincts: SOURCES.precinctDataset }
      }
    };
  },
  async your_area({ precinct }, trace) {
    const src = ballot305Source({ fetch: cachedFetch });
    const [now, upcoming] = await trace.span('source.read', { task: 'ballot305.now+upcoming', precinct }, () => Promise.all([src.now(precinct), src.upcoming(precinct)]));
    if (!now || !Array.isArray(now.bodies) || !now.bodies.length) return { status: 404, body: { error: 'No data for precinct ' + precinct } };
    const out = yourArea(now, upcoming, todayIn());
    out.source = { name: BALLOT305.attribution, license: BALLOT305.license, docs: BALLOT305.docs, methodology: BALLOT305.methodology };
    return { status: 200, body: out, cache: 'public, max-age=900' };
  }
};

// Run one operation by id with validated input. Address-bearing calls never reach the event stream except as a route name.
async function run(id, args, trace, limit) {
  const op = OPERATIONS.find(o => o.id === id);
  const bad = checkParams(op, args);
  if (bad) return { status: 400, body: { error: bad } };
  if (op.sendsPersonalData && limit && !(await limit())) return { status: 429, body: { error: 'Too many address lookups. Try again in a minute.' } };
  try {
    return await HANDLERS[id](args, trace);
  } catch (e) {
    trace.emit({ event: 'operation.error', task: id, ok: false });
    return { status: 502, body: { error: 'Upstream source unavailable. Try again in a minute.' } };
  }
}

function apiIndex(origin) {
  return {
    name: 'We the People 305 API', version: API_VERSION,
    openapi: origin + '/api/v1/openapi.json', mcp: origin + '/mcp', docs: origin + '/docs/api.md', llms: origin + '/llms.txt',
    operations: OPERATIONS.map(o => ({ id: o.id, method: o.method, path: o.path, summary: o.summary }))
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path.startsWith('/admin')) return json({ error: 'Not found' }, 404);
    if (!path.startsWith('/api/') && path !== '/api' && path !== '/mcp') return env.ASSETS.fetch(request);

    // Events carry a route and at most a precinct; never an address (lib/events.mjs refuses address-like fields).
    // Rate limit for address lookups (wrangler.toml RATE_LIMIT_ADDRESS_LOOKUP). The IP is the key only; it is not logged.
    const limit = env.RATE_LIMIT_ADDRESS_LOOKUP ? async () => (await env.RATE_LIMIT_ADDRESS_LOOKUP.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' })).success : null;
    const trace = tracer({ service: 'wethepeople-public', sink: sinks.console(), client: path === '/mcp' ? 'mcp' : 'http' });
    const traced = r => { r.headers.set('X-Trace-Id', trace.trace_id); return r; };
    try {
      if (request.method === 'OPTIONS') return traced(new Response(null, { status: 204, headers: { ...BASE_HEADERS, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Protocol-Version', 'Access-Control-Max-Age': '86400' } }));

      if (path === '/mcp') {
        if (request.method !== 'POST') return traced(json({ error: 'POST JSON-RPC messages to /mcp' }, 405, { Allow: 'POST' }));
        let payload;
        try { payload = await request.json(); } catch { return traced(json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400)); }
        const { status, body } = await handleMcp(payload, (id, args) => run(id, args, trace, limit));
        return traced(body === null ? new Response(null, { status: 202, headers: BASE_HEADERS }) : json(body, status, { 'Cache-Control': 'no-store' }));
      }

      if (request.method !== 'GET') return traced(json({ error: 'Method not allowed' }, 405, { Allow: 'GET' }));
      if (path === '/api' || path === '/api/v1') return traced(json(apiIndex(url.origin), 200, { 'Cache-Control': 'public, max-age=300' }));
      if (path === '/api/v1/openapi.json') return traced(json(openApi(url.origin), 200, { 'Cache-Control': 'public, max-age=300' }));
      const op = OPERATIONS.find(o => o.path === path && o.method === 'GET');
      if (!op) return traced(json({ error: 'Not found' }, 404));
      const args = Object.fromEntries(Object.keys(op.params).map(k => [k, url.searchParams.get(k) ?? undefined]));
      const { status, body, cache } = await run(op.id, args, trace, limit);
      return traced(json(body, status, { 'Cache-Control': cache && status === 200 ? cache : 'no-store' }));
    } finally {
      if (ctx && ctx.waitUntil) ctx.waitUntil(trace.flush()); else await trace.flush();
    }
  }
};
