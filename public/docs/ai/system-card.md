# AI system card

What AI does in We the People 305 today, what it does not do, and how to report a problem. This describes the code as of 2026-10-29. Planned work is marked "planned".

## Summary
- No model runs when a resident uses the site, the API or the MCP tools. Precinct lookup, Your area and the do-now list are code and fixed rules.
- Models run only in development and CI: the relevance-tags prompt (in its eval), the test generator, and the eval grader.
- Every model call goes through one adapter, `lib/model.mjs`, with a routing table in `config/models.json`.

## Where a model is used

| Use | Task (tier) | Runs where | Input | Output | Who reviews |
|---|---|---|---|---|---|
| Relevance tags for an agenda item | `classify` (3) | `pnpm eval` only; not wired into any route | One agenda item's text | JSON: `tags`, `stated_impact`, `industries`, `place` (schema in `prompts/relevance-tags.schema.json`) | Eval assertions; not shown to residents |
| Test generator | `test-gen` (3) | `pnpm test:gen` on a contributor's machine | One module's source, plus its schema file if present | A Vitest file in `tests/generated/` | The contributor and the pull-request reviewer, before it is committed |
| Eval grader | `grade` (3) | `pnpm eval`, only for cases with a `rubric` | Rubric and answer | JSON: `pass`, `why` | No current eval case has a rubric, so this is unused today |

The Your area "reasons" on agenda items (in or near your area, spends public money, lobbyist, public hearing, acted on before) come from tags in Ballot305's data, mapped by code in `lib/your-area.mjs`. No model is called for them.

## The cost ladder
Every operation goes to the cheapest tier that can do it. See `architecture.md` section 2.

| Tier | What | In use today |
|---|---|---|
| 0 | Static files from the edge | Yes: pages, docs, brand |
| 1 | Deterministic code and rules | Yes: geocoder parsing, precinct match, Your area shaping, do-now rules |
| 2 | Cache | Yes: upstream reads cached 15 minutes at the edge; model outputs cached on disk in `.cache/` for evals and test generation |
| 3 | Small model, structured output | Dev and CI only (table above) |
| 4 | Large model | Configured (`synthesize`, `plan`), not called anywhere |
| 5 | Human | Research and hand-checks behind the Ballot305 data |

## Models configured
From `config/models.json`. Prices are USD per million tokens, input/output.

| Model | Provider | Price | Tasks that list it |
|---|---|---|---|
| claude-haiku-4-5 | Anthropic | 1 / 5 | test-gen, extract, classify, grade |
| gpt-4o-mini | OpenAI | 0.15 / 0.6 | test-gen, extract |
| local-small (qwen2.5:7b) | local OpenAI-compatible server | 0 | extract, classify |
| claude-sonnet-4-6 | Anthropic | 3 / 15 | synthesize, plan |

Routing: the adapter tries the task's models in order. It validates JSON output against the schema, retries once on the same model, then moves to the next model. A provider with no key is skipped. If every model fails, the call throws. Nothing is patched by hand.

## Human oversight
- Prompts, schemas, eval cases and the routing table are files in the repo. Changing any of them is a pull request.
- Generated tests are read and committed by a person. The generator never writes to `tests/hand/`.
- No model output reaches a resident today. Before one does, it must pass the rules in `ai-use-policy.md`: stored as a candidate, cited, disclosed, and reviewed by a person before anyone acts on it.

## Decisions made without a model
These run on every request and use no model.

- Precinct lookup (`lib/geo.mjs`): Esri World Geocoder first, accepted only for a Florida address-level match with score 90 or higher; else the U.S. Census geocoder, accepted only for Florida. The point must fall inside a Miami-Dade bounding box, then the county's precinct polygons give the precinct. A split precinct returns both codes and asks the resident to check their ballot or voter card.
- Do-now list (`lib/your-area.mjs`, `RULES`), at most one action per rule, in this order:
  1. Vote: an election phase for a body that represents the precinct starts within 30 days.
  2. Weigh in: the weightiest posted item whose meeting is still ahead and that involves a place, money, a lobbyist, a hearing or prior action. Written comment is preferred over speaking.
  3. Show up: the next regular meeting of the body closest to home that has a public-comment lever.
  4. Reach your representative: the district seat closest to home with a holder and contact, email before phone.
- Item weight: place 8, money 4, lobbyist 4, hearing 2, prior action 1. Ties go to the earlier meeting.
- Order of bodies: city, schools, county, state, federal.

The rules are returned in every Your area response (`rules`), so anyone can check why an action ranks where it does.

## Known limits and failure modes
- Relevance tags: the eval set is 7 cases, two of them prompt-injection checks. A pass rate on 7 cases says little. Expect missed tags on long or vague items, and `stated_impact` errors when a dollar figure is implied but not stated.
- The tag vocabulary in the prompt (fiscal, location, industry, household, lifestyle, procurement) is not the one Your area uses today (Ballot305's place, money, lobbied, hearing, history).
- The `confidence` stored on a model decision record is a placeholder (1 with a schema, 0.5 without), not a measured value.
- A model that returns valid JSON with wrong content passes schema validation. Only eval cases catch that.
- The test generator can write tests that assert current behavior, including bugs. Review is the control.
- Geocoding: the Census fallback estimates along a street range and can land across a precinct line. Esri is tried first for that reason.

## What is logged
- Each model call is a span (`model.call`: task, tier, model, attempt, latency, ok) and a decision record (model, prompt version, hashes of the inputs and of the output text). Cache hits emit `model.cache` with cost 0.
- Eval runs emit `eval.case` with cost, pass or fail, model and whether the result was cached.
- These events go to `.cache/events.jsonl` on the machine that ran them. They are not uploaded anywhere.
- The event shape has no field for an address, name, email, phone, ballot pick or IP, and `lib/events.mjs` rejects props with those names.
- The public Worker writes events to its console log: route spans with a precinct code, and errors. It does not log the address.

## Report a problem
- Wrong or harmful output, or a rule that ranks something wrongly: open an issue at github.com/Brittybrit/wethepeople.
- Data errors that come from Ballot305: corrections@ballot305.org.
- Security issues: see `SECURITY.md` in the repo. Do not open a public issue.
