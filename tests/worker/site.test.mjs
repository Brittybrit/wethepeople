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
});
