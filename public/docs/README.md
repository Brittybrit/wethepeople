# We the People 305: working docs

These are the technical documents for We the People, kept in the open. `index.json` lists them in order. Edits by hand and pull requests are welcome.

- architecture.md: headless first, the cost ladder, services, portability, caching, AI-first conventions
- cycles-coverage.md: what the governance-cycle files cover per body and the known gaps
- api.md: the public API (precinct lookup, Your area)
- ai/system-card.md: what AI does and does not do in the platform, models, limits, what is logged
- ai/prompt-cards/relevance-tags.md: the relevance-tags prompt, its schema, eval and failure modes
- ai/ai-use-policy.md: rules for AI use binding on contributors and the platform
- ai/data-card.md: the data served, sources, license, coverage, gaps, freshness, corrections
- ai/evals.md: what runs in CI, floors and ceilings, how to add a prompt
- identity.md: sign-in and accounts (passkeys, optional Google), what is stored, setup for Google and D1, granting admin
- organizer-criteria.md: DRAFT criteria for the organizer role and how applications are reviewed
- security/threat-model.md: assets, trust boundaries, threats and mitigations with status
- decisions/: architecture decision records (index in decisions/README.md)
- privacy.md: what the site does with your address and what it records
