// Address -> coordinates -> Miami-Dade precinct.
// 1. Esri World Geocoder first: it places a matched house on its rooftop (score 90+, Florida, address-level match only).
// 2. U.S. Census geocoder as the fallback: free, no key, but it estimates along the street range and can land
//    across a precinct line, which is why it is second.
// 3. Coordinates -> precinct: the county's own precinct polygons (Miami-Dade GIS Precinct layer), point in polygon.
// The address passes through and is never logged, stored or cached. fetch is injected so this runs anywhere.

export const SOURCES = {
  esri: 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates',
  census: 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress',
  precinctLayer: 'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/Precinct_gdb/FeatureServer/0/query',
  precinctDataset: 'https://gis-mdc.opendata.arcgis.com/datasets/MDC::precinct'
};

// "123 Main St Miami" -> "123 Main St Miami, FL"
export function cleanAddress(s) {
  let a = String(s || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!a) return '';
  if (!/\b(fl|florida)\b/i.test(a)) a += ', FL';
  return a;
}

export function inMiamiDadeBox(lat, lng) {
  return isFinite(lat) && isFinite(lng) && lat >= 25.1 && lat <= 26.0 && lng >= -80.9 && lng <= -80.0;
}

export function parseEsri(j) {
  const c = ((j && j.candidates) || [])[0];
  const a = (c && c.attributes) || {};
  if (!c || !(c.score >= 90) || !c.location) return null;
  if (!/^(PointAddress|Subaddress|StreetAddress)$/.test(a.Addr_type || '') || a.Region !== 'Florida') return null;
  return { lat: Number(c.location.y), lng: Number(c.location.x), matched: c.address || '', geocoder: 'esri' };
}

export function parseCensus(j) {
  const m = (j && j.result && j.result.addressMatches) || [];
  const best = m[0];
  if (!best || !best.coordinates) return null;
  const st = best.addressComponents && best.addressComponents.state;
  if (st && String(st).toUpperCase() !== 'FL') return null;
  return { lat: Number(best.coordinates.y), lng: Number(best.coordinates.x), matched: best.matchedAddress || '', geocoder: 'census' };
}

// ArcGIS query -> whole precinct number as a string ("33"), or '' when the point is in no precinct.
export function parsePrecinctLayer(j) {
  const f = (j && j.features) || [];
  if (!f.length) return '';
  const at = f[0].attributes || {};
  const n = parseInt(at.ID != null ? at.ID : at.id, 10);
  return isFinite(n) ? String(n) : '';
}

// Whole precinct + the county's precinct list -> every code the voter might be in.
// ["033.0"] for most; ["116.0", "116.1"] where the county splits a precinct (only the voter's ballot tells them apart).
export function precinctCodes(whole, codes) {
  const n = parseInt(whole, 10);
  if (!isFinite(n)) return [];
  const pad = String(n).padStart(3, '0');
  return [...codes].filter(k => k.split('.')[0] === pad).sort();
}

// A precinct code as Ballot305 and the county write it: "033.0".
export function isPrecinctCode(s) { return /^\d{3}\.\d$/.test(String(s || '')); }

async function getJson(fetch, url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error('upstream HTTP ' + r.status);
  return r.json();
}

// Miami-Dade as a box (xmin, ymin, xmax, ymax) for Esri searchExtent; matches inMiamiDadeBox.
export const MIAMI_DADE_EXTENT = '-80.9,25.1,-80.0,26.0';
export const SUGGEST_URL = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest';

export function parseSuggest(j) {
  return ((j && j.suggestions) || [])
    .filter(s => s && s.text && s.magicKey && !s.isCollection)
    .map(s => ({ text: String(s.text).replace(/, USA$/, ''), magicKey: s.magicKey }))
    .slice(0, 6);
}

// Autocomplete: what someone has typed so far -> up to 6 Miami-Dade street addresses. Nothing is logged or stored.
export async function suggest(text, { fetch }) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (t.length < 3) return [];
  return parseSuggest(await getJson(fetch, SUGGEST_URL + '?f=json&category=Address&maxSuggestions=6&countryCode=USA&searchExtent=' + MIAMI_DADE_EXTENT + '&text=' + encodeURIComponent(t)));
}

// magicKey: from a chosen suggestion, so Esri resolves that exact address.
export async function geocode(address, { fetch, magicKey } = {}) {
  const a = cleanAddress(address);
  if (!a) return null;
  try {
    const e = parseEsri(await getJson(fetch, SOURCES.esri + '?f=json&maxLocations=1&forStorage=false&sourceCountry=USA&outFields=Region,Addr_type&SingleLine=' + encodeURIComponent(a) + (magicKey ? '&magicKey=' + encodeURIComponent(magicKey) : '')));
    if (e) return e;
  } catch { /* fall through to Census */ }
  return parseCensus(await getJson(fetch, SOURCES.census + '?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(a)));
}

export async function precinctAt(lat, lng, { fetch }) {
  if (!inMiamiDadeBox(lat, lng)) return '';
  return parsePrecinctLayer(await getJson(fetch, SOURCES.precinctLayer + '?f=json&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ID&returnGeometry=false&geometry=' + encodeURIComponent(lng + ',' + lat)));
}
