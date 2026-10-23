#!/usr/bin/env node
// Prompt evals as tests. For each prompts/<name>.md with prompts/<name>.eval.json: run every case, check it, report
// pass rate and cost, fail if pass rate < floor or cost > ceiling_usd. Model outputs are cached by prompt version +
// input hash, so unchanged prompts cost nothing to re-run. Every run emits the same event shape as production.
// Usage: node scripts/eval.mjs [name ...]
import fs from 'node:fs/promises';
import path from 'node:path';
import { createModel, checkSchema } from '../lib/model.mjs';
import { caches } from '../lib/cache.mjs';
import { tracer, sinks } from '../lib/events.mjs';

const config = JSON.parse(await fs.readFile(new URL('../config/models.json', import.meta.url)));
await fs.mkdir('.cache', { recursive: true });
const tr = tracer({ service: 'eval', sink: sinks.jsonl('.cache/events.jsonl', fs), client: 'ci' });
const model = createModel({ config, env: process.env, cache: caches.dir('.cache/model', fs), tracer: tr });

const names = process.argv.slice(2).length ? process.argv.slice(2) : (await fs.readdir('prompts')).filter(f => f.endsWith('.eval.json')).map(f => f.replace('.eval.json', ''));
let failed = false;
for (const name of names) {
  const prompt = await fs.readFile(path.join('prompts', name + '.md'), 'utf8');
  const spec = JSON.parse(await fs.readFile(path.join('prompts', name + '.eval.json'), 'utf8'));
  const version = (prompt.match(/^version:\s*(\S+)/m) || [])[1] || 'v0';
  const task = (prompt.match(/^task:\s*(\S+)/m) || [])[1] || 'extract';
  const system = prompt.replace(/^(version|task|schema):.*$/mg, '').trim();
  let schema = null; const sm = prompt.match(/^schema:\s*(\S+)/m); if (sm) schema = JSON.parse(await fs.readFile(path.join('prompts', sm[1]), 'utf8'));
  let pass = 0, cost = 0; const fails = [];
  for (const c of spec.cases) {
    let r; try { r = await model.complete({ task, schema, system, input: typeof c.input === 'string' ? c.input : JSON.stringify(c.input), prompt_version: version }); } catch (e) { fails.push({ id: c.id, error: e.message }); continue; }
    cost += r.cost || 0;
    const errs = [];
    const e = c.expect || {};
    if (e.equals) for (const [k, v] of Object.entries(e.equals)) if (JSON.stringify(r.json?.[k]) !== JSON.stringify(v)) errs.push(k + ' = ' + JSON.stringify(r.json?.[k]) + ', expected ' + JSON.stringify(v));
    if (e.includes) for (const [k, v] of Object.entries(e.includes)) for (const x of [].concat(v)) if (!(r.json?.[k] || []).includes(x)) errs.push(k + ' missing ' + JSON.stringify(x));
    if (e.excludes) for (const [k, v] of Object.entries(e.excludes)) for (const x of [].concat(v)) if ((r.json?.[k] || []).includes(x)) errs.push(k + ' must not include ' + JSON.stringify(x));
    if (e.schema) { const se = checkSchema(r.json, e.schema); if (se) errs.push(se); }
    if (e.rubric) { // graded by a cheap model with a rubric; only for prose
      const g = await model.complete({ task: 'grade', schema: { type: 'object', required: ['pass', 'why'], properties: { pass: { type: 'boolean' }, why: { type: 'string' } } }, system: 'You grade an answer against a rubric. pass is true only if every rubric point is met.', input: 'RUBRIC:\n' + e.rubric + '\n\nANSWER:\n' + r.text, prompt_version: 'grade-v1' });
      cost += g.cost || 0; if (!g.json.pass) errs.push('rubric: ' + g.json.why);
    }
    if (errs.length) fails.push({ id: c.id, errs }); else pass++;
    tr.emit({ event: 'eval.case', task, tier: config.tasks[task]?.tier, cost: r.cost || 0, ok: !errs.length, props: { prompt: name, version, case: c.id, model: r.model, cached: !!r.cached } });
  }
  const rate = spec.cases.length ? pass / spec.cases.length : 0;
  const ok = rate >= (spec.floor ?? 1) && cost <= (spec.ceiling_usd ?? Infinity);
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${version}: ${pass}/${spec.cases.length} (floor ${spec.floor ?? 1}) cost $${cost.toFixed(4)} (ceiling $${spec.ceiling_usd ?? 'none'})`);
  for (const f of fails) console.log('   ', f.id, f.error || f.errs.join('; '));
}
await tr.flush();
process.exit(failed ? 1 : 0);
