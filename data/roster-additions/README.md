# Roster additions: appointed officers and public boards

Date checked: 2026-10-29.

The platform roster (`vote-informed/public/data/roster.json`) covered elected offices only. This folder adds the people who run local governments and public authorities in Miami-Dade without being on a ballot, plus several boards with taxing or bonding power. It uses the same file layout and field names as roster.json, so it can be merged in.

Every term cites an official source: the body's own website, an agenda item, a resolution, a budget document or a state appointment record. No term rests on news alone. Where a news report fills a gap (for example a start date), the term says so in `note` and `startSourceKind`.

## Files

- `offices.json`: 137 offices. Same fields as roster.json, plus `selection` (`appointed`, `elected` or `ex-officio`) on every office and `appointedBy` where known.
- `people.json`: 179 new people. Another 28 people in these terms already exist in roster.json and are reused by id (for example county commissioners on the TPO board and the Naranja Lakes CRA, and state legislators on The Children's Trust and Public Health Trust boards).
- `terms.json`: 227 terms, all current as of 2026-10-29 except one (the superintendent who left on 2026-09-01).
- `gaps.json`: what could not be confirmed, sites that refused automated reads (with the URL and what to read there), boards left out on purpose, and items on weak or dated sources.

## What was added

| Group | Offices | Terms |
|---|---|---|
| A. Municipal manager, attorney, clerk (34 municipalities) | 97 | 89 |
| A. County: County Attorney, Commission Auditor, Inspector General, Chief Administrative Officer, Ethics Commission executive director | 5 | 5 |
| A. Schools: superintendent, general counsel, inspector general | 3 | 4 |
| B. Public Health Trust (Jackson Health System) board | 1 | 7 |
| B. The Children's Trust board | 3 | 32 |
| B. South Florida Water Management District governing board (all 9 members) | 7 | 9 |
| B. Florida Inland Navigation District, Miami-Dade commissioner | 1 | 1 |
| B. Commission on Ethics and Public Trust members | 1 | 5 |
| B. Citizens' Independent Transportation Trust (members and executive director) | 11 | 12 |
| B. Transportation Planning Organization governing board | 1 | 25 |
| B. Greater Miami Expressway Agency board (1 of 9 seats found) | 1 | 1 |
| B. County dependent districts: Educational Facilities Authority, Health Facilities Authority, NW 7th Avenue CRA, NW 79th Street CRA, West Perrine CRA, Naranja Lakes CRA | 6 | 37 |

Offices by level: municipal 97, county 19, special-district 18, school 3.
Offices by selection: appointed 134, ex-officio 2, elected 1 (North Miami's elected City Clerk).
Terms by selection of the office: appointed 192, ex-officio 34, elected 1.

Municipal coverage: 26 of 34 municipalities have every charter officer filled. Nine officer seats in 8 municipalities are empty and listed in `gaps.json` (mostly outside attorneys at small towns, plus Homestead's and North Miami Beach's city attorneys). Hialeah, Hialeah Gardens, Medley, Sweetwater and Virginia Gardens have no manager office because the mayor runs the administration there (none of their sites or the October 2025 League of Cities list shows a manager).

Bodies fully covered (every listed seat filled from the body's own page): South Florida Water Management District, The Children's Trust (32 of 33 seats as listed), Public Health Trust (as listed), Ethics Commission, TPO, the six county dependent districts. Partial: CITT (seats for two members not stated), Greater Miami Expressway Agency (1 of 9). Not filed: Housing Finance Authority and Industrial Development Authority (their sites block automated reads; see gaps).

## Conventions

- Ids follow roster.json. Offices: `city-<name>-manager|attorney|clerk`, `mdc-…`, `mdcps-…`, `pht-board-trustee`, `childrens-trust-board-…`, `sfwmd-board-<area>`, `find-commissioner-miami-dade`, `citt-district-<n>`, `mdc-tpo-board-member`, `gmx-board-member`. Bodies: `pht-board`, `childrens-trust-board`, `sfwmd-board`, `gmx-board`, `find-miami-dade`, `citt`, `mdc-ethics-commission`, `mdc-tpo`. Municipal offices reuse the city's existing body id from roster.json (for example `city-miami`).
- Boards whose seats are interchangeable are one office with `seats` (as roster.json does for `city-aventura-member`). Seats with a distinct appointing authority or area get their own office.
- `start` is a YYYY-MM-DD date only when the source states the day. Otherwise `start` is null, `startKnown` is false, and `note` repeats what the source does say (for example "October 2013").
- `end` is null for current holders. `termExpires` is YYYY-MM-DD when a source gives the day, or "Month YYYY" when it gives only the month.
- `via` repeats the office's `selection`, except designated seats on The Children's Trust, which use `designated`.
- The South Dade Soil and Water Conservation District is already in roster.json and was not added again.

## How to merge into the platform roster

1. Run the checks against the current roster: `node scripts/check-roster-additions.mjs ../vote-informed/public/data/roster.json`. It must print `ok`.
2. Append `people.json` to `roster.people`, `offices.json` to `roster.offices`, and `terms.json` to `roster.terms`. No id in this folder exists in roster.json, and terms that point at existing people use their roster.json ids.
3. The `selection` field already exists on some roster.json offices; `appointedBy` is new. Readers that ignore unknown fields need no change.
4. Update `roster.updated` and add a line to `roster.about` that appointed offices are included and what `selection` and `appointedBy` mean.
5. Read `gaps.json` before publishing: nine municipal seats are still empty, and the blocked-site list says where to read the missing names by hand.

## Validation

`scripts/check-roster-additions.mjs` checks that ids are unique and do not collide with roster.json, that every term has at least one source URL, that each term's person and office exist (here or in roster.json), that dates are real YYYY-MM-DD dates, and that every office has a valid `selection` and `level`. `tests/hand/roster-additions.test.mjs` runs the same checks under `pnpm test`, and skips the roster.json checks when that file is not present.
