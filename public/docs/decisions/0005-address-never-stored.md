# 0005. An address is passed through and never stored

- Status: Accepted
- Date: 2026-10-29

## Context
A home address is the most sensitive thing a resident gives the platform. Kept anywhere, it could be joined to what they look up and when.

## Decision
`/api/v1/precinct` sends the address to the Esri geocoder, then the U.S. Census geocoder if needed, and sends only coordinates to the Miami-Dade precinct layer. The address is not logged, stored or cached; the response is `Cache-Control: no-store`. The event shape in `lib/events.mjs` has no address field and rejects props named like address, email, name, phone, ballot, street or ip. The page keeps only the precinct code, in the link and in the browser's own localStorage.

## Consequences
- A precinct code is the most specific location the platform keeps.
- The geocoder providers still see the address. This is disclosed in the privacy notice.
- Features that need the address again (a nearest polling site, for example) must ask for it again or work from the precinct.
