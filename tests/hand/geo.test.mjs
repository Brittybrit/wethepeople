import { describe, it, expect } from 'vitest';
import { cleanAddress, parseEsri, parseCensus, parsePrecinctLayer, precinctCodes, isPrecinctCode, inMiamiDadeBox, geocode } from '../../lib/geo.mjs';

describe('geo', () => {
  it('adds the state when missing', () => {
    expect(cleanAddress(' 1 Main  St Miami ')).toBe('1 Main St Miami, FL');
    expect(cleanAddress('1 Main St, Miami FL')).toBe('1 Main St, Miami FL');
  });
  it('accepts only rooftop or street matches in Florida from Esri', () => {
    const c = (o) => ({ candidates: [{ score: 98, location: { x: -80.13, y: 25.79 }, address: 'A', attributes: { Addr_type: 'PointAddress', Region: 'Florida', ...o } }] });
    expect(parseEsri(c({}))).toMatchObject({ lat: 25.79, lng: -80.13, geocoder: 'esri' });
    expect(parseEsri(c({ Addr_type: 'Locality' }))).toBeNull();
    expect(parseEsri(c({ Region: 'Georgia' }))).toBeNull();
  });
  it('rejects Census matches outside Florida', () => {
    expect(parseCensus({ result: { addressMatches: [{ coordinates: { x: -84, y: 33 }, addressComponents: { state: 'GA' } }] } })).toBeNull();
  });
  it('reads the precinct layer', () => {
    expect(parsePrecinctLayer({ features: [{ attributes: { ID: 33 } }] })).toBe('33');
    expect(parsePrecinctLayer({ features: [] })).toBe('');
  });
  it('expands split precincts', () => {
    expect(precinctCodes('116', ['116.1', '116.0', '033.0'])).toEqual(['116.0', '116.1']);
    expect(precinctCodes('x', ['033.0'])).toEqual([]);
  });
  it('validates codes and the county box', () => {
    expect(isPrecinctCode('033.0')).toBe(true);
    expect(isPrecinctCode('33')).toBe(false);
    expect(inMiamiDadeBox(25.79, -80.13)).toBe(true);
    expect(inMiamiDadeBox(28.5, -81.4)).toBe(false);
  });
  it('falls back to Census when Esri has no good match', async () => {
    const calls = [];
    const fetch = async (u) => { calls.push(u); return new Response(JSON.stringify(u.includes('arcgis') ? { candidates: [] } : { result: { addressMatches: [{ coordinates: { x: -80.1, y: 25.8 }, matchedAddress: 'M' }] } })); };
    expect(await geocode('1 Main St', { fetch })).toMatchObject({ geocoder: 'census', matched: 'M' });
    expect(calls.length).toBe(2);
  });
});

import { parseSuggest, suggest } from '../../lib/geo.mjs';
describe('address suggestions', () => {
  it('drops collections, trims USA, caps at 6', () => {
    const s = Array.from({ length: 8 }, (_, i) => ({ text: i + ' Main St, Miami, FL, 33130, USA', magicKey: 'k' + i }));
    s.push({ text: 'Coffee shops', magicKey: 'c', isCollection: true });
    const out = parseSuggest({ suggestions: s });
    expect(out).toHaveLength(6);
    expect(out[0]).toEqual({ text: '0 Main St, Miami, FL, 33130', magicKey: 'k0' });
  });
  it('asks nothing for under 3 characters and fences the search to Miami-Dade', async () => {
    const calls = [];
    const fetch = async u => { calls.push(u); return new Response('{"suggestions":[]}'); };
    expect(await suggest('17', { fetch })).toEqual([]);
    expect(calls).toHaveLength(0);
    await suggest('1700 conv', { fetch });
    expect(calls[0]).toContain('searchExtent=-80.9,25.1,-80.0,26.0');
  });
});
