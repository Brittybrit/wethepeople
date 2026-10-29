// Builds public/llms-full.txt: every public doc in public/docs/index.json order, in one file for assistants.
// `node scripts/build-llms.mjs` writes it; `--check` exits 1 if the committed file is stale (used by a test).
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../public/', import.meta.url);
export async function buildLlmsFull() {
  const idx = JSON.parse(await readFile(new URL('docs/index.json', root), 'utf8'));
  const parts = ['# We the People 305: full docs', '', 'Source: https://wethepeople305.org/docs/ (generated from public/docs/index.json; do not edit by hand).', ''];
  for (const f of idx.files) parts.push('---', 'File: https://wethepeople305.org/docs/' + f, '', (await readFile(new URL('docs/' + f, root), 'utf8')).trim(), '');
  return parts.join('\n');
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const text = await buildLlmsFull();
  const out = new URL('llms-full.txt', root);
  if (process.argv.includes('--check')) {
    const cur = await readFile(out, 'utf8').catch(() => '');
    if (cur !== text) { console.error('public/llms-full.txt is stale: run pnpm build:llms'); process.exit(1); }
  } else await writeFile(out, text);
}
