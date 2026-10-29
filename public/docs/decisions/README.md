# Architecture decision records

Short records of choices that shape the platform. Each has a status, a date, the context, the decision and its consequences. To change a decision, add a new record that supersedes the old one.

- 0001-headless-first.md: every capability is an API operation and an MCP tool before it has a screen
- 0002-cost-ladder.md: route every operation to the cheapest tier that can do it
- 0003-do-now-by-rules-not-model.md: the do-now list comes from four fixed rules
- 0004-ballot305-source-adapter.md: Ballot305 is read through one adapter
- 0005-address-never-stored.md: an address is passed through and never stored
- 0006-money-figures-stay-on-ballot305.md: money is shown only with full context, on Ballot305
- 0007-mcp-and-openapi-from-one-schema.md: OpenAPI and MCP tools are generated from one schema
