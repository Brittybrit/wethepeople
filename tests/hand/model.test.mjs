import { describe, it, expect } from 'vitest';
import { createModel, checkSchema } from '../../lib/model.mjs';
import { caches } from '../../lib/cache.mjs';
import { tracer, sinks } from '../../lib/events.mjs';
import config from '../../config/models.json' with { type: 'json' };

const schema = { type: 'object', required: ['tags'], properties: { tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } } }, additionalProperties: false };

describe('model routing', () => {
  it('validates structured output, retries once, then falls to the next model', async () => {
    const calls = [];
    const fake = async ({ modelName }) => { calls.push(modelName); return modelName === 'claude-haiku-4-5' ? { text: '{"tags":["zzz"]}', usage: { input: 10, output: 5 }, cost: 0.001 } : { text: 'sure: {"tags":["a"]}', usage: { input: 10, output: 5 }, cost: 0.0001 }; };
    const m = createModel({ config, fake });
    const r = await m.complete({ task: 'extract', schema, input: 'x' });
    expect(calls).toEqual(['claude-haiku-4-5', 'claude-haiku-4-5', 'gpt-4o-mini']);
    expect(r.model).toBe('gpt-4o-mini'); expect(r.json).toEqual({ tags: ['a'] });
  });
  it('caches by task, prompt version and input hash, and records a decision', async () => {
    let n = 0;
    const fake = async () => { n++; return { text: '{"tags":["b"]}', usage: { input: 1, output: 1 }, cost: 0.002 }; };
    const sink = sinks.memory(); const t = tracer({ service: 'test', sink });
    const m = createModel({ config, fake, cache: caches.memory(), tracer: t });
    const a = await m.complete({ task: 'classify', schema, input: 'same', prompt_version: 'p1' });
    const b = await m.complete({ task: 'classify', schema, input: 'same', prompt_version: 'p1' });
    const c = await m.complete({ task: 'classify', schema, input: 'same', prompt_version: 'p2' });
    expect(n).toBe(2); expect(b.cached).toBe(true); expect(a.decision_id).toMatch(/^[0-9a-f]{24}$/); expect(c.decision_id).not.toBe(a.decision_id);
    const rows = await t.flush();
    expect(rows.filter(r => r.event === 'decision').length).toBe(2);
    expect(rows.find(r => r.event === 'model.cache').cost).toBe(0);
  });
  it('skips providers with no key instead of retrying them', async () => {
    const m = createModel({ config, env: {}, fetchFn: async () => { throw new Error('should not be called'); } });
    await expect(m.complete({ task: 'plan', input: 'x' })).rejects.toThrow(/no key for anthropic/);
  });
  it('rejects unknown tasks', async () => {
    await expect(createModel({ config }).complete({ task: 'nope', input: '' })).rejects.toThrow(/unknown task/);
  });
});

describe('checkSchema', () => {
  it('checks types, required, enums, items and additionalProperties', () => {
    expect(checkSchema({ tags: ['a'] }, schema)).toBeNull();
    expect(checkSchema({ tags: ['c'] }, schema)).toMatch(/enum/);
    expect(checkSchema({}, schema)).toMatch(/missing/);
    expect(checkSchema({ tags: [], extra: 1 }, schema)).toMatch(/not allowed/);
    expect(checkSchema('x', { type: ['number', 'null'] })).toMatch(/should be/);
    expect(checkSchema(null, { type: ['number', 'null'] })).toBeNull();
  });
});
