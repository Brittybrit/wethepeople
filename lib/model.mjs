// Model adapter with routing, structured output, caching and instrumentation.
// complete({task, schema, system, input}) tries the task's models in order (config/models.json), validates the
// JSON against the schema, retries once on the same model, then falls to the next. Every call is a span and a
// decision record. Results are cached by prompt version + model + input hash so repeats cost nothing.
import { hashOf } from './hash.mjs';

export function createModel({ config, env = {}, fetchFn = globalThis.fetch, cache, tracer, fake } = {}) {
  const cfg = config;
  const keyFor = provider => { const p = cfg.providers[provider]; return p && p.keyEnv ? env[p.keyEnv] : ''; };

  async function callProvider(modelName, { system, input, schema, max_tokens }) {
    const m = cfg.models[modelName]; if (!m) throw new Error('unknown model ' + modelName);
    const p = cfg.providers[m.provider];
    const key = keyFor(m.provider);
    if (p.keyEnv && !key) throw new Error('no key for ' + m.provider);
    const schemaNote = schema ? '\n\nReturn only JSON matching this JSON Schema, no prose:\n' + JSON.stringify(schema) : '';
    let text = '', usage = { input: 0, output: 0 };
    if (m.provider === 'anthropic') {
      const res = await fetchFn(p.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: modelName, max_tokens, system: (system || '') + schemaNote, messages: [{ role: 'user', content: input }] }) });
      if (!res.ok) throw new Error(m.provider + ' ' + res.status + ': ' + (await res.text()).slice(0, 200));
      const d = await res.json(); text = (d.content || []).filter(c => c.type === 'text').map(c => c.text).join(''); usage = { input: d.usage?.input_tokens || 0, output: d.usage?.output_tokens || 0 };
    } else {
      const res = await fetchFn(p.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
        body: JSON.stringify({ model: m.id || modelName, max_tokens, messages: [{ role: 'system', content: (system || '') + schemaNote }, { role: 'user', content: input }], ...(schema ? { response_format: { type: 'json_object' } } : {}) }) });
      if (!res.ok) throw new Error(m.provider + ' ' + res.status + ': ' + (await res.text()).slice(0, 200));
      const d = await res.json(); text = d.choices?.[0]?.message?.content || ''; usage = { input: d.usage?.prompt_tokens || 0, output: d.usage?.completion_tokens || 0 };
    }
    const cost = (usage.input * m.price[0] + usage.output * m.price[1]) / 1e6;
    return { text, usage, cost };
  }

  return {
    async complete({ task, schema, system, input, prompt_version = 'v0', validate, body, item }) {
      const t = cfg.tasks[task]; if (!t) throw new Error('unknown task ' + task);
      const key = 'model:' + task + ':' + prompt_version + ':' + await hashOf({ system, input, schema });
      if (cache) { const hit = await cache.get(key); if (hit) { tracer?.emit({ event: 'model.cache', task, tier: 2, cost: 0, ok: true, props: { model: hit.model } }); return { ...hit, cached: true }; } }
      const tried = [];
      for (const modelName of t.models) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const r = fake ? await fake({ task, modelName, system, input, schema }) : await (tracer ? tracer.span('model.call', { task, tier: t.tier, body, item, props: { model: modelName, attempt } }, () => callProvider(modelName, { system, input, schema, max_tokens: t.max_tokens })) : callProvider(modelName, { system, input, schema, max_tokens: t.max_tokens }));
            let json = null;
            if (schema) {
              const m = r.text.match(/\{[\s\S]*\}|\[[\s\S]*\]/); if (!m) throw new Error('no JSON in response');
              json = JSON.parse(m[0]);
              const err = validate ? validate(json, schema) : checkSchema(json, schema);
              if (err) throw new Error('schema: ' + err);
            }
            const out = { model: modelName, tier: t.tier, text: r.text, json, usage: r.usage, cost: r.cost ?? 0, prompt_version };
            if (tracer) out.decision_id = await tracer.decide({ kind: task, inputs: { system, input }, candidates: t.models, chosen: modelName, tier: t.tier, model: modelName, prompt_version, confidence: schema ? 1 : 0.5, rationale: r.text, body, item });
            if (cache) await cache.put(key, out);
            return out;
          } catch (e) { tried.push(modelName + '#' + attempt + ': ' + e.message); if (/no key/.test(e.message)) break; }
        }
      }
      throw new Error('all models failed for ' + task + ': ' + tried.join(' | '));
    }
  };
}

// A small JSON Schema checker: type, required, properties, items, enum. Enough for structured outputs; swap for ajv in Node if needed.
export function checkSchema(v, s, path = '$') {
  if (!s) return null;
  const type = s.type;
  const is = { object: x => x && typeof x === 'object' && !Array.isArray(x), array: Array.isArray, string: x => typeof x === 'string', number: x => typeof x === 'number', integer: Number.isInteger, boolean: x => typeof x === 'boolean', null: x => x === null };
  if (type) { const types = [].concat(type); if (!types.some(t => is[t]?.(v))) return path + ' should be ' + types.join('|'); }
  if (s.enum && !s.enum.includes(v)) return path + ' not in enum';
  if (is.object(v)) {
    for (const r of s.required || []) if (!(r in v)) return path + '.' + r + ' missing';
    for (const [k, sub] of Object.entries(s.properties || {})) if (k in v) { const e = checkSchema(v[k], sub, path + '.' + k); if (e) return e; }
    if (s.additionalProperties === false) for (const k of Object.keys(v)) if (!(s.properties || {})[k]) return path + '.' + k + ' not allowed';
  }
  if (Array.isArray(v) && s.items) for (let i = 0; i < v.length; i++) { const e = checkSchema(v[i], s.items, path + '[' + i + ']'); if (e) return e; }
  if (typeof v === 'string') { if (s.minLength && v.length < s.minLength) return path + ' too short'; if (s.maxLength && v.length > s.maxLength) return path + ' too long'; }
  return null;
}
