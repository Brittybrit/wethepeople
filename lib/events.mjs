// Events, traces and decision records. One shape everywhere; sinks are adapters.
// Privacy by construction: the shape has no field for an address, a name, a ballot pick, an email or an IP.
import { newId, hashOf } from './hash.mjs';

export const EVENT_FIELDS = ['ts', 'event', 'service', 'tier', 'task', 'cost', 'latency_ms', 'ok', 'precinct', 'body', 'item', 'key_tier', 'client', 'trace_id', 'span_id', 'parent_id', 'props'];
const FORBIDDEN = /address|email|name|ballot|ip\b|phone|street/i;

export function cleanEvent(e) {
  const out = {};
  for (const k of EVENT_FIELDS) if (e[k] !== undefined) out[k] = e[k];
  out.ts = out.ts || new Date().toISOString();
  if (!out.event) throw new Error('event name required');
  if (out.props && typeof out.props === 'object') {
    for (const k of Object.keys(out.props)) if (FORBIDDEN.test(k)) throw new Error('event prop not allowed: ' + k);
  }
  return out;
}

// Sinks. Each is { write(rows: object[]) }.
export const sinks = {
  memory() { const rows = []; return { rows, async write(r) { rows.push(...r); } }; },
  console() { return { async write(r) { for (const x of r) console.log(JSON.stringify(x)); } }; },
  jsonl(path, fs) { return { async write(r) { await fs.appendFile(path, r.map(x => JSON.stringify(x)).join('\n') + '\n'); } }; },
  // Cloudflare Analytics Engine binding: blobs for strings, doubles for numbers, index for the event name.
  analyticsEngine(binding) {
    return { async write(r) { for (const e of r) binding.writeDataPoint({ indexes: [e.event], blobs: [e.service || '', e.task || '', e.body || '', e.item || '', e.precinct || '', e.client || '', e.trace_id || '', e.key_tier || '', JSON.stringify(e.props || {})], doubles: [e.tier ?? -1, e.cost ?? 0, e.latency_ms ?? 0, e.ok === false ? 0 : 1] }); } };
  }
};

// A tracer bound to one request. emit() for events, span() for timed work, decide() for decision records.
export function tracer({ service, sink, client, key_tier, trace_id } = {}) {
  const trace = trace_id || newId();
  const buffer = [];
  const base = { service, client, key_tier, trace_id: trace };
  const t = {
    trace_id: trace,
    emit(e) { buffer.push(cleanEvent({ ...base, ...e })); },
    async span(name, fields, fn) {
      const span_id = newId(), t0 = Date.now();
      try { const out = await fn({ span_id }); t.emit({ ...fields, event: name, span_id, latency_ms: Date.now() - t0, ok: true }); return out; }
      catch (err) { t.emit({ ...fields, event: name, span_id, latency_ms: Date.now() - t0, ok: false, props: { ...(fields.props || {}), error: String(err.message || err).slice(0, 200) } }); throw err; }
    },
    // A decision: what was chosen, from what, at what confidence. Returns the decision id for later outcome joins.
    async decide({ kind, inputs, candidates, chosen, tier, model, prompt_version, confidence, rationale, span_id, body, item }) {
      const decision_id = newId();
      t.emit({ event: 'decision', span_id, tier, body, item, props: { decision_id, kind, inputs_hash: await hashOf(inputs ?? ''), candidates: (candidates || []).slice(0, 20), chosen, model, prompt_version, confidence, rationale_hash: await hashOf(rationale ?? '') } });
      return decision_id;
    },
    outcome({ decision_id, outcome, source }) { t.emit({ event: 'outcome', props: { decision_id, outcome, source } }); },
    async flush() { const rows = buffer.splice(0); if (rows.length && sink) await sink.write(rows); return rows; }
  };
  return t;
}
