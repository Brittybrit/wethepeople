# 0004. Read Ballot305 through one source adapter

- Status: Accepted
- Date: 2026-10-29

## Context
The researched data (officials, calendars, ways to take part, posted items) lives in Ballot305 today and is served by its public API under CC BY 4.0. It will move into this platform after the election. The move should not touch feature code.

## Decision
`lib/sources/ballot305.mjs` is the only code that reads Ballot305. It exposes `now`, `upcoming` and `precinctCodes`, takes an injected `fetch`, and carries the license and attribution. The Worker passes a fetch that caches upstream reads at the edge for 15 minutes.

## Consequences
- Swapping the source later means changing one file.
- Every response names the source, license and methodology.
- Ballot305 outages and errors reach residents as a 502, softened by the 15 minute cache.
- Ballot305 stays a separate site; this platform never writes to it.
