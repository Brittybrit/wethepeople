# Architecture: headless first, cheapest tier first

Principles: headless first; route every operation to the cheapest service that can do it; cache; AI-first; platform agnostic and portable. This is the contract the code is built against.

## Status as of Oct 29, 2026
This document is the target. What is built today: the Worker (a plain fetch handler; Hono is planned), Your area and the precinct lookup, one schema generating OpenAPI and the MCP tools, trace ids on responses, the Events, Cache and Model adapters, the test generator and eval harness. Planned: Hono, the Store, Blobs, Queue and Auth adapters, an Analytics Engine sink (events go to the console today), per-key spend caps and confidence-based escalation, provenance hashes and retrieved-at on every response, UI types from the schema, and every service in section 4 except the read path. `ai/system-card.md` and `decisions/` track what changes.

## 1. Headless first
- Every capability exists as an API endpoint and an MCP tool before it has a screen. The UI is a client with no privileged path; if the UI can do it, a Slack bot can do it.
- One schema, three outputs: the OpenAPI document, the MCP tool manifest and the UI's types are generated from the same source. No hand-written drift.
- Identity is a key, not a session. Keys are issued by OAuth sign-in (Google, Apple) or by the org-tier admission flow. Public reads need no key.
- Every response carries provenance (source URL, retrieved-at, content hash) and epistemic fields (match kind, timing, confidence as a count). A client that strips them is violating the terms, not the API.

## 2. The cost ladder (routing)
Every operation is a task with an input, a required output shape and a confidence threshold. The router tries tiers in order and stops at the first that meets the threshold. Every result is stamped with the tier that produced it, its cost and its provenance, so the ledger shows what the money bought.

| Tier | What | Cost | Use for |
|---|---|---|---|
| 0 | Committed data served from the edge (static JSON, ETag, CDN cache) | free | anything already computed at build time |
| 1 | Deterministic code: parsers, regex, name normalization, joins, rules, SQL | free | matching, filtering, date math, relevance tags from structured packets, roll-call parsing |
| 2 | Cache: edge Cache API for GETs, KV for computed cards, R2 for source snapshots, D1 for the ledger | near free | anything computed once per data release or per source change; keyed by content hash, invalidated by release |
| 3 | Small model with structured output (Haiku, or Workers AI for classification and embeddings) | cents | extraction from unstructured packets, classification, entity resolution candidates, summaries of one document |
| 4 | Large model (Sonnet; Opus only for judicial screens and plans) | dimes | synthesis across sources, the planner, anything a person will act on without reading the source |
| 5 | Human: a browser session at the Mac, a records request, a hand-check | hours | portals that block machines, charters, disclosures, anything the record does not say |

Rules:
- A task never starts at tier 3 or above if tier 1 can answer it. The ledger's 1,365 actions and 2,308 ties were built this way; keep it.
- Tier 3 and 4 calls take a schema and return JSON validated against it; a response that fails validation is retried once at the same tier, then escalated, never patched by hand.
- Escalation is on measured confidence (validation failure, low match score, "no stated impact"), not on vibes. Downgrade is automatic: when a tier 3 extraction has run on the same content hash before, the cached result wins.
- Every tier 3+ call is logged with model, tokens, cost, task type and content hash (the existing usage ledger, extended). A weekly line shows cost per task type; anything that grows gets pushed down a tier.
- Spend caps per key and per worker. Every service gets its own key.

## 3. Platform agnostic and portable
The platform must run on Cloudflare today, on a laptop tomorrow, and on another county's host next year without rewriting logic. Ports and adapters:
- Core logic (parsers, joins, routing, relevance, planner prompts) is plain JavaScript with no runtime imports. It runs on Workers, Node, Bun, Deno or a browser. The HTTP layer is Hono, which runs on all of them.
- Every outside dependency is behind an interface with at least two adapters from day one: Store (SQLite file, D1, Postgres), Blobs (filesystem, R2, S3), Cache (in-memory, KV, Redis), Queue (in-process, Cloudflare Queues, SQS), Model (Anthropic, OpenAI, a local model through an OpenAI-compatible endpoint), Auth (Google, Apple, email magic link). Config picks the adapter; code never names a vendor.
- The ledger's canonical format is SQLite plus committed JSON. D1 is SQLite, so the production database is a file anyone can download, open, and run the platform from. A data release is a tarball: the SQLite file, the JSON, the source snapshots and the migration.
- Standards over products: OpenAPI for the API, MCP for tools, OAuth for sign-in, JSON Schema for every model output, CC BY for data. Another county forks the repo, points config at its sources, deploys to any host.
- The cost ladder applies across providers too: the Model adapter takes a routing table (task type to candidate models with price and quality), so the cheapest adequate model wins whether it is Haiku, a Workers AI model, or a local one. Prompts are written against the schema, not a vendor's quirks; the eval set says whether a swap holds.
- Nothing load-bearing lives only in a vendor console: secrets are named in config, schedules are in the repo, and operational state exports to a file.

