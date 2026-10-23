import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

test('public site: no board, no admin, docs listed exist', async () => {
  const { default: w } = await import('../src/worker.js');
  const served = [];
  const env = { ASSETS: { fetch: async req => { served.push(new URL(req.url).pathname); return new Response('ok'); } } };
  let r = await w.fetch(new Request('https://wethepeople305.org/'), env);
  assert.equal(served[0], '/');
  for (const p of ['/admin', '/admin/board.html', '/api/admin/board']) { r = await w.fetch(new Request('https://wethepeople305.org' + p), env); assert.equal(r.status, 404, p); }
  const idx = JSON.parse(readFileSync(new URL('../public/docs/index.json', import.meta.url)));
  for (const f of idx.files) assert.ok(existsSync(new URL('../public/docs/' + f, import.meta.url)), f);
  assert.ok(!idx.files.includes('founder-board.md'));
  assert.ok(!existsSync(new URL('../public/admin', import.meta.url)));
  const src = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /boardChat|ADMIN_TOKEN|BOARD_KEY/);
});
