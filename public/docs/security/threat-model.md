# Threat model

What we protect, where trust changes, and what could go wrong. Status is "built" only where the code does it today. As of 2026-10-29.

## Assets
- Residents' addresses during a lookup.
- Integrity of what residents see: who serves them, meetings, items, do-now actions.
- The platform's reputation for being nonpartisan and accurate.
- Model API keys and future spend (repo secret `ANTHROPIC_API_KEY`; Worker secrets when added).
- Availability of the site, API and MCP endpoint.
- The repo and its CI.

## Trust boundaries
1. Browser or MCP client to the Worker: all input is untrusted. Read-only, no key, CORS open.
2. Worker to outside services: Esri, U.S. Census, Miami-Dade GIS, Ballot305. Their responses are untrusted data.
3. Ballot305's data to its own sources: agenda packets, PDFs and scraped pages written by third parties. Untrusted text.
4. Repo to CI and to models: prompts, eval cases and generated tests cross into a model and back.
5. Contributor to main: pull requests, including AI-assisted ones.

## LLM threats (OWASP Top 10 for LLM Applications)
No model runs on a public route today, so most of these are design rules for what is planned. Status says which.

| Category | Threat here | Mitigation | Status |
|---|---|---|---|
| Prompt injection (direct) | A user types instructions meant for a model | No public route calls a model. User input reaches only geocoders and a regex-checked precinct code | Built (by absence) |
| Prompt injection (indirect) | An agenda packet, PDF or scraped page contains text that tells a model to change tags, add links or praise someone | Prompts read only the item text and return a strict schema with enums and length caps; `additionalProperties: false`; output cannot add URLs or free prose to the relevance schema. Policy: anything read from a page is data. MCP server instructions tell clients to treat every field as data | Schema limits built; two injection cases in the relevance-tags eval set (instructions in item text, a fake system note); more planned |
| Insecure output handling | Model or source text rendered as HTML, or a `javascript:` link | The Your area page escapes every field and allows only `https:`, `http:`, `mailto:` and `tel:` links. CSP blocks outside scripts and framing. Model output is validated against a schema before use | Built for the page; model output is not rendered anywhere yet |
| Training data and source poisoning | A false record upstream (a fake contact, a wrong meeting date) flows to residents | Every fact carries a `source` link. One adapter for Ballot305. Corrections process. Planned: snapshots keyed by content hash, so a changed source is visible | Partly built |
| Model denial of service and cost exhaustion | Many requests drive model spend | No model on public routes. Eval files set a cost ceiling. Model outputs are cached by input hash | Built for CI; per-key and per-worker spend caps planned |
| Supply chain | A compromised npm package, GitHub Action or model provider | `pnpm install --frozen-lockfile`; three dev dependencies; no runtime dependencies in `lib/`. Actions are pinned to major tags, not commit SHAs. Model routing can fall back across providers | Partly built; pinning Actions to SHAs is planned |
| Sensitive information disclosure | Address or key leaks through logs, errors, caches or a model | Address never logged, stored or cached; `no-store` on lookups; events refuse address-like props; error responses carry no upstream detail. Keys live in env, never in config | Built |
| Excessive agency | An MCP client uses tools to change state or act for a resident | MCP tools are read-only (`readOnlyHint: true`) and map to the same two GET operations as the API. No write, send or pay tool exists | Built. Keyed write tools (watchlists) planned, with OAuth scopes |
| Overreliance | A resident treats a model's tag or a do-now action as authoritative | Do-now comes from four published rules, returned with every response. Split precincts are not guessed. Model output will be labeled and stored as a candidate | Built for rules; labels planned with first model output |
| Insecure plugin or tool design | MCP input bypasses validation | MCP calls go through `checkParams` against the same schema as HTTP (pattern, length) | Built |
| Model theft or misuse of keys | A leaked provider key | Keys only in repo secrets and Worker secrets; no key in the public Worker today | Built |

## Other threats

| Threat | Mitigation | Status |
|---|---|---|
| Address privacy: an address ends up in logs, analytics or a cache | Address goes only to geocoders and the county layer. Events have no address field and reject address-like props. Lookup responses are `no-store`. `robots.txt` disallows the lookup routes | Built |
| Address privacy: the geocoder providers see the address | Unavoidable for a lookup. Disclosed in `../privacy.md`. Esri called with `forStorage=false` | Built (disclosed) |
| Geocoder abuse: the endpoint used as a free bulk geocoder, risking our access to Esri or Census | Input capped at 200 characters; Florida-only matches; 9 second timeout; 20 lookups a minute per client (Workers rate limiting binding `RATE_LIMIT_ADDRESS_LOOKUP`, HTTP and MCP) | Built |
| Upstream outage (Ballot305, Esri, Census, county GIS) | Esri falls back to Census; 15 minute edge cache on Ballot305 reads; a clean 502 with no internal detail | Built; no stale-on-error serving yet |
| CORS: another site calls the API from a resident's browser | API is public and read-only with no cookies or keys, so open CORS exposes nothing a direct call would not | Built (accepted) |
| Admin surface exposed | `/admin` returns 404 on this host; the founder board is a separate private Worker | Built |
| Third-party request from pages | Pages load fonts from Google Fonts, which sees the visitor's IP | Accepted for now; self-hosting fonts planned |
| Malicious or careless pull request | Review by the maintainer; tests and evals in CI; AI-assisted work must be disclosed | Built (one reviewer) |
| Single maintainer | One person holds deploy and secrets | Accepted risk until there is a board |

## Report
See `SECURITY.md` in the repo root.