## 4. Services (one process each, joined by in-process bindings where the host allows, otherwise HTTP)
- records: ingestion. Fetches sources on a schedule (queue-driven), stores a snapshot in R2 under its content hash, emits a "source changed" event. Does no interpretation.
- ledger: the API. Serves actions, ties, people, cycles, upcoming, procurement, payments, connections from D1 and committed JSON. Read-only. This is today's src/api.js, moved.
- resolve: entity resolution and the money join (vendor, lobbyist, donor, member). Tier 1 first, tier 3 for candidates, every confirmed link cites a record.
- relevance: computes "what it means for you" tags from each item's packet and scores them against a precinct and a "what you bring" profile. Tier 1 where the packet is structured, tier 3 where it is prose.
- planner: /plan. Takes goal, precinct, capacity and standing; returns cited milestones tied to item ids. Tier 4, but every input it gets comes from tiers 0 to 2 so the call is small.
- notify: watchlists and alerts for the org tier; diffs new releases against watchlists; webhooks and email.
- identity: OAuth sign-in, key issuance, org-tier admission, per-key limits.
On Cloudflare: Workers joined by service bindings (free, in-process) and Queues for ingestion fan-out; D1 for the ledger, R2 for snapshots, KV for the hot cache, Vectorize for embeddings when semantic search is needed. On a laptop: one Node process, SQLite, the filesystem, an in-memory cache and queue. Same code, different adapters.

## 5. Data flow
1. records fetches a source on its cadence (monthly for calendars, weekly for agendas, nightly for filings), hashes it, stores it, emits an event if the hash changed.
2. resolve and relevance subscribe; they compute only for changed content, write results keyed by content hash.
3. A data release is a commit: the committed JSON plus the D1 migration. Caches invalidate on release, not on a clock.
4. ledger serves the release. notify diffs it against watchlists. planner and the UI read ledger only.
Durability rule (unchanged): no card exists unless a committed script can rebuild it from the stored snapshot.

## 6. AI-first conventions
- Prompts are versioned files in the repo with the schema they must return; a prompt change is a pull request with an eval run.
- Evals in CI: see section 7. Every tier 3 and 4 prompt has a pass rate that must not fall; generated unit tests cover tiers 0 to 2.
- Tools, not pages: the MCP server exposes read tools (now, upcoming, ties, people, cycles, procurement, payments, connections), the planner, and for keyed users watchlists. An assistant that connects to it can do everything the UI can.
- The model never sees a source it cannot cite. Inputs to tier 3 and 4 are records with URLs; outputs must reference them; an output that cites nothing is dropped.
- No model output is stored as fact. It is stored as a candidate with its tier and content hash until a rule or a person confirms it.

## 7. Testing: generated suites and prompt evals in one workflow
Goal: reduce manual testing overhead by having models write the test suites, and treat prompt engineering like software: versioned, tested in CI, merged on a passing run.
- Test runner: Jest-style tests (describe, it, expect). The runner is Vitest with the Cloudflare Workers pool, because it runs the same syntax inside the Workers runtime and on Node, which keeps the portability promise testable. Existing node:test files migrate as they are touched.
- Generated unit tests: for every module, a generation step reads the source and its JSON schemas and writes the suite (happy path, each branch, each error, boundary values, property-style cases for parsers and matchers). Generated tests are committed, reviewed like code, and regenerated when the module changes; a human adds the cases the generator missed and those are kept as hand-written files that never get overwritten. Coverage is reported per module and the generator is pointed at the gaps.
- Generated fixtures from real records: the generator draws inputs from stored source snapshots (an agenda PDF, a roll call, a lobbyist filing) so tests exercise real shapes, not invented ones.
- Prompt evals as tests: every prompt file has an eval file beside it in the same runner. Cases are labeled examples drawn from the ledger (known ties, known roll calls, known relevance tags, known "no stated impact"). Assertions are schema validity, exact fields where the answer is a fact, and a grader (a cheap model with a rubric) only where the answer is prose. Each eval reports pass rate, cost and latency; CI fails if pass rate drops below the file's floor or cost rises above its ceiling. A prompt change, a model swap and a routing change all run the same evals.
- The eval set grows from production: every tier 3 or 4 output a person confirms or corrects becomes a labeled case. Corrections are the most valuable rows.
- CI order on every push: lint, unit (tiers 0 to 2, fast, no network), contract (OpenAPI and MCP manifest match the schema), evals (tiers 3 and 4, with cached model outputs keyed by prompt version plus input hash so unchanged prompts cost nothing), then deploy.
- The generator itself is a tier 3 task with a schema (test file as structured output), logged in the usage ledger like everything else.

