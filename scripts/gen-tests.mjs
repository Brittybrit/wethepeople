#!/usr/bin/env node
// Generates a Jest-style test suite for a module: source (plus <module>.schema.json if present) in, tests/generated/<name>.test.mjs out.
// Skips when the module's content hash matches the header of the existing generated file. Never touches tests/hand/.
// Usage: node scripts/gen-tests.mjs lib/hash.mjs [lib/other.mjs ...]   (needs ANTHROPIC_API_KEY or OPENAI_API_KEY)
import fs from 'node:fs/promises';
import path from 'node:path';
import { createModel } from '../lib/model.mjs';
import { caches } from '../lib/cache.mjs';
import { tracer, sinks } from '../lib/events.mjs';
import { hashOf } from '../lib/hash.mjs';

const config = JSON.parse(await fs.readFile(new URL('../config/models.json', import.meta.url)));
const tr = tracer({ service: 'gen-tests', sink: sinks.jsonl('.cache/events.jsonl', fs), client: 'cli' });
await fs.mkdir('.cache', { recursive: true });
const model = createModel({ config, env: process.env, cache: caches.dir('.cache/model', fs), tracer: tr });

const SCHEMA = { type: 'object', required: ['tests'], properties: { tests: { type: 'string', minLength: 200 }, notes: { type: 'string' } }, additionalProperties: false };
const SYSTEM = `You write Vitest test suites (Jest syntax: describe, it, expect; import { describe, it, expect } from 'vitest').
Rules: import the module under test from the given relative path; cover the happy path, every branch, every thrown error, boundary values (empty, null, unicode, very long), and property-style cases for parsers and matchers (loop over generated inputs); test only observable behavior, never implementation details; no network, no filesystem, no timers unless faked; each test name says what is true, in plain words; keep the file under 250 lines; output the complete file as the "tests" string.`;

for (const file of process.argv.slice(2)) {
  const src = await fs.readFile(file, 'utf8');
  let schema = ''; try { schema = await fs.readFile(file.replace(/\.m?js$/, '.schema.json'), 'utf8'); } catch {}
  const name = path.basename(file).replace(/\.m?js$/, '');
  const out = path.join('tests/generated', name + '.test.mjs');
  const h = (await hashOf(src + schema)).slice(0, 16);
  try { const cur = await fs.readFile(out, 'utf8'); if (cur.startsWith('// generated:' + h)) { console.log('unchanged', out); continue; } } catch {}
  const rel = path.relative(path.dirname(out), file).replace(/\\/g, '/');
  const r = await model.complete({ task: 'test-gen', schema: SCHEMA, system: SYSTEM, prompt_version: 'test-gen-v1',
    input: `Module path to import: ${rel.startsWith('.') ? rel : './' + rel}\n\nSOURCE:\n${src}\n\n${schema ? 'JSON SCHEMAS the module must honor:\n' + schema : ''}` });
  const body = r.json.tests.replace(/^\/\/ generated:.*\n/, '');
  await fs.mkdir('tests/generated', { recursive: true });
  await fs.writeFile(out, `// generated:${h} by ${r.model} (${r.prompt_version}); regenerate with: node scripts/gen-tests.mjs ${file}\n// Hand-written cases belong in tests/hand/, which this script never touches.\n${body}`);
  console.log('wrote', out, r.cached ? '(cached)' : '$' + r.cost.toFixed(4));
}
await tr.flush();
