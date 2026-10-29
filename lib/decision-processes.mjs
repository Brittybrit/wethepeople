// Decision processes: each decision a body makes (budget, ordinance, contract award, election) as an ordered chain of
// milestones, so a resident can see where to step in before the final vote.
// Pure functions over data/decision-processes/index.json (passed in as `data`); no network, no imports.
// Data shape and date rules: data/decision-processes/README.md.

export const KINDS = ['annual-budget-and-millage', 'ordinance-adoption', 'procurement-award', 'election-to-office'];
export const LEVERS = ['public-comment', 'written-comment', 'contact', 'records-request', 'petition', 'referendum', 'recall', 'qualify', 'vote', 'serve-on-board', 'other'];
export const DATE_BASES = ['body-source', 'statutory-window', 'pattern', 'unknown'];
export const INFLUENCE = ['high', 'medium', 'low'];
const INFLUENCE_RANK = { high: 0, medium: 1, low: 2 };
const MAX_OFFSET_DAYS = 400;

// ---------- dates ----------
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function addDays(date, days) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }

// The window a law gives relative to an anchor date: "within 35 days" is {min: 0, max: 34}; "2 to 5 days after" is {min: 2, max: 5}.
// A missing min or max leaves that side open (null).
export function windowFromAnchor(anchorDate, offsetDays) {
  if (!anchorDate || !offsetDays) return null;
  return {
    from: offsetDays.min == null ? null : addDays(anchorDate, offsetDays.min),
    to: offsetDays.max == null ? null : addDays(anchorDate, offsetDays.max)
  };
}

// Start and end of one dated row: a single date, or a window whose open side takes the other side's value.
export function span(row) {
  if (!row) return null;
  if (row.date) return { from: row.date, to: row.date };
  if (row.window) {
    const from = row.window.from || row.window.to, to = row.window.to || row.window.from;
    return from ? { from, to } : null;
  }
  return null;
}

// ---------- lookups ----------
const bodyOf = (data, key) => data?.bodies?.[key] || null;
const templateOf = (data, key) => data?.templates?.[key] || null;
const appliesTo = (item, level) => !item.appliesToLevels || item.appliesToLevels.includes(level);
const lawFor = (list, level) => (list || []).filter(l => !l.level || l.level === level).map(({ cite, url }) => ({ cite, url }));
const uniqueLaw = list => list.filter((l, i) => list.findIndex(x => x.cite === l.cite) === i);

function stepsFor(template, level) { return template.milestones.filter(m => appliesTo(m, level)); }

function leversFor(milestone, body) {
  return (milestone.residentCan || []).map(r => {
    const where = body.leverLinks?.[r.lever];
    return { lever: r.lever, how: r.how, ...(where ? { url: where.url, ...(where.deadline ? { deadline: where.deadline } : {}) } : {}) };
  });
}

function instanceOut(r) {
  const o = { dateBasis: r.dateBasis };
  if (r.date) o.date = r.date;
  if (r.window) o.window = r.window;
  for (const k of ['source', 'note', 'anchorBasis']) if (r[k]) o[k] = r[k];
  if (r.dateBasis === 'pattern') o.estimated = true;
  return o;
}

function buildChain(body, decision, template) {
  const steps = stepsFor(template, body.level);
  const override = {};
  for (const r of decision.milestones) if (r.legalBasis || r.timing) override[r.milestone] = { ...override[r.milestone], ...r };
  return {
    body: { key: body.key, name: body.name, level: body.level },
    decision: {
      key: decision.key, kind: decision.kind, name: decision.name, template: template.key,
      ...(decision.cycle ? { cycle: decision.cycle } : {}),
      ...(decision.processOnly ? { processOnly: true } : {}),
      ...(decision.processOnly && body.meetingPattern ? { meetingPattern: body.meetingPattern } : {}),
      ...(decision.notes ? { notes: decision.notes } : {}),
      summary: template.summary
    },
    steps: steps.map((m, i) => {
      const rows = decision.milestones.filter(r => r.milestone === m.key);
      const dated = rows.filter(r => r.date || r.window);
      const notes = rows.filter(r => !r.date && !r.window && r.note).map(r => r.note);
      const o = override[m.key];
      const instances = dated.length ? dated.map(instanceOut) : [{ dateBasis: 'unknown', ...(notes.length ? { note: notes.join(' ') } : {}) }];
      return {
        step: i + 1, of: steps.length, stepLabel: `${i + 1} of ${steps.length}`,
        key: m.key, name: m.name, actor: m.actor, inputs: m.inputs, output: m.output,
        timing: o?.timing || m.timing,
        legalBasis: uniqueLaw([...lawFor(m.legalBasis, body.level), ...lawFor(o?.legalBasis, body.level)]),
        residentCan: leversFor(m, body),
        influence: m.influence, influenceWhy: m.influenceWhy,
        ...(m.appliesWhen ? { appliesWhen: m.appliesWhen } : {}),
        ...(dated.length && notes.length ? { note: notes.join(' ') } : {}),
        instances
      };
    })
  };
}

