// Decision chains for one precinct: each upcoming decision broken into its milestones (inputs, actor, output, legal
// basis, what a resident can do), with where the chain stands today. Pure; reads data/decision-processes/index.json.
import { allChains, nextLeveragePoint, span, daysBetween } from './decision-processes.mjs';

const firstSpan = s => (s.instances || []).map(i => ({ sp: span(i), i })).filter(x => x.sp).sort((a, b) => a.sp.from.localeCompare(b.sp.from))[0] || null;

// Each step's inputs with where the record can be had: on this site, online, or by records request.
// links: { [decisionBodyKey]: { agendas, home, records } } from the precinct's bodies (cycle links and body contacts).
export function inputsDetail(inputs, catalog, bodyLinks) {
  if (!catalog) return null;
  const byKey = new Map(catalog.items.map(i => [i.key, i]));
  return (inputs || []).map(name => {
    const it = byKey.get(catalog.map[name]);
    if (!it) return { name, status: 'unknown' };
    const l = bodyLinks || {};
    const url = it.status === 'records-request' ? (l.records || null)
      : it.source === 'agenda-system' ? (l.agendas || it.url || null)
      : it.source === 'body-website' ? (l.home || it.url || null)
      : (it.url || null);
    return { name, record: it.key, status: it.status, where: it.where, url, ...(it.format ? { format: it.format } : {}) };
  });
}

function stepView(s, today, catalog, bodyLinks) {
  const f = firstSpan(s);
  const when = f ? f.sp : null;
  const status = !when ? 'undated' : when.to < today ? 'done' : when.from <= today ? 'now' : 'ahead';
  return {
    step: s.step, of: s.of, key: s.key, name: s.name, actor: s.actor, inputs: s.inputs, output: s.output,
    ...(catalog ? { inputsDetail: inputsDetail(s.inputs, catalog, bodyLinks) } : {}),
    timing: s.timing && s.timing.rule, legalBasis: s.legalBasis, residentCan: s.residentCan,
    influence: s.influence, influenceWhy: s.influenceWhy, ...(s.appliesWhen ? { appliesWhen: s.appliesWhen } : {}),
    when, status, dateBasis: f ? f.i.dateBasis : 'unknown', ...(f && f.i.estimated ? { estimated: true } : {}),
    ...(f && f.i.source ? { source: f.i.source } : {}), ...(f && f.i.note ? { note: f.i.note } : {})
  };
}

// Dated decisions with a step still ahead within the horizon, soonest next step first; plus each body's undated
// processes (how an ordinance passes, how a contract is awarded) as plain chains.
export function decisionChains(bodyKeys, today, data, { horizonDays = 400, catalog = null, links = {} } = {}) {
  const chains = [], processes = [];
  for (const c of allChains(bodyKeys, data)) {
    const steps = c.steps.map(s => stepView(s, today, catalog, links[c.body.key]));
    const head = { body: c.body, decision: { key: c.decision.key, kind: c.decision.kind, name: c.decision.name, ...(c.decision.cycle ? { cycle: c.decision.cycle } : {}) } };
    if (c.decision.processOnly) { processes.push({ ...head, steps: steps.map(({ when, status, dateBasis, ...rest }) => rest) }); continue; }
    const next = steps.find(s => s.status === 'now') || steps.find(s => s.status === 'ahead');
    if (!next || daysBetween(today, next.when.from) > horizonDays) continue;
    chains.push({ ...head, next: { step: next.step, of: next.of, name: next.name, when: next.when, status: next.status }, steps });
  }
  chains.sort((a, b) => a.next.when.from.localeCompare(b.next.when.from));
  return { decisionChains: chains, processes, nextLeveragePoint: nextLeveragePoint(bodyKeys, today, data) };
}

// Where to read or request each decision body's records, from the precinct's "now" bodies.
export function bodyLinks(nowBodies) {
  const out = {};
  for (const b of nowBodies || []) {
    const k = b.cycle && b.cycle.key;
    if (!k) continue;
    const links = b.cycle.links || {}, c = b.bodyContact || {};
    out[k] = { agendas: links.agendas || null, home: links.home || null, records: c.recordsRequestUrl || null };
  }
  return out;
}

// The decision bodies (data/decision-processes keys) behind a precinct's "now" bodies.
export function decisionBodyKeys(nowBodies, data) {
  const keys = new Set();
  for (const b of nowBodies || []) if (b.cycle && b.cycle.key && data.bodies && data.bodies[b.cycle.key]) keys.add(b.cycle.key);
  return [...keys];
}
