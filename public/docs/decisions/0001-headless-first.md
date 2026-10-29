# 0001. Headless first

- Status: Accepted
- Date: 2026-10-23

## Context
Residents and organizers work in many tools: browsers, chat assistants, Slack, spreadsheets. A platform built screen-first ends up with logic only the screen can reach, and every other client gets less.

## Decision
Every capability is an API operation and an MCP tool before it has a screen. The web pages are clients of the same API with no private path. Today that means `/api/v1/precinct` and `/api/v1/your-area`, the same two operations as MCP tools at `/mcp`, and `public/your-area.html` calling the API.

## Consequences
- An assistant connected over MCP can do what the page does.
- New features start with a schema, not a layout.
- The API must carry provenance and plain-language reasons, because a client may show only the data.
- Identity by key (OAuth) is planned; until then everything is public and read-only.