// Every chain of one kind for a body (a body can have two elections on file). Empty array if none.
export function chainFor(bodyKey, kind, data) {
  const body = bodyOf(data, bodyKey);
  if (!body) return [];
  return body.decisions.filter(d => d.kind === kind).map(d => {
    const t = templateOf(data, d.template);
    return t ? buildChain(body, d, t) : null;
  }).filter(Boolean);
}

export function allChains(bodyKeys, data) {
  const out = [];
  for (const k of bodyKeys) for (const kind of KINDS) out.push(...chainFor(k, kind, data));
  return out;
}

const stepBrief = s => s ? { step: s.step, key: s.key, name: s.name, actor: s.actor, when: s.instances.map(span).filter(Boolean)[0] || null } : null;

// Every dated milestone whose date or window touches [today, today + horizonDays], soonest first.
// Each item carries its decision, its place in the chain ("3 of 8"), the step before it, the step it feeds, and what a resident can do.
export function upcomingMilestones(bodyKeys, today, data, { horizonDays = 60 } = {}) {
  const end = addDays(today, horizonDays);
  const items = [];
  for (const chain of allChains(bodyKeys, data)) {
    if (chain.decision.processOnly) continue;
    chain.steps.forEach((s, i) => {
      for (const inst of s.instances) {
        const sp = span(inst);
        if (!sp || sp.to < today || sp.from > end) continue;
        items.push({
          body: chain.body,
          decision: { key: chain.decision.key, kind: chain.decision.kind, name: chain.decision.name, ...(chain.decision.cycle ? { cycle: chain.decision.cycle } : {}) },
          step: s.step, of: s.of, stepLabel: s.stepLabel,
          milestone: { key: s.key, name: s.name, actor: s.actor, inputs: s.inputs, output: s.output, timing: s.timing.rule, legalBasis: s.legalBasis, ...(s.appliesWhen ? { appliesWhen: s.appliesWhen } : {}) },
          when: sp, ...(inst.date ? { date: inst.date } : { window: inst.window }),
          openNow: sp.from <= today && today <= sp.to,
          daysUntil: Math.max(0, daysBetween(today, sp.from)),
          dateBasis: inst.dateBasis, ...(inst.estimated ? { estimated: true } : {}),
          ...(inst.source ? { source: inst.source } : {}), ...(inst.note ? { note: inst.note } : {}),
          cameBefore: stepBrief(chain.steps[i - 1]),
          feeds: stepBrief(chain.steps[i + 1]),
          residentCan: s.residentCan,
          influence: s.influence, influenceWhy: s.influenceWhy
        });
      }
    });
  }
  return items.sort((a, b) => a.when.from.localeCompare(b.when.from) || INFLUENCE_RANK[a.influence] - INFLUENCE_RANK[b.influence] || a.when.to.localeCompare(b.when.to) || a.body.key.localeCompare(b.body.key));
}

// The soonest step, open now or ahead, where a resident has the most leverage. Null if none is dated.
export function nextLeveragePoint(bodyKeys, today, data) {
  const high = upcomingMilestones(bodyKeys, today, data, { horizonDays: 3660 }).filter(m => m.influence === 'high');
  if (!high.length) return null;
  // A step open today wins, the one closing first; otherwise the next one to open.
  const open = high.filter(m => m.openNow).sort((a, b) => a.when.to.localeCompare(b.when.to));
  return open[0] || high[0];
}

// ---------- build and validation ----------

// Merge template files ({kind, variants}) and body files into the single index the Worker imports.
export function buildIndex(templateFiles, bodyFiles) {
  const templates = {}, kinds = {}, bodies = {};
  for (const f of templateFiles) {
    kinds[f.kind] = { name: f.name, templates: f.variants.map(v => v.key) };
    for (const v of f.variants) templates[v.key] = v;
  }
  for (const b of bodyFiles) bodies[b.key] = b;
  return { schema: 'decision-processes/1', kinds, templates, bodies };
}

