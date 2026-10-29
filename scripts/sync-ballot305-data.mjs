// Copies the data files the ledger API needs from a Ballot305 checkout (repo Brittybrit/vote-informed) into
// public/ledger-data/, and records where they came from in public/ledger-data/SOURCE.json.
//   node scripts/sync-ballot305-data.mjs [path-to-vote-informed]     (default ../vote-informed)
// Idempotent: a file is rewritten only when its bytes differ, files Ballot305 no longer has are removed, and
// SOURCE.json changes only when a data file changed (so a run with nothing new leaves the tree clean).
// Phase 1 of decisions/0008-ledger-moves-to-platform.md. Ballot305 is read, never written.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_FILES, LEDGER_BULK_ONLY_FILES, decisionsBodyFile } from '../lib/ledger/ledger.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LEDGER_DATA_DIR = join(ROOT, 'public', 'ledger-data');
// Cloudflare Workers static assets: 25 MiB per file (https://developers.cloudflare.com/workers/platform/limits/).
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

// The list of files to copy, relative to Ballot305's public/data/. decisions.json itself is never copied: it is
// over the per-file limit, and Ballot305 serves its split (decisions/index.json plus one file per body).
export function filesToCopy(srcData) {
  const index = JSON.parse(readFileSync(join(srcData, LEDGER_FILES.decisions), 'utf8'));
  const bodies = (index.bodies || []).map(b => decisionsBodyFile(b.key));
  return [...Object.values(LEDGER_FILES), ...bodies, ...LEDGER_BULK_ONLY_FILES];
}

function gitSha(dir) {
  try { return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base)); else out.push(p.slice(base.length + 1));
  }
  return out;
}

export function syncBallot305Data({ src, dest = LEDGER_DATA_DIR, now = () => new Date().toISOString() }) {
  const srcData = join(src, 'public', 'data');
  if (!existsSync(join(srcData, LEDGER_FILES.decisions))) throw new Error('Not a Ballot305 checkout (no public/data/' + LEDGER_FILES.decisions + '): ' + src);
  const wanted = filesToCopy(srcData);
  const changed = [], removed = [], files = {};
  for (const rel of wanted) {
    const from = join(srcData, rel);
    if (!existsSync(from)) throw new Error('Ballot305 checkout is missing public/data/' + rel);
    const size = statSync(from).size;
    if (size > MAX_ASSET_BYTES) throw new Error(rel + ' is ' + size + ' bytes, over the 25 MiB static asset limit; split it upstream first');
    const buf = readFileSync(from);
    JSON.parse(buf.toString('utf8')); // refuse to publish a broken file
    const to = join(dest, rel);
    const same = existsSync(to) && sha256(readFileSync(to)) === sha256(buf);
    if (!same) { mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, buf); changed.push(rel); }
    files[rel] = { bytes: buf.length, sha256: sha256(buf) };
  }
  const keep = new Set([...wanted, 'SOURCE.json']);
  for (const rel of listFiles(dest)) if (!keep.has(rel)) { unlinkSync(join(dest, rel)); removed.push(rel); }

  const sourcePath = join(dest, 'SOURCE.json');
  const prev = existsSync(sourcePath) ? JSON.parse(readFileSync(sourcePath, 'utf8')) : null;
  const commit = gitSha(src);
  if (changed.length || removed.length || !prev) {
    // commit is the Ballot305 commit the data was copied at; copiedAt is when. Both move only when the data does,
    // so an hourly run after a code-only Ballot305 commit produces no change here.
    const source = {
      note: 'Copy of Ballot305 public data (CC BY 4.0, attribution Ballot305, ballot305.org) served by the ledger API. Written by scripts/sync-ballot305-data.mjs; do not edit by hand.',
      repo: 'https://github.com/Brittybrit/vote-informed',
      path: 'public/data',
      commit,
      copiedAt: now(),
      license: 'CC BY 4.0',
      files
    };
    writeFileSync(sourcePath, JSON.stringify(source, null, 2) + '\n');
  }
  return { changed, removed, commit, total: wanted.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const src = resolve(process.argv[2] || join(ROOT, '..', 'vote-informed'));
  const r = syncBallot305Data({ src });
  console.log('ledger data from ' + src + ' @ ' + (r.commit || 'unknown commit') + ': ' + r.total + ' files, ' + r.changed.length + ' changed, ' + r.removed.length + ' removed');
}
