# 0007. MCP tools and OpenAPI come from one schema

- Status: Accepted
- Date: 2026-10-29

## Context
An API document, an MCP tool list and the handlers written by hand drift apart. An assistant then calls a tool that no longer matches the API, or validation differs between the two.

## Decision
`lib/api-schema.mjs` defines each public operation once: id, method, path, parameters with JSON Schema, response schema, errors, and whether it sends personal data. From it:
- `openApi()` builds the OpenAPI 3.1 document at `/api/v1/openapi.json`.
- `mcpTools()` builds the MCP tool list served by `lib/mcp.mjs` at `/mcp` (stateless Streamable HTTP, JSON responses). Tools are marked read-only.
- `checkParams()` validates input for both HTTP and MCP calls.
The Worker runs one handler per operation id for both.

## Consequences
- A new operation is added in one place, then given a handler.
- HTTP and MCP return the same data with the same validation.
- Contract tests check the generated outputs against the schema.
- The UI's types are not generated yet (planned).
