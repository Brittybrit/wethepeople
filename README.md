# We the People 305

Civic intelligence for Miami-Dade: who decides, what is coming up, what it means for you, and what you can do about it. For citizens and for organizers, with a UI and headless (API and MCP). Open source under MIT.

Today: the holding page at wethepeople305.org and the planning docs at wethepeople305.org/docs (`public/docs/`). The data and API currently run at ballot305.org/api/v1 (github.com/Brittybrit/vote-informed) and move here as the platform is built.

## Working on it
- `pnpm install`, then `pnpm test` runs both projects: unit (lib/, Node) and worker (the Worker inside the Workers runtime). Jest syntax, Vitest runner.
- `pnpm test:gen lib/x.mjs` has a model write the test suite for a module into `tests/generated/` (needs `ANTHROPIC_API_KEY`). Hand-written cases go in `tests/hand/`, never overwritten.
- `pnpm eval` runs every prompt in `prompts/` against its labeled cases and fails on a pass rate below the floor or cost above the ceiling. Outputs are cached in `.cache/` by prompt version and input hash.
- `lib/` is plain JavaScript with no runtime imports: hashing, events and traces, cache adapters, the model adapter with routing (`config/models.json`). See `public/docs/architecture.md`.
- Deploy: `npx wrangler deploy`. Secrets, when needed: `npx wrangler secret put NAME`.

Contributions welcome: open an issue or a pull request. The organizer tier charges for timeliness and tooling, never for code or for facts the public cannot get.
