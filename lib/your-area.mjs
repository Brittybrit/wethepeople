// "Your area": one precinct's view of who serves it, what is about to be decided, and what a resident can do now.
// Pure functions over Ballot305's /api/v1/now and /api/v1/upcoming responses; no network, no model calls.
// The do-now list comes from fixed, published rules (RULES below), so anyone can see why an action ranks where it does.

// The citizen is the center: the bodies closest to home come first.
export const LEVEL_ORDER = ['municipal', 'school', 'county', 'state', 'federal'];
export const LEVEL_LABEL = { municipal: 'Your city', school: 'Your schools', county: 'Your county', state: 'Your state', federal: 'Washington' };

export const RULES = [
  'Vote: when an election for any seat that represents this precinct is within 30 days, voting comes first.',
  'Weigh in on a posted item: an item on a posted agenda for one of your bodies that involves money, a lobbyist, a public hearing or a place, with its meeting still ahead. Written comment first (no trip), speaking second.',
  'Show up: the next regular meeting of the body closest to home that takes public comment on any topic.',
  'Reach your representative: the district office for the seat closest to home, any time.'
];

export function todayIn(tz = 'America/New_York', d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }

const levelRank = l => { const i = LEVEL_ORDER.indexOf(l); return i < 0 ? 99 : i; };
const pick = (o, keys) => { const out = {}; for (const k of keys) if (o && o[k] != null) out[k] = o[k]; return out; };

function servants(bodies) {
  return [...bodies].sort((a, b) => levelRank(a.level) - levelRank(b.level)).map(b => ({
    body: b.body,
    name: b.name,
    level: b.level,
    seats: (b.seats || []).map(s => ({
      office: s.office,
      name: s.name,
      district: s.district || null,
      holders: (s.holders || []).map(h => pick(h, ['person', 'name', 'since', 'sinceKnown', 'via', 'termExpires'])),
      onBallot: (s.onBallot || []).flatMap(r => (r.candidates || []).map(c => pick(c, ['person', 'name', 'party', 'incumbent']))),
      contact: s.contact ? pick(s.contact, ['email', 'phone', 'contactUrl', 'officeAddress', 'checked', 'source']) : null
    })),
    clerk: b.bodyContact ? pick(b.bodyContact, ['clerkEmail', 'clerkPhone', 'clerkUrl', 'commentEmail', 'recordsRequestUrl', 'checked']) : null,
    researched: !!b.cycle
  }));
}

function meetings(bodies, today) {
  const out = [];
  for (const b of bodies) for (const m of ((b.cycle || {}).meetings || {}).next || []) {
    if (m.date >= today) out.push({ date: m.date, time: m.time || null, kind: m.kind || null, note: m.note || null, body: b.body, bodyName: b.name, level: b.level, source: m.source || null });
  }
  return out.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')) || levelRank(a.level) - levelRank(b.level));
}

