import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

// Two projects, one runner, Jest syntax in both:
//   unit:   lib/ and scripts on Node (fast, no network).
//   worker: the Worker itself inside the Workers runtime (workerd) with its real bindings from wrangler.toml.
//           The accounts migrations are passed in as TEST_MIGRATIONS so a test can apply them to the local D1.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/generated/**/*.test.mjs', 'tests/hand/**/*.test.mjs'], environment: 'node' } },
      { plugins: [cloudflareTest(async () => ({ wrangler: { configPath: './wrangler.toml' }, miniflare: { d1Databases: ['DB_WETHEPEOPLE305_ACCOUNTS'], bindings: { TEST_MIGRATIONS: await readD1Migrations('./migrations') } } }))], test: { name: 'worker', include: ['tests/worker/**/*.test.mjs'] } }
    ]
  }
});