const isUrl = u => typeof u === 'string' && /^https?:\/\/\S+$/.test(u);
const isLink = u => isUrl(u) || (typeof u === 'string' && /^(mailto|tel):\S+$/.test(u));
const isDateAnchor = a => typeof a === 'string' && /^date:\d{2}-\d{2}$/.test(a);

// Returns a list of plain-language problems; empty means valid.
// `files` is optional: { bodyFileNames: { bodyKey: 'county.json' } } to check that keys match file names.
export function validateDecisionData(data, { bodyFileNames } = {}) {
  const errs = [];
  const err = (where, msg) => errs.push(`${where}: ${msg}`);
  const checkLaw = (where, list) => {
    for (const l of list || []) {
      if (!l.cite) err(where, 'legal basis without a cite');
      if (!isUrl(l.url)) err(where, `legal basis "${l.cite}" has no URL`);
      if (l.level && !['county', 'municipal', 'school'].includes(l.level)) err(where, `legal basis level "${l.level}" is not county, municipal or school`);
    }
  };
  const checkTiming = (where, t, keys) => {
    if (!t || typeof t.rule !== 'string' || !t.rule) { err(where, 'timing.rule missing'); return; }
    if (t.anchor != null && !keys.has(t.anchor) && !isDateAnchor(t.anchor) && t.anchor !== 'fiscal-year-start') err(where, `timing.anchor "${t.anchor}" is not a milestone key or date:MM-DD`);
    if (t.offsetDays != null) {
      if (t.anchor == null) err(where, 'offsetDays without an anchor');
      const { min, max } = t.offsetDays;
      if (min == null && max == null) err(where, 'offsetDays with neither min nor max');
      for (const v of [min, max]) if (v != null && (!Number.isInteger(v) || Math.abs(v) > MAX_OFFSET_DAYS)) err(where, `offset ${v} is not a whole number within ${MAX_OFFSET_DAYS} days`);
      if (min != null && max != null && min > max) err(where, `offset min ${min} is after max ${max}`);
    }
    if (t.offsetUnit && !['calendar-days', 'business-days'].includes(t.offsetUnit)) err(where, `offsetUnit "${t.offsetUnit}" is not calendar-days or business-days`);
  };

  // Templates
  const tkeys = new Set();
  for (const [key, t] of Object.entries(data.templates || {})) {
    const w = `template ${key}`;
    if (t.key !== key) err(w, 'key does not match its index entry');
    if (tkeys.has(key)) err(w, 'duplicate template key'); tkeys.add(key);
    if (!KINDS.includes(t.kind)) err(w, `kind "${t.kind}" is not one of ${KINDS.join(', ')}`);
    checkLaw(w, t.legalBasis);
    const mkeys = new Set();
    for (const m of t.milestones || []) {
      if (mkeys.has(m.key)) err(w, `duplicate milestone key "${m.key}"`);
      mkeys.add(m.key);
    }
    if (!mkeys.size) err(w, 'no milestones');
    for (const m of t.milestones || []) {
      const wm = `${w} / ${m.key}`;
      for (const f of ['name', 'actor', 'output', 'influenceWhy']) if (!m[f]) err(wm, `${f} missing`);
      if (!Array.isArray(m.inputs) || !m.inputs.length) err(wm, 'inputs missing');
      if (!INFLUENCE.includes(m.influence)) err(wm, `influence "${m.influence}" is not high, medium or low`);
      if (!Array.isArray(m.residentCan) || !m.residentCan.length) err(wm, 'residentCan missing');
      for (const r of m.residentCan || []) {
        if (!LEVERS.includes(r.lever)) err(wm, `lever "${r.lever}" is not a known lever key`);
        if (!r.how) err(wm, `lever ${r.lever} has no how`);
      }
      if (!Array.isArray(m.legalBasis)) err(wm, 'legalBasis must be a list (empty when no law sets this step)');
      if (m.legallyRequired && !(m.legalBasis || []).length) err(wm, 'legally required step has no legal basis');
      checkLaw(wm, m.legalBasis);
      checkTiming(wm, m.timing, mkeys);
    }
  }

  // Bodies
  for (const [key, b] of Object.entries(data.bodies || {})) {
    const w = `body ${key}`;
    if (b.key !== key) err(w, 'key does not match its index entry');
    if (bodyFileNames && bodyFileNames[key] && bodyFileNames[key] !== `${key}.json`) err(w, `file name ${bodyFileNames[key]} does not match key`);
    if (!['county', 'municipal', 'school'].includes(b.level)) err(w, `level "${b.level}" is not county, municipal or school`);
    for (const [lv, l] of Object.entries(b.leverLinks || {})) {
      if (!LEVERS.includes(lv)) err(w, `leverLinks key "${lv}" is not a known lever`);
      if (!isLink(l.url)) err(w, `leverLinks ${lv} has no URL`);
      if (l.source != null && !isUrl(l.source)) err(w, `leverLinks ${lv} source is not a URL`);
    }
    if (b.meetingPattern && !isUrl(b.meetingPattern.source)) err(w, 'meeting pattern has no source URL');
    const dkeys = new Set();
    for (const d of b.decisions || []) {
      const wd = `${w} / ${d.key}`;
      if (dkeys.has(d.key)) err(wd, 'duplicate decision key'); dkeys.add(d.key);
      const t = data.templates?.[d.template];
      if (!t) { err(wd, `template "${d.template}" not found`); continue; }
      if (t.kind !== d.kind) err(wd, `kind "${d.kind}" does not match template kind "${t.kind}"`);
      if (!appliesTo(t, b.level)) err(wd, `template ${t.key} does not apply to level ${b.level}`);
      if (d.processOnly && d.milestones.some(r => r.date || r.window)) err(wd, 'process-only decision has dated rows');
      const byKey = Object.fromEntries(t.milestones.map(m => [m.key, m]));
      const order = t.milestones.map(m => m.key);
      let last = -1;
      for (const r of d.milestones || []) {
        const wr = `${wd} / ${r.milestone}`;
        const m = byKey[r.milestone];
        if (!m) { err(wr, 'not a milestone of the template'); continue; }
        if (!appliesTo(m, b.level)) err(wr, `milestone does not apply to level ${b.level}`);
        const idx = order.indexOf(r.milestone);
        if (idx < last) err(wr, 'rows are not in template order');
        last = Math.max(last, idx);
        if (!DATE_BASES.includes(r.dateBasis)) { err(wr, `dateBasis "${r.dateBasis}" is not one of ${DATE_BASES.join(', ')}`); continue; }
        if (r.date && r.window) err(wr, 'has both date and window');
        if (r.date && !ISO.test(r.date)) err(wr, `date "${r.date}" is not YYYY-MM-DD`);
        if (r.window) {
          const { from, to } = r.window;
          if (from != null && !ISO.test(from)) err(wr, `window.from "${from}" is not YYYY-MM-DD`);
          if (to != null && !ISO.test(to)) err(wr, `window.to "${to}" is not YYYY-MM-DD`);
          if (from == null && to == null) err(wr, 'window with no ends');
          if (from && to && from > to) err(wr, `window from ${from} is after to ${to}`);
        }
        const dated = !!(r.date || r.window);
        if (r.dateBasis === 'unknown' && dated) err(wr, 'dateBasis unknown but a date is given');
        if (r.dateBasis !== 'unknown' && !dated) err(wr, `dateBasis ${r.dateBasis} but no date or window`);
        if ((r.dateBasis === 'body-source' || r.dateBasis === 'pattern') && !isUrl(r.source)) err(wr, `${r.dateBasis} date has no source URL`);
        if (r.dateBasis === 'pattern' && !/estimated/i.test(r.note || '') && !/pattern/i.test(r.note || '')) err(wr, 'pattern date is not labeled as estimated in its note');
        if (r.source && !isUrl(r.source)) err(wr, 'source is not a URL');
        checkLaw(wr, r.legalBasis);
        if (r.timing) checkTiming(wr, r.timing, new Set(order));
        // Statutory consistency: a date computed from the law must sit inside the window its anchor allows.
        const tm = r.timing || m.timing;
        if (dated && tm?.anchor && tm.offsetDays && (tm.offsetUnit || 'calendar-days') === 'calendar-days') {
          let anchorDate = null;
          if (isDateAnchor(tm.anchor)) {
            const sp = span(r); if (sp) anchorDate = `${sp.from.slice(0, 4)}-${tm.anchor.slice(5)}`;
          } else {
            const a = d.milestones.filter(x => x.milestone === tm.anchor && x.date);
            if (a.length === 1) anchorDate = a[0].date;
          }
          const allowed = windowFromAnchor(anchorDate, tm.offsetDays);
          const sp = span(r);
          if (allowed && sp) {
            if (allowed.from && r.window?.from !== null && sp.from < allowed.from) err(wr, `starts ${sp.from}, before the legal window opens ${allowed.from} (anchor ${tm.anchor} ${anchorDate})`);
            if (allowed.to && sp.to > allowed.to) err(wr, `ends ${sp.to}, after the legal window closes ${allowed.to} (anchor ${tm.anchor} ${anchorDate})`);
          }
        }
      }
    }
  }
  return errs;
}
