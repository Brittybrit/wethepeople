import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { buildLlmsFull } from '../../scripts/build-llms.mjs';

describe('assistant-facing files', () => {
  it('llms-full.txt matches the docs (run pnpm build:llms)', async () => {
    expect(readFileSync(new URL('../../public/llms-full.txt', import.meta.url), 'utf8')).toBe(await buildLlmsFull());
  });
  it('every docs link in llms.txt points to a file that exists', () => {
    const txt = readFileSync(new URL('../../public/llms.txt', import.meta.url), 'utf8');
    for (const [, p] of txt.matchAll(/wethepeople305\.org\/docs\/([^)\s]+)/g)) expect(existsSync(new URL('../../public/docs/' + p, import.meta.url)), p).toBe(true);
  });
});
