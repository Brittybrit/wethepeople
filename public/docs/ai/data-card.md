# Data card

The data We the People 305 serves today, where it comes from, and its limits. As of 2026-10-29.

## Sources

| Source | What it gives | How it is reached | License or terms |
|---|---|---|---|
| Ballot305 public API (ballot305.org/api) | Officials by seat, terms, who is on the ballot, office contacts, meeting calendars, budget and session phases, ways to take part, posted agenda items with tags, the county's precinct list | `lib/sources/ballot305.mjs`, the only adapter that reads it | CC BY 4.0 |
| Esri World Geocoder | Address to coordinates (first try) | `lib/geo.mjs`, per lookup, `forStorage=false` | Esri terms of use |
| U.S. Census geocoder | Address to coordinates (fallback) | `lib/geo.mjs`, per lookup | U.S. government public service |
| Miami-Dade GIS Precinct layer | Coordinates to precinct | `lib/geo.mjs`, per lookup | County open data |

Ballot305's data is researched from official records: county, city and school board calendars and agendas, charters and codes, clerk and member pages, election and campaign finance records. Each fact carries a `source` link to the record it came from. Ballot305's methodology is at ballot305.org/methodology.

## License
- Data from Ballot305 is CC BY 4.0. Attribution: Ballot305 (ballot305.org). Every Your area response carries a `source` block with name, license, docs and methodology.
- The code is MIT.

## Coverage
- Area: Miami-Dade County. Addresses outside the county return an error.
- Bodies: the county, the school board and 18 cities on the Nov 3 ballot have meeting calendars, phases and ways to take part. See `cycles-coverage.md`.
- Seats at every level that represent a precinct: city, schools, county, state, federal.

## Known gaps
- Seats whose meeting calendar and ways to take part are not researched yet. Each Your area response lists them in `notResearchedYet`.
- Some agenda and code portals refuse automated fetches (Municode, CivicWeb, Granicus, Laserfiche, eScribe). Where a charter could not be read, the data cites state law. Those cities need a hand-check.
- No city has posted 2027 meeting dates. Most post one or two months ahead, so "next meeting" depends on a monthly re-pull, which is not scheduled yet.
- Some member emails and comment time limits are missing. See `cycles-coverage.md`.
- Posted agenda items appear only once a body posts its agenda, usually a few days before the meeting.
- Money behind officials is not served here. See ADR 0006.

## Freshness and caching
- Ballot305 reads are cached at the edge for 15 minutes. Your area responses carry `Cache-Control: public, max-age=900`.
- `dataUpdated` and `rosterUpdated` in each response say when Ballot305 last updated the data and the officeholder roster.
- Precinct lookups are not cached (`Cache-Control: no-store`). The county precinct list used to expand split precincts is cached like other Ballot305 reads.

## Personal data
- Officials: only public office contacts (office email, phone, contact page, office address) as published by their office.
- Residents: none stored. An address is passed to the geocoders and the county layer for one lookup and is not logged, stored or cached. See `../privacy.md`.

## Corrections
- Wrong data about an official, a meeting or an item: email corrections@ballot305.org or open an issue at github.com/Brittybrit/wethepeople. Fixes are made at the source in Ballot305 and appear here within 15 minutes of release.
- Wrong precinct for an address: open an issue with the precinct you expected, not the address.
