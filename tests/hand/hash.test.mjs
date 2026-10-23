import { describe, it, expect } from 'vitest';
import { sha256, stable, hashOf, newId } from '../../lib/hash.mjs';

describe('hashing', () => {
  it('hashes the same object the same way regardless of key order', async () => {
    expect(await hashOf({ b: 1, a: { d: 2, c: 3 } })).toBe(await hashOf({ a: { c: 3, d: 2 }, b: 1 }));
    expect(stable({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it('matches the known sha256 of an empty string and of unicode', async () => {
    expect(await sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256('Miamí')).toHaveLength(64);
  });
  it('ids are 24 hex chars and do not repeat', () => {
    const ids = new Set(Array.from({ length: 1000 }, newId));
    expect(ids.size).toBe(1000); for (const i of ids) expect(i).toMatch(/^[0-9a-f]{24}$/);
  });
});
