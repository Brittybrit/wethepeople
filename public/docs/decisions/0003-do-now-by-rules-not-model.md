# 0003. The do-now list comes from fixed rules, not a model

- Status: Accepted
- Date: 2026-10-29

## Context
"What to do now" is the part a resident is most likely to act on. A model ranking could be wrong in ways nobody can see, and could tilt toward one side without anyone intending it.

## Decision
`lib/your-area.mjs` builds the list from four published rules, at most one action each: vote within 30 days of an election; weigh in on the weightiest posted item with its meeting still ahead; speak at the next regular meeting closest to home; reach the district office closest to home. Item weight is a fixed sum (place 8, money 4, lobbyist 4, hearing 2, prior action 1). The rules are returned in every response.

## Consequences
- Anyone can see why an action ranks where it does and reproduce it.
- The list is the same for every precinct with the same data, regardless of who is in office.
- The rules are blunt. Changing them is a code change with tests.
- A model may later suggest actions, but only as reviewed candidates, never in this list without a rule.
