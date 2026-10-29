// Decision chains for one precinct: each upcoming decision broken into its milestones (inputs, actor, output, legal
// basis, what a resident can do), with where the chain stands today. Pure; reads data/decision-processes/index.json.
import { allChains, nextLeveragePoint, span, daysBetween } from './decision-processes.mjs';

const firstSpan = s => (s.instances || []).map(i => ({ sp: span(i), i })).filter(x => x.sp).sort((a, b) => a.sp.from.localeCompare(b.sp.from))[0] || null;

function stepView(s, today) {
  const f = firstSpan(s);
  const when = f ? f.sp : null;
  const status = !when ? 'undated' : when.to < today ? 'done' : when.from <= today ? 'now' : 'ahead';
  return {
    step: s.step, of: s.of, key: s.key, name: s.name, actor: s.actor, inputs: s.inputs, output: s.output,
    timing: s.timing && s.timing.rule, legalBasis: s.legalBasis, residentCan: s.residentCan,
    influence: s.influence, influenceWhy: s.influenceWhy, ...(s.appliesWhen ? { appliesWhen: s.appliesWhen } : {}),
    when, status, dateBasis: f ? f.i.dateBasis : 'unknown', ...(f && f.i.estimated ? { estimated: true } : {}),
    ...(f && f.i.source ? { source: f.i.source } : {}), ...(f && f.i.note ? { note: f.i.note } : {})
  };
}

// Dated decisions with a step still ahead within the horizon, soonest next step first; plus each body's undated
// processes (how an ordinance passes, how a contract is awarded) as plain chains.
export function decisionChains(bodyKeys, today, data, { horizonDays = 400 } = {}) {
  const chains = [], processes = [];
  for (const c of allChains(bodyKeys, data)) {
    const steps = c.steps.map(s => stepView(s, today));
    const head = { body: c.body, decision: { key: c.decision.key, kind: c.decision.kind, name: c.decision.name, ...(c.decision.cycle ? { cycle: c.decision.cycle } : {}) } };
    if (c.decision.processOnly) { processes.push({ ...head, steps: steps.map(({ when, status, dateBasis, ...rest }) => rest) }); continue; }
    const next = steps.find(s => s.status === 'now') || steps.find(s => s.status === 'ahead');
    if (!next || daysBetween(today, next.when.from) > horizonDays) continue;
    chains.push({ ...head, next: { step: next.step, of: next.of, name: next.name, when: next.when, status: next.status }, steps });
  }
  chains.sort((a, b) => a.next.when.from.localeCompare(b.next.when.from));
  return { decisionChains: chains, processes, nextLeveragePoint: nextLeveragePoint(bodyKeys, today, data) };
}

// The decision bodies (data/decision-processes keys) behind a precinct's "now" bodies.
export function decisionBodyKeys(nowBodies, data) {
  const keys = new Set();
  for (const b of nowBodies || []) if (b.cycle && b.cycle.key && data.bodies && data.bodies[b.cycle.key]) keys.add(b.cycle.key);
  return [...keys];
}
