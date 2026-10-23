import { describe, it, expect } from 'vitest';
import { tracer, sinks, cleanEvent } from '../../lib/events.mjs';

describe('events and traces', () => {
  it('rejects props that could carry identity', () => {
    expect(() => cleanEvent({ event: 'x', props: { email: 'a@b' } })).toThrow(/not allowed/);
    expect(() => cleanEvent({ event: 'x', props: { home_address: '1 Main' } })).toThrow(/not allowed/);
    expect(cleanEvent({ event: 'x', props: { precinct_count: 3 } }).props.precinct_count).toBe(3);
  });
  it('drops unknown top-level fields so nothing leaks through the shape', () => {
    const e = cleanEvent({ event: 'x', ip: '1.2.3.4', name: 'Brit' });
    expect(e).not.toHaveProperty('ip'); expect(e).not.toHaveProperty('name');
  });
  it('spans record latency, ok and the trace id; decisions get an id that outcomes can join', async () => {
    const sink = sinks.memory();
    const t = tracer({ service: 'test', sink, client: 'unit' });
    const v = await t.span('work', { task: 'extract', tier: 1 }, async () => 42);
    expect(v).toBe(42);
    const id = await t.decide({ kind: 'match', inputs: { a: 1 }, candidates: ['x', 'y'], chosen: 'x', tier: 1, confidence: 0.9, rationale: 'rule: exact name' });
    t.outcome({ decision_id: id, outcome: 'confirmed', source: 'person' });
    await expect(t.span('boom', { task: 'x' }, async () => { throw new Error('nope'); })).rejects.toThrow('nope');
    const rows = await t.flush();
    expect(rows.map(r => r.event)).toEqual(['work', 'decision', 'outcome', 'boom']);
    expect(rows.every(r => r.trace_id === t.trace_id)).toBe(true);
    expect(rows[0].ok).toBe(true); expect(rows[3].ok).toBe(false); expect(rows[3].props.error).toBe('nope');
    expect(rows[1].props.decision_id).toBe(id); expect(rows[1].props.inputs_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[2].props.decision_id).toBe(id);
    expect(sink.rows.length).toBe(4);
  });
});
