// Loads the ledger's data through an injected reader and builds the index. No I/O of its own.
// readJson(relativePath) -> parsed JSON, or null when the file is missing. The Worker passes a reader over the
// ASSETS binding (public/ledger-data/); Node passes one over the filesystem.
import { LEDGER_FILES, decisionsBodyFile, buildIndex, ledgerVersionKey } from './ledger.mjs';

// Reads every ledger file and joins decisions/index.json with each body's file into decisions.json's shape.
export async function readLedgerRaw(readJson) {
  const keys = Object.keys(LEDGER_FILES);
  const vals = await Promise.all(keys.map(k => readJson(LEDGER_FILES[k])));
  const raw = Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
  if (!raw.decisions || !raw.roster) throw new Error('ledger: decisions index or roster missing');
  const bodies = await Promise.all((raw.decisions.bodies || []).map(b => readJson(decisionsBodyFile(b.key))));
  if (bodies.some(b => !b)) throw new Error('ledger: a decisions body file is missing');
  raw.decisions = { ...raw.decisions, bodies };
  return raw;
}

// One loader per isolate or process. The data a deployed Worker version serves never changes (static assets are
// fixed per version), so the index is built once and reused; a failed build is retried on the next call.
// Concurrent first calls share one build.
export function createLedgerLoader(options = {}) {
  let pending = null;
  return function load(readJson) {
    if (!pending) {
      pending = readLedgerRaw(readJson).then(raw => ({ data: buildIndex(raw, options), version: ledgerVersionKey(raw) }));
      pending.catch(() => { pending = null; });
    }
    return pending.then(r => r.data);
  };
}
