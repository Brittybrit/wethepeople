// We the People 305 public Worker: wethepeople305.org.
//   GET /                          landing page
//   GET /your-area                 Your area page (public/your-area.html, served by the asset handler)
//   GET /api/v1/precinct?address=  street address -> Miami-Dade precinct code(s). The address passes through to the
//                                  geocoders and is never logged, stored or cached.
//   GET /api/v1/your-area?precinct=033.0
//                                  who serves this precinct, what is about to be decided, and what to do now
// The founder board is a separate private Worker on admin.wethepeople305.org and is not in this repo.
import { geocode, precinctAt, precinctCodes, isPrecinctCode, SOURCES } from '../lib/geo.mjs';
import { ballot305Source, BALLOT305 } from '../lib/sources/ballot305.mjs';
import { yourArea, todayIn } from '../lib/your-area.mjs';
import { tracer, sinks } from '../lib/events.mjs';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*' };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

// Upstream reads of public data go through the edge cache for 15 minutes; address lookups never do.
const cachedFetch = (url, init = {}) => fetch(url, { ...init, cf: { cacheTtl: 900, cacheEverything: true } });

async function handlePrecinct(url) {
  const address = url.searchParams.get('address') || '';
  if (!address.trim()) return json({ error: 'Missing address' }, 400);
  const noStore = { 'Cache-Control': 'no-store' };
  const hit = await geocode(address, { fetch });
  if (!hit) return json({ error: 'Address not found. Try the house number, street and city.' }, 404, noStore);
  const whole = await precinctAt(hit.lat, hit.lng, { fetch });
  if (!whole) return json({ error: 'That address is not in a Miami-Dade precinct.' }, 404, noStore);
  const codes = precinctCodes(whole, await ballot305Source({ fetch: cachedFetch }).precinctCodes());
  return json({
    precincts: codes,
    split: codes.length > 1,
    matchedAddress: hit.matched,
    note: codes.length > 1 ? 'The county splits this precinct. The precinct number on your ballot or voter card says which half you are in.' : null,
    sources: { geocoder: hit.geocoder === 'esri' ? SOURCES.esri : SOURCES.census, precincts: SOURCES.precinctDataset }
  }, 200, noStore);
}

async function handleYourArea(url, trace) {
  const precinct = url.searchParams.get('precinct') || '';
  if (!isPrecinctCode(precinct)) return json({ error: 'precinct must look like 033.0' }, 400);
  const src = ballot305Source({ fetch: cachedFetch });
  const [now, upcoming] = await trace.span('source.read', { task: 'ballot305.now+upcoming', precinct }, () => Promise.all([src.now(precinct), src.upcoming(precinct)]));
  if (!now || !Array.isArray(now.bodies) || !now.bodies.length) return json({ error: 'No data for precinct ' + precinct }, 404);
  const out = yourArea(now, upcoming, todayIn());
  out.source = { name: BALLOT305.attribution, license: BALLOT305.license, docs: BALLOT305.docs, methodology: BALLOT305.methodology };
  return json(out, 200, { 'Cache-Control': 'public, max-age=900' });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path.startsWith('/admin')) return json({ error: 'Not found' }, 404);
    if (path.startsWith('/api/')) {
      if (request.method === 'OPTIONS') return new Response(null, { headers: { ...JSON_HEADERS, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      // Events carry the precinct at most; never the address (lib/events.mjs refuses address-like fields).
      const trace = tracer({ service: 'wethepeople-public', sink: sinks.console(), client: 'web' });
      try {
        if (path === '/api/v1/precinct') return await handlePrecinct(url);
        if (path === '/api/v1/your-area') return await handleYourArea(url, trace);
        return json({ error: 'Not found' }, 404);
      } catch (e) {
        return json({ error: 'Upstream source unavailable. Try again in a minute.' }, 502);
      } finally {
        if (ctx && ctx.waitUntil) ctx.waitUntil(trace.flush()); else await trace.flush();
      }
    }
    return env.ASSETS.fetch(request);
  }
};
