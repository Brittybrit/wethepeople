import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

// Two projects, one runner, Jest syntax in both:
//   unit:   lib/ and scripts on Node (fast, no network).
//   worker: the Worker itself inside the Workers runtime (workerd) with its real bindings from wrangler.toml.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/generated/**/*.test.mjs', 'tests/hand/**/*.test.mjs'], environment: 'node' } },
      { plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.toml' } })], test: { name: 'worker', include: ['tests/worker/**/*.test.mjs'] } }
    ]
  }
});
