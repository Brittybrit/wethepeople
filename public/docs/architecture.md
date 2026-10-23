# Architecture: headless first, cheapest tier first

Decided Oct 23, 2026 (Brit): start with headless in mind; route every operation to the cheapest service that can do it; cache; build it the modern, AI-first way; platform agnostic and portable. This is the contract the code is built against.

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
- Spend caps per key and per worker. The research worker and the board worker already have separate keys; every service gets its own.

## 3. Platform agnostic and portable
The platform must run on Cloudflare today, on a laptop tomorrow, and on another county's host next year without rewriting logic. Ports and adapters:
- Core logic (parsers, joins, routing, relevance, planner prompts) is plain JavaScript with no runtime imports. It runs on Workers, Node, Bun, Deno or a browser. The HTTP layer is Hono, which runs on all of them.
- Every outside dependency is behind an interface with at least two adapters from day one: Store (SQLite file, D1, Postgres), Blobs (filesystem, R2, S3), Cache (in-memory, KV, Redis), Queue (in-process, Cloudflare Queues, SQS), Model (Anthropic, OpenAI, a local model through an OpenAI-compatible endpoint), Auth (Google, Apple, email magic link). Config picks the adapter; code never names a vendor.
- The ledger's canonical format is SQLite plus committed JSON. D1 is SQLite, so the production database is a file anyone can download, open, and run the platform from. A data release is a tarball: the SQLite file, the JSON, the source snapshots and the migration.
- Standards over products: OpenAPI for the API, MCP for tools, OAuth for sign-in, JSON Schema for every model output, CC BY for data. Another county forks the repo, points config at its sources, deploys to any host.
- The cost ladder applies across providers too: the Model adapter takes a routing table (task type to candidate models with price and quality), so the cheapest adequate model wins whether it is Haiku, a Workers AI model, or a local one. Prompts are written against the schema, not a vendor's quirks; the eval set says whether a swap holds.
- Nothing load-bearing lives only in a vendor console: secrets are named in config, schedules are in the repo, and the admin board's state exports to a file.

## 4. Services (one process each, joined by in-process bindings where the host allows, otherwise HTTP)
- records: ingestion. Fetches sources on a schedule (queue-driven), stores a snapshot in R2 under its content hash, emits a "source changed" event. Does no interpretation.
- ledger: the API. Serves actions, ties, people, cycles, upcoming, procurement, payments, connections from D1 and committed JSON. Read-only. This is today's src/api.js, moved.
- resolve: entity resolution and the money join (vendor, lobbyist, donor, member). Tier 1 first, tier 3 for candidates, every confirmed link cites a record.
- relevance: computes "what it means for you" tags from each item's packet and scores them against a precinct and a "what you bring" profile. Tier 1 where the packet is structured, tier 3 where it is prose.
- planner: /plan. Takes goal, precinct, capacity and standing; returns cited milestones tied to item ids. Tier 4, but every input it gets comes from tiers 0 to 2 so the call is small.
- notify: watchlists and alerts for the org tier; diffs new releases against watchlists; webhooks and email.
- identity: OAuth sign-in, key issuance, org-tier admission, per-key limits.
- admin: the founder board (private repo).
On Cloudflare: Workers joined by service bindings (free, in-process) and Queues for ingestion fan-out; D1 for the ledger, R2 for snapshots, KV for the hot cache, Vectorize for embeddings when semantic search is needed. On a laptop: one Node process, SQLite, the filesystem, an in-memory cache and queue. Same code, different adapters.

## 5. Data flow
1. records fetches a source on its cadence (monthly for calendars, weekly for agendas, nightly for filings), hashes it, stores it, emits an event if the hash changed.
2. resolve and relevance subscribe; they compute only for changed content, write results keyed by content hash.
3. A data release is a commit: the committed JSON plus the D1 migration. Caches invalidate on release, not on a clock.
4. ledger serves the release. notify diffs it against watchlists. planner and the UI read ledger only.
Durability rule (unchanged): no card exists unless a committed script can rebuild it from the stored snapshot.

## 6. AI-first conventions
- Prompts are versioned files in the repo with the schema they must return; a prompt change is a pull request with an eval run.
- Evals in CI: a labeled set drawn from the ledger (known ties, known roll calls, known relevance tags). Every tier 3 and 4 prompt has a pass rate that must not fall. Plain unit tests cover tiers 0 to 2.
- Tools, not pages: the MCP server exposes read tools (now, upcoming, ties, people, cycles, procurement, payments, connections), the planner, and for keyed users watchlists. An assistant that connects to it can do everything the UI can.
- The model never sees a source it cannot cite. Inputs to tier 3 and 4 are records with URLs; outputs must reference them; an output that cites nothing is dropped.
- No model output is stored as fact. It is stored as a candidate with its tier and content hash until a rule or a person confirms it.

## 7. Caching, concretely
- GET responses: ETag from the content hash of the data release; Cache-Control public with a short max-age and long stale-while-revalidate; the edge Cache API in front of the Worker.
- Computed cards (relevance, budget map, base rates): KV, key = task type + content hash of inputs, no TTL, invalidated by release.
- Model outputs: KV, key = prompt version + model + content hash of input. A repeated question on the same packet costs nothing.
- Source snapshots: R2, immutable, key = content hash. Re-fetch compares hashes before doing anything else.

## 8. Where Ballot305 fits
Ballot305 is a client. It calls ledger over HTTPS (or a service binding once both live in the same account) and never reads the platform's storage. The Nov 3 site stays as it is until after the election; then its research path moves behind the same router.

## 9. Build order
1. The adapter interfaces (Store, Blobs, Cache, Queue, Model, Auth) with the local and Cloudflare implementations and a test that runs the suite against both.
2. Move src/api.js into the ledger service here on Hono; generate OpenAPI and the MCP manifest from one schema; MCP server over it.
3. records service with R2 snapshots and the content-hash contract; move the existing pipelines (cycles, contacts, upcoming, leads) behind it.
4. The router library and the usage ledger extension (tier, cost, task type, content hash), used by every tier 3+ call.
5. D1 schema for the ledger; migrate the committed JSON; releases as migrations.
6. relevance and resolve as services; evals in CI.
7. identity (OAuth keys) and notify (watchlists, alerts) for the org tier.
8. planner.
9. UI: the citizen front door and the organizer workspace, both pure clients of the API.
