// Cache adapters: get(key) -> value|null, put(key, value, {ttl}) . Keys are content hashes; no TTL unless given.
export const caches = {
  memory() { const m = new Map(); return { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, size: () => m.size }; },
  dir(path, fs) {
    const f = k => path + '/' + k.replace(/[^\w.-]/g, '_') + '.json';
    return {
      async get(k) { try { return JSON.parse(await fs.readFile(f(k), 'utf8')); } catch { return null; } },
      async put(k, v) { await fs.mkdir(path, { recursive: true }); await fs.writeFile(f(k), JSON.stringify(v)); }
    };
  },
  kv(binding) { return { async get(k) { return binding.get(k, 'json'); }, async put(k, v, o = {}) { await binding.put(k, JSON.stringify(v), o.ttl ? { expirationTtl: o.ttl } : {}); } }; }
};
