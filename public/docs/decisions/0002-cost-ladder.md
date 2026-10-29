# 0002. Route every operation to the cheapest tier that can do it

- Status: Accepted
- Date: 2026-10-23

## Context
Model calls cost money and add error. A one-person nonprofit project cannot carry open-ended spend, and residents deserve answers that can be checked.

## Decision
Tiers, in order: 0 static files, 1 code and rules, 2 cache, 3 small model with a schema, 4 large model, 5 a person. A task starts at the lowest tier that can answer it. Tier 3 and 4 calls go through `lib/model.mjs`, which reads the routing table in `config/models.json`, validates JSON against a schema, retries once, then falls to the next model. Results are cached by prompt version and input hash.

## Consequences
- Public routes today use tiers 0 to 2 only.
- Every model task needs a schema and an eval file.
- Each call is logged with model, tier, cost and input hash, so cost per task is a query.
- Swapping providers is a config change checked by evals.
- Planned: per-key and per-worker spend caps, and a usage ledger in D1.
