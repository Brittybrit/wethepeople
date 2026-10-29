# We the People 305 API

Base: `https://wethepeople305.org/api/v1`. Read-only, no key, CORS open, JSON.

## GET /address-suggest?text=
Autocomplete for a web form: what someone has typed (3 to 120 characters) to up to 6 Miami-Dade street addresses, each with a `magicKey`. Esri World Geocoder suggestions fenced to Miami-Dade. Nothing is logged, stored or cached. Limited to 120 requests a minute per client. HTTP only, not an MCP tool.

## GET /precinct?address=
Street address to Miami-Dade precinct code(s). Pass `&magicKey=` from a chosen suggestion for an exact match.

- Geocoding: Esri World Geocoder first (rooftop or street-address match, score 90+, Florida only), then the U.S. Census geocoder.
- Precinct: the county's precinct polygons (Miami-Dade GIS, Precinct layer), point in polygon.
- The address is passed to those services and is never logged, stored or cached (`Cache-Control: no-store`). Events record nothing about the request beyond the route.
- Limited to 20 lookups a minute per client (HTTP 429 beyond that).
- A split precinct returns both halves (`"split": true`); only the voter's ballot or voter card says which.

```json
{ "precincts": ["033.0"], "split": false, "matchedAddress": "1700 Convention Center Dr, Miami Beach, Florida, 33139", "sources": { "geocoder": "...", "precincts": "..." } }
```

## GET /your-area?precinct=033.0
One precinct's view, closest to home first.

| Field | What it is |
|---|---|
| `doNow` | Up to four actions, ranked by the fixed rules in `rules` (no model): vote within 30 days of an election; weigh in on a posted item that involves money, a lobbyist, a hearing or a place; speak at the next regular meeting closest to home; reach the district office. Each has `why`, `deadline`, `url`, `source`. |
| `upcomingItems` | Items on posted agendas whose meeting is still ahead, weightiest first, with plain-word `reasons` and how to comment. |
| `meetings` | Next 12 posted meetings of the bodies that represent the precinct. |
| `decisionPoints` | Budget, election and session phases over the next six months, with what each decides. |
| `servants` | Every seat that represents the precinct, by level (city, schools, county, state, federal): who holds it, since when, who is on the ballot for it, and the office's contact. |
| `levers` | Every documented way to act on each body: public comment, written comment, records requests, petitions, boards. |
| `appointed` | Appointed officials who run the precinct's city, schools and county (manager, attorney, clerk, superintendent, county attorney, inspectors general). |
| `courts` | The four courts that hear the precinct's cases, with every sitting judge. |
| `boards` | Countywide boards and authorities that tax, borrow or spend public money, with members, seats and how each was chosen. |
| `notResearchedYet` | Seats whose meeting calendar and levers are not researched yet. |

Money behind officials is not in this response. It lives on Ballot305 with its full context and methodology, so a figure is never shown without its denominator.

## Ledger
Ballot305's read API, served here from this platform's own copy of its data (`public/ledger-data/`, synced hourly from the Ballot305 repo; `/ledger-data/SOURCE.json` has the Ballot305 commit and copy time). Paths, parameters, paging and response bodies are the same as `https://ballot305.org/api/v1`, so a client can switch hosts without changes. The one difference: Ballot305's index at `/api/v1` is at `/api/v1/ledger` here, and bulk file links point at `/ledger-data/`. Each operation is also an MCP tool with the id shown, except `bulk`.

Lists are paged with `limit` (default 100, max 500) and `offset`; the total is in the body and in `X-Total-Count`. Responses carry `ETag` (an `If-None-Match` match returns 304) and `X-Data-Updated`. Every action carries `source` (data file and date). Every tie carries `match`, `basis`, `timing`, `days` and `actionSplit`: repeat them with any amount.

| Path | What it returns |
|---|---|
| `/ledger` (`ledger_index`) | Version, data dates, license, counts, endpoints, and what the tie and action fields mean |
| `/bodies`, `/bodies/{key}` (`ledger_bodies`, `ledger_body`) | Bodies covered, with members, campaign accounts, who is on the ballot, coverage note |
| `/actions`, `/actions/{body}/{id}` (`ledger_actions`, `ledger_action`) | Official actions with roll calls and tied gifts. Filters: `body`, `person`, `kind`, `since`, `until`, `split=1`, `tied=1`, `party`, `q` |
| `/ties` (`ledger_ties`) | One row per gift tied to an action. Filters: `person`, `body`, `donor`, `timing`, `match`, `since`, `until`, `minAmount` |
| `/people`, `/people/{id}` (`ledger_people`, `ledger_person`) | Roster people (`q`, `onBallot=1`); one person with terms, races, actions, ties, connections, contact |
| `/transparency` (`ledger_transparency`) | City records scorecard |
| `/cycles`, `/cycles/{key}` (`ledger_cycles`, `ledger_cycle`) | Meetings, budget and election phases, and levers per body |
| `/now?precinct=` (`ledger_now`) | The raw precinct view behind `your-area`; `date` optional |
| `/upcoming` (`ledger_upcoming`) | Items on posted agendas with matches and tags. Filters: `body`, `precinct` (adds relevance), `since`, `until`, `tagged` |
| `/contacts`, `/contacts/{office}` (`ledger_contacts`, `ledger_contact`) | Official contacts per office |
| `/procurement`, `/procurement/{body}` (`ledger_procurement`, `ledger_procurement_for_body`) | Open solicitations, expiring contracts, capital plan, levers |
| `/payments`, `/payments/{body}` (`ledger_payments`, `ledger_payments_for_body`) | Staffing, top vendors with matches, union contracts, levers |
| `/connections`, `/connections/{person}` (`ledger_connections`, `ledger_connections_for_person`) | Confirmed connections with the record that states each; counts under review |
| `/bulk` (`ledger_bulk`, HTTP only) | Links to the raw data files |

Ballot305's `/api/v1/openapi.json` (OpenAPI 3.0) is not copied: this platform's `/api/v1/openapi.json` (OpenAPI 3.1) describes these paths. See `decisions/0008-ledger-moves-to-platform.md`.

## Source and license
Your area reads the platform's own copy of Ballot305's data (`public/ledger-data/`, synced hourly, CC BY 4.0; see decisions/0008) plus the roster additions in `data/roster-additions/` (appointed officials and boards, each term with an official source). No call to Ballot305 at request time. The code is MIT.
