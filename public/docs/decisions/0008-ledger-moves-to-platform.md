# 0008. The ledger moves to the platform

- Status: Accepted
- Date: 2026-10-29

## Context
The ledger (officials, official actions, roll calls, gifts tied to actions, calendars, posted agendas, procurement, payments, connections, contacts) is built and served by Ballot305 today, at `ballot305.org/api/v1`, from JSON committed in its repo. Architecture section 4 makes the ledger a platform service and section 11 step 3 moves Ballot305's `src/api.js` here. The founder wants the platform to own the data now. The election is Nov 3, 2026, so Ballot305 must not change before then.

## Decision
Phase 1 (now): copy and serve.
- `scripts/sync-ballot305-data.mjs` copies the files the API reads from a Ballot305 checkout into `public/ledger-data/` and records the Ballot305 commit and copy time in `SOURCE.json`. It is idempotent and refuses a file over the 25 MiB static asset limit. The workflow `sync-ledger-data.yml` runs it hourly and on demand, and commits only when data changed. It does not deploy.
- The data is served as static assets because the Worker reads it through the ASSETS binding, the same way Ballot305 does, and so the raw files that `/bulk` lists resolve here. `decisions.json` (28 MB) is not copied; its split (one index plus one file per body) is, as on Ballot305.
- `lib/ledger/` is `src/api.js` ported as plain JavaScript with the data passed in. HTTP is split out: the Worker routes, sets headers and loads the data once per isolate.
- The operations are in `lib/api-schema.mjs`, so they appear in OpenAPI and as MCP tools (`ledger_*`; bulk is HTTP only). Paths and bodies match Ballot305's. A parity test runs Ballot305's own `api.js` and the ledger over the same files and requires identical bodies.

Phase 2 (after Nov 3): Ballot305 becomes a client (section 10). It reads the ledger from this platform's API, with no shape changes. Then either the copy job reverses direction (Ballot305's pipelines write, the platform is the source of truth) or the pipelines move here behind the records service (section 11 step 4).

## Consequences
- The platform serves ledger data without calling Ballot305 at request time. `your_area` still reads Ballot305 through its adapter (0004) until phase 2.
- The copy lags Ballot305 by up to an hour plus the next deploy. Brit deploys; the sync job never does.
- The ledger API returns tie amounts and money summaries, as Ballot305's API does. Decision 0006 still governs screens and `your_area`: no bare figure. The API keeps every caveat field (`match`, `basis`, `timing`, `days`, `actionSplit`, summary denominators), and the docs ask clients to repeat them with any amount.
- The isolate holds the whole index in memory (about 60 MB built in Node, under the 128 MB isolate limit). A cold isolate spends a few hundred milliseconds building it. When the data outgrows that, it moves to D1 (section 11 step 6).
- Data stays CC BY 4.0 with attribution to Ballot305.
