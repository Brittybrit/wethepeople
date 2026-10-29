// Source adapter: Ballot305's public read API (https://ballot305.org/api, CC BY 4.0).
// Until the data moves into this platform, We the People reads it here and nowhere else, so swapping the source
// later means changing this one file. fetch is injected; a Worker passes one that uses the edge cache.

export const BALLOT305 = {
  base: 'https://ballot305.org',
  license: 'CC BY 4.0',
  attribution: 'Ballot305 (ballot305.org)',
  docs: 'https://ballot305.org/api',
  methodology: 'https://ballot305.org/methodology'
};

export function ballot305Source({ fetch, base = BALLOT305.base }) {
  async function get(path) {
    const r = await fetch(base + path, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('ballot305 ' + path.split('?')[0] + ' HTTP ' + r.status);
    return r.json();
  }
  return {
    now: precinct => get('/api/v1/now?precinct=' + encodeURIComponent(precinct)),
    upcoming: precinct => get('/api/v1/upcoming?limit=200&precinct=' + encodeURIComponent(precinct)),
    // The county's precinct list (keys like "033.0"), used to expand a whole precinct into its split halves.
    precinctCodes: async () => Object.keys((await get('/data/precincts.json')).precincts || {})
  };
}
