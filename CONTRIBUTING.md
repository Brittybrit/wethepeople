# Contributing

Issues and pull requests are welcome. Read `public/docs/architecture.md` first; it is the contract. Coding agents also read `AGENTS.md`.

## Setup
- Node 22 and pnpm 10.
- `pnpm install`
- `pnpm test`: unit tests on Node and Worker tests inside the Workers runtime. Must pass.
- `pnpm lint`: syntax check.
- `pnpm eval`: prompt evals. Needs `ANTHROPIC_API_KEY`.
- `pnpm test:gen lib/x.mjs`: a model drafts a test suite into `tests/generated/`. Needs `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.
- `pnpm build:llms`: rebuilds `public/llms-full.txt` after you change a doc listed in `public/docs/index.json`. A test fails if it is stale.
- `npx wrangler dev`: local server.

Only the maintainer deploys.

## Prompts and evals
- A prompt lives in `prompts/` with its schema and eval file beside it.
- Any change to a prompt, a schema, `config/models.json` or the model order bumps the prompt's `version:` and runs `pnpm eval`. Paste the result line in the pull request.
- A pull request that lowers a floor or removes a case must say why.
- See `public/docs/ai/evals.md` and `public/docs/ai/ai-use-policy.md`.

## AI-assisted contributions
Welcome. Say so in the pull request: which tool, and which parts it wrote. AI-written code and tests are reviewed like any other code. You are responsible for what you submit.

## Rules
- Names say what they are. Every file, field, secret and route is named for what it is and what uses it. Rename everywhere in one change.
- Privacy: events have no field for an address, name, email, phone or IP. `lib/events.mjs` rejects them. Do not add one, and do not log an address anywhere.
- Nonpartisan: the same fields, wording and rules for every official and party.
- Outside data comes in through an adapter in `lib/sources/`.
- `lib/` stays plain JavaScript with no runtime imports.
- Writing: plain language, short sentences, no em dashes.

## Commit messages
- First line: what changed, in plain words, under about 72 characters. No prefix needed.
- Then a blank line and short bullets for anything a reviewer needs.
- One change per commit where you can.
- Do not rewrite published history.

## Conduct
See `CODE_OF_CONDUCT.md`. Security issues go to `SECURITY.md`, not to issues.
