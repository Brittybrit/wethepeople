// Validates data/decision-processes/ and writes data/decision-processes/index.json for the Worker to import.
// Usage: node scripts/build-decision-processes.mjs [--check]   (--check validates and fails if index.json is stale, writes nothing)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildIndex, validateDecisionData } from '../lib/decision-processes.mjs';

export const DIR = fileURLToPath(new URL('../data/decision-processes/', import.meta.url));
const INDEX = 'index.json';

export function readDecisionFiles(dir = DIR) {
  const read = f => JSON.parse(readFileSync(dir + f, 'utf8'));
  const templateFiles = readdirSync(dir + 'templates').filter(f => f.endsWith('.json')).sort().map(f => read('templates/' + f));
  const names = readdirSync(dir).filter(f => f.endsWith('.json') && f !== INDEX).sort();
  const bodyFiles = names.map(read);
  const bodyFileNames = Object.fromEntries(bodyFiles.map((b, i) => [b.key, names[i]]));
  const templateKinds = readdirSync(dir + 'templates').filter(f => f.endsWith('.json')).sort();
  return { templateFiles, bodyFiles, bodyFileNames, templateKinds };
}

export function buildDecisionProcesses(dir = DIR) {
  const { templateFiles, bodyFiles, bodyFileNames, templateKinds } = readDecisionFiles(dir);
  const errors = [];
  templateFiles.forEach((t, i) => { if (`${t.kind}.json` !== templateKinds[i]) errors.push(`templates/${templateKinds[i]}: kind "${t.kind}" does not match the file name`); });
  const seen = new Set();
  for (const b of bodyFiles) { if (seen.has(b.key)) errors.push(`body ${b.key}: duplicate key across files`); seen.add(b.key); }
  const seenT = new Set();
  for (const f of templateFiles) for (const v of f.variants) { if (seenT.has(v.key)) errors.push(`template ${v.key}: duplicate key across files`); seenT.add(v.key); }
  const index = buildIndex(templateFiles, bodyFiles);
  errors.push(...validateDecisionData(index, { bodyFileNames }));
  return { index, errors, json: JSON.stringify(index) + '\n' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { index, errors, json } = buildDecisionProcesses();
  if (errors.length) { console.error(errors.join('\n')); console.error(`${errors.length} problem(s); index.json not written.`); process.exit(1); }
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(DIR + INDEX, 'utf8'); } catch {}
    if (current !== json) { console.error('data/decision-processes/index.json is stale; run node scripts/build-decision-processes.mjs'); process.exit(1); }
    console.log('decision processes valid and index.json current');
  } else {
    writeFileSync(DIR + INDEX, json);
    console.log(`wrote data/decision-processes/index.json: ${Object.keys(index.templates).length} templates, ${Object.keys(index.bodies).length} bodies, ${(json.length / 1024).toFixed(0)} KB`);
  }
}