function phases(bodies, today, horizonDays = 180) {
  const out = [];
  for (const b of bodies) {
    const p = (b.cycle || {}).phases || {};
    for (const x of [...(p.current || []), ...(p.upcoming || [])]) {
      const end = x.end || x.start;
      if (!x.start || end < today || daysBetween(today, x.start) > horizonDays) continue;
      out.push({ ...pick(x, ['key', 'name', 'start', 'end', 'decides', 'source']), now: x.start <= today, body: b.body, bodyName: b.name, level: b.level });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || levelRank(a.level) - levelRank(b.level));
}

function levers(bodies) {
  return bodies.filter(b => b.cycle && (b.cycle.levers || []).length).sort((a, b) => levelRank(a.level) - levelRank(b.level)).map(b => ({
    body: b.body, bodyName: b.name, level: b.level,
    levers: b.cycle.levers.map(l => pick(l, ['key', 'how', 'rules', 'deadline', 'url', 'source', 'nextMeeting']))
  }));
}

// Why a posted item matters, in plain words, from Ballot305's tags.
export function itemReasons(tags = {}) {
  const r = [];
  if (tags.place) r.push('in or near your area');
  if (tags.money) r.push('spends or awards public money');
  if (tags.lobbied) r.push('a registered lobbyist is working on it');
  if (tags.hearing) r.push('public hearing');
  if (tags.history) r.push('this body has acted on it before');
  return r;
}
const itemWeight = t => (t.place ? 8 : 0) + (t.money ? 4 : 0) + (t.lobbied ? 4 : 0) + (t.hearing ? 2 : 0) + (t.history ? 1 : 0);

function items(upcoming, today) {
  return ((upcoming && upcoming.items) || [])
    .filter(i => i.meeting && i.meeting.date >= today)
    .map(i => ({
      body: i.body, bodyName: i.bodyName, id: i.id, title: i.title,
      meeting: pick(i.meeting, ['date', 'time', 'kind', 'agendaUrl', 'location']),
      amount: i.amount ?? null, publicHearing: !!i.publicHearing,
      reasons: itemReasons(i.tags || {}), weight: itemWeight(i.tags || {}),
      links: (i.links || []).slice(0, 3),
      comment: (i.comment || []).map(c => pick(c, ['key', 'rules', 'deadline', 'url', 'source']))
    }))
    .sort((a, b) => b.weight - a.weight || a.meeting.date.localeCompare(b.meeting.date));
}

function doNow({ phases: ph, items: it, meetings: mt, servants: sv, levers: lv, today }) {
  const out = [];
  const election = ph.find(p => p.key === 'election' && daysBetween(today, p.start) >= 0 && daysBetween(today, p.start) <= 30);
  if (election) out.push({ rule: 1, kind: 'vote', title: 'Vote by ' + election.start, why: 'Election day for seats or questions that represent this precinct. Ballot305 has your full ballot with who funds each candidate and measure.', deadline: election.start, url: 'https://ballot305.org', source: election.source || null });

  const item = it.find(i => i.weight > 0);
  if (item) {
    const c = item.comment.find(x => x.key === 'written-comment' && x.url) || item.comment.find(x => x.url) || null;
    out.push({ rule: 2, kind: c && c.key === 'written-comment' ? 'write' : 'speak', title: (c && c.key === 'written-comment' ? 'Write to ' : 'Speak at ') + item.bodyName + ' before ' + item.meeting.date, why: item.title + ' (' + item.reasons.join('; ') + ')', deadline: (c && c.deadline) || item.meeting.date, url: (c && c.url) || item.meeting.agendaUrl || null, source: (c && c.source) || null });
  }

  for (const group of lv) {
    const speak = group.levers.find(l => l.key === 'public-comment');
    if (!speak) continue;
    // Open public comment runs at regular meetings, not workshops, special meetings or ceremonies.
    const next = mt.find(m => m.body === group.body && m.kind === 'regular');
    const date = next && next.date;
    if (!date || date < today) continue;
    out.push({ rule: 3, kind: 'speak', title: 'Speak at the ' + group.bodyName + ' meeting on ' + date, why: speak.how, deadline: speak.deadline || date, url: speak.url || null, source: speak.source || null });
    break;
  }

  // A seat with its own district and an email first (a written request leaves a record), then any phone.
  const seatsInOrder = sv.flatMap(b => b.seats.filter(s => s.holders.length && s.contact && (s.district || b.seats.length === 1)));
  for (const seat of [...seatsInOrder.filter(s => s.contact.email), ...seatsInOrder.filter(s => !s.contact.email && s.contact.phone)]) {
    const h = seat.holders[0];
    out.push({ rule: 4, kind: 'contact', title: 'Reach ' + h.name + ', ' + seat.name, why: 'The district office handles constituent requests, and a call or email on a pending item goes on the record.', deadline: null, url: seat.contact.email ? 'mailto:' + seat.contact.email : seat.contact.contactUrl || null, phone: seat.contact.phone || null, source: seat.contact.source || null });
    break;
  }
  return out;
}

export function yourArea(now, upcoming, today) {
  const bodies = (now && now.bodies) || [];
  const sv = servants(bodies), mt = meetings(bodies, today), ph = phases(bodies, today), lv = levers(bodies), it = items(upcoming, today);
  return {
    precinct: now.precinct,
    today,
    dataUpdated: now.updated || null,
    rosterUpdated: now.rosterUpdated || null,
    districts: now.districts || {},
    doNow: doNow({ phases: ph, items: it, meetings: mt, servants: sv, levers: lv, today }),
    rules: RULES,
    upcomingItems: it.slice(0, 25),
    upcomingItemsTotal: it.length,
    meetings: mt.slice(0, 12),
    decisionPoints: ph,
    servants: sv,
    levers: lv,
    notResearchedYet: sv.filter(b => !b.researched).flatMap(b => b.seats.map(s => s.name))
  };
}
