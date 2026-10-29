# We the People 305 API

Base: `https://wethepeople305.org/api/v1`. Read-only, no key, CORS open, JSON.

## GET /precinct?address=
Street address to Miami-Dade precinct code(s).

- Geocoding: Esri World Geocoder first (rooftop or street-address match, score 90+, Florida only), then the U.S. Census geocoder.
- Precinct: the county's precinct polygons (Miami-Dade GIS, Precinct layer), point in polygon.
- The address is passed to those services and is never logged, stored or cached (`Cache-Control: no-store`). Events record nothing about the request beyond the route.
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
| `notResearchedYet` | Seats whose meeting calendar and levers are not researched yet. |

Money behind officials is not in this response. It lives on Ballot305 with its full context and methodology, so a figure is never shown without its denominator.

## Source and license
Data comes from the Ballot305 public API (`https://ballot305.org/api`, CC BY 4.0) through one adapter, `lib/sources/ballot305.mjs`. Upstream reads are edge-cached for 15 minutes. The code is MIT.
