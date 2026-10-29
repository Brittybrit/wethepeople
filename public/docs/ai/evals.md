# Evals and testing policy

Prompts are code. They are versioned, tested in CI, and merged on a passing run.

## What runs in CI
On every push and pull request (`.github/workflows/test.yml`):
1. `pnpm install --frozen-lockfile`
2. `pnpm lint`: syntax check of `src/worker.js`, `lib/model.mjs`, `lib/events.mjs`.
3. `pnpm test`: two Vitest projects. `unit` runs `tests/generated/` and `tests/hand/` on Node. `worker` runs `tests/worker/` inside the Workers runtime with the real `wrangler.toml` bindings. No network calls to outside sources.
4. `pnpm eval`: every prompt in `prompts/` against its eval file. Runs only when the `ANTHROPIC_API_KEY` repo secret is set. The `.cache/` folder is restored between runs, keyed by a hash of `prompts/` and `config/models.json`.

Not in CI yet (planned): a contract step that checks the OpenAPI document and MCP tool list against `lib/api-schema.mjs` as its own stage, coverage per module, and deploy. Contract tests run today inside `pnpm test`.

## Floors and ceilings
Each `prompts/<name>.eval.json` sets:
- `floor`: minimum pass rate. Default 1 if missing.
- `ceiling_usd`: maximum cost of one full run. No ceiling if missing.

`scripts/eval.mjs` fails the run if any prompt is under its floor or over its ceiling.

| Prompt | Cases | Floor | Ceiling |
|---|---|---|---|
| relevance-tags | 7 | 0.8 | $0.05 |

## How a case is checked
- `equals`: the field must match exactly.
- `includes`: each listed value must be present.
- `excludes`: each listed value must be absent.
- `schema`: the output must validate against an extra schema.
- `rubric`: a cheap model grades prose against the rubric (task `grade`). Use only where the answer is prose.

## Caching
Model outputs are cached in `.cache/model/` by task, prompt version and a hash of the prompt, input and schema. An unchanged prompt costs nothing to re-run. A changed prompt re-runs only its own cases. Cached results do not prove a model still behaves the same; bump the version or clear the cache to force a fresh run.

## How cases grow
- Every time a model output is wrong in review or production, the input and the right answer become a case.
- Corrections are the most valuable cases. Do not remove a case to pass a floor.
- Planned: confirmations and corrections recorded as outcomes against decision records, and new cases seeded from that join.

## Generated tests
- `pnpm test:gen lib/x.mjs` drafts a suite into `tests/generated/x.test.mjs`. It skips when the module's hash matches the header of the existing file.
- Generated tests are reviewed and committed like code. A test that locks in a bug is deleted, not kept.
- Hand-written cases go in `tests/hand/`. The generator never writes there.

## Add a prompt
1. `prompts/<name>.md` with a header: `version:`, `task:` (a task in `config/models.json`), `schema:` (a file name).
2. `prompts/<name>.schema.json`: the JSON Schema the output must match. Use `additionalProperties: false`.
3. `prompts/<name>.eval.json`: `floor`, `ceiling_usd`, a `note`, and `cases` with `id`, `input`, `expect`. Start with at least 5 cases from real records, including one where the right answer is empty.
4. A prompt card in `public/docs/ai/prompt-cards/<name>.md`.
5. Run `pnpm eval <name>` and put the result line in the pull request.