## 8. Instrumentation, tracing and decision records
Everything is instrumented for granular reporting so the numbers answer product, operations, sales and marketing questions without a research project, and every decision the system makes is traceable to its inputs and joinable to its outcome so decision quality is measured, not guessed.
- One event shape everywhere: `{ts, event, service, tier, task, cost, latency_ms, ok, precinct, body, item, key_tier, client, props}`. Services emit through an Events adapter (console and SQLite locally; Cloudflare Analytics Engine in production; any OpenTelemetry sink elsewhere). Same portability rule as the rest.
- Privacy by construction: events carry a precinct, a body and an item id, never an address, a name, a ballot pick, an email or an IP. Keys are hashed. Demographic eligibility answers are never emitted; the layers share a screen, not a table. Anything that would identify a resident does not have a field to land in.
- What is emitted, by question it answers:
  - Product: which cards are opened, which levers get tapped, which plans get made and which steps get logged done, where onboarding stops, "no stated impact" rate per body (the data gap list writes itself), search terms with no result.
  - Operations: cost and latency per task per tier per model, cache hit rate by key type, escalation rate (how often tier 1 handed off to tier 3), source freshness per body (days since last successful fetch), portal failures by system (Legistar, Granicus, Municode), records-request turnaround.
  - Sales (the org tier): API calls per key, endpoints used, watchlists set, alerts delivered and opened, bulk pulls, which organizations hit their limits, time from admission to first alert.
  - Marketing: traffic by referrer and client (site, MCP, a named integration), ballot uploads per day, share and send taps, digest opens and clicks, which bodies and items draw the most attention by week, press-page views.
- Reporting: a nightly job rolls events into a small reporting store (SQLite file in R2 or a D1 table) with one row per day per dimension; the dashboards read that, never the raw stream. Each audience gets one page: product funnel and gaps, ops cost and freshness, org-tier usage and limits, acquisition and engagement. The cost ledger (section 2) is the same stream filtered to tier 3 and above, so cost per feature is a query, not an estimate.
- Actionable means a threshold: each dashboard line has an owner and a rule (escalation rate above 20% on a task type, a body with no successful fetch in 35 days, an org key at 90% of its limit, a card type with under 5% open rate) that opens a ticket.
- Traces: every request gets a trace id; every tier attempt, cache lookup, model call, source fetch and rule evaluation is a span with parent, start, duration, tier, cost and a result code. Spans carry the content hashes of their inputs and outputs, so any card can be walked back to the exact source snapshot and prompt version that produced it. Trace ids ride on API responses (a header) and on MCP tool results, so a client's complaint comes with the trace.
- Decision records: every point where the system chose is logged as a decision, not just an event: `{decision_id, trace_id, kind, inputs_hash, candidates, chosen, tier, model, prompt_version, confidence, rationale_hash, ts}`. Kinds: a routing choice (which tier), an extraction (what the packet says), a match (this vendor is that donor), a relevance tag, a planner step, an alert fired, a lead escalated for review. The rationale is stored (model text or rule name) and hashed so it can be audited without being re-run.
- Outcomes join to decisions: a person's confirmation or correction on a card, a plan step logged done or skipped, an item's vote result, a records request answered, an alert acted on, a source later contradicting an extraction. Each is an outcome row `{decision_id, outcome, source, ts}`. Decision quality is the join: precision and recall per decision kind per tier per prompt version, calibration (did 80% confidence hold 80% of the time), time to correction, cost per correct decision. The eval set (section 7) is seeded from the same join, so what production gets wrong becomes what CI tests next.
- Lineage on the data side: every row in the ledger carries the decision id that produced it and the snapshot hash it came from. A release note is a query: which decisions changed, by which prompt version, at what cost, with what measured quality.
- Tests cover events: generated suites assert that each handler emits its event with the right fields, and the eval harness emits the same shape, so eval cost sits beside production cost.

## 9. Caching, concretely
- GET responses: ETag from the content hash of the data release; Cache-Control public with a short max-age and long stale-while-revalidate; the edge Cache API in front of the Worker.
- Computed cards (relevance, budget map, base rates): KV, key = task type + content hash of inputs, no TTL, invalidated by release.
- Model outputs: KV, key = prompt version + model + content hash of input. A repeated question on the same packet costs nothing.
- Source snapshots: R2, immutable, key = content hash. Re-fetch compares hashes before doing anything else.

## 10. Where Ballot305 fits
Ballot305 is a client. It calls ledger over HTTPS (or a service binding once both live in the same account) and never reads the platform's storage. The Nov 3 site stays as it is until after the election; then its research path moves behind the same router.

## 11. Build order
1. The test workflow and the Events adapter: Vitest with the Workers pool, the test generator (source plus schema in, suite out), the eval harness (prompt file plus labeled cases in, pass rate and cost out), the event shape with local and Cloudflare sinks, wired into CI. Everything after this is built with them.
2. The adapter interfaces (Store, Blobs, Cache, Queue, Model, Auth) with the local and Cloudflare implementations and generated suites that run against both.
3. Move src/api.js into the ledger service here on Hono; generate OpenAPI and the MCP manifest from one schema; MCP server over it.
4. records service with R2 snapshots and the content-hash contract; move the existing pipelines (cycles, contacts, upcoming, leads) behind it.
5. The router library and the usage ledger extension (tier, cost, task type, content hash), used by every tier 3+ call.
6. D1 schema for the ledger; migrate the committed JSON; releases as migrations.
7. relevance and resolve as services; evals in CI.
8. identity (OAuth keys) and notify (watchlists, alerts) for the org tier.
9. planner.
10. UI: the citizen front door and the organizer workspace, both pure clients of the API.
