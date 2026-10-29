# Decision processes

A decision such as "the September budget hearings" is the last step of a longer chain. This folder breaks each decision into its milestones: who acts, what goes in, what comes out, when it happens, which law requires it, and what a resident can do at that step. The goal is to show residents where they can step in before the final vote.

Four kinds of decision are covered:

| Kind | Template file | Variants |
|---|---|---|
| `annual-budget-and-millage` | `templates/annual-budget-and-millage.json` | county and cities (TRIM, s. 200.065, F.S.); school district (s. 200.065(2)(f) and ch. 1011, F.S.) |
| `ordinance-adoption` | `templates/ordinance-adoption.json` | cities (s. 166.041); county (s. 125.66 and the county charter); School Board policies (ch. 120) |
| `procurement-award` | `templates/procurement-award.json` | one chain; Cone of Silence (County Code Sec. 2-11.1(t)) and protest rules added per body |
| `election-to-office` | `templates/election-to-office.json` | county and School Board (August primary, November runoff); cities (charter dates) |

There is one file per body (`county.json`, `schoolboard.json`, `city-<slug>.json`, 21 in all). `index.json` merges everything for the Worker. It is generated, so never edit it by hand.

## Files and fields

### Template (`templates/<kind>.json`)

```json
{ "kind": "annual-budget-and-millage", "name": "...", "checked": "2026-10-29",
  "variants": [ {
    "key": "annual-budget-and-millage", "kind": "...", "name": "...", "appliesToLevels": ["county", "municipal"],
    "summary": "...", "dayCounting": "...", "legalBasis": [ { "cite": "s. 200.065, F.S.", "url": "https://..." } ],
    "milestones": [ {
      "key": "maximum-millage-set",
      "name": "Commission sets the proposed (maximum) tax rate and first hearing date",
      "actor": "Commission",
      "inputs": ["DR-420 certification", "Proposed budget"],
      "output": "Proposed millage ... sent to the Property Appraiser",
      "timing": { "rule": "plain words", "anchor": "taxable-value-certified", "offsetDays": { "min": 0, "max": 34 } },
      "legalBasis": [ { "cite": "s. 200.065(2)(b), F.S.", "url": "https://www.flsenate.gov/Laws/Statutes/2026/200.065" } ],
      "residentCan": [ { "lever": "public-comment", "how": "one sentence" } ],
      "influence": "high", "influenceWhy": "one line",
      "legallyRequired": true
    } ]
  } ] }
```

- `milestones` are in chain order. Step numbers ("3 of 8") come from this order after dropping steps that do not apply to the body's level.
- `appliesToLevels` (on a variant or a milestone) limits it to `county`, `municipal` or `school`. A `legalBasis` entry can carry `level` so that, for example, a city sees s. 166.241 and the county sees s. 129.03.
- `appliesWhen` marks a step that happens only in some cases, such as a rezoning or a recount.
- `timing.anchor` is another milestone key, or `date:MM-DD` for a fixed calendar date (for example `date:07-01`). `offsetDays` is calendar days added to the anchor date: "within 35 days" counting the anchor as day 1 is `{ "min": 0, "max": 34 }`, "at least 5 days before" is `{ "min": null, "max": -5 }`. It is `null` when the law sets no window. `offsetUnit: "business-days"` marks a count that skips weekends and holidays. The validator does not range-check those.
- `legalBasis` lists only statutes (flsenate.gov), Florida DOR TRIM guidance, or the body's own charter or code. It is empty when no law sets the step, for example a budget workshop.
- `residentCan[].lever` uses the lever keys from the cycle files: `public-comment`, `written-comment`, `contact`, `records-request`, `petition`, `referendum`, `recall`, `qualify`, `vote`, `serve-on-board`, `other`.
- `influence` says how much a resident can change the outcome at this step. The maximum millage set in July caps the September rate, so July is `high`. A paperwork filing is `low`.

### Body (`<body-key>.json`)

```json
{ "key": "county", "name": "...", "level": "county", "jurisdiction": "...",
  "cycleFile": { "path": "vote-informed/scripts/data/cycles/county.json", "checked": "2026-10-22" },
  "meetingPattern": { "text": "...", "source": "https://..." },
  "leverLinks": { "public-comment": { "url": "https://...", "deadline": "...", "source": "https://..." } },
  "decisions": [ {
    "key": "budget-fy2027-28", "kind": "annual-budget-and-millage", "template": "annual-budget-and-millage",
    "name": "...", "cycle": "FY 2027-28 (...)", "notes": "...",
    "milestones": [
      { "milestone": "first-public-hearing", "date": "2027-09-09", "dateBasis": "body-source", "source": "https://...", "note": "..." },
      { "milestone": "maximum-millage-set", "window": { "from": "2027-07-01", "to": "2027-08-04" }, "dateBasis": "statutory-window", "note": "..." }
    ] } ] }
```

- A decision has rows only for the steps that have something to say. A step with no row shows as `unknown` in the chain.
- A step can have more than one row, for example two budget workshops.
- `processOnly: true` (ordinances and procurement) means there is no single calendar. The chain shows the steps and the body's `meetingPattern`. Rows there carry only body-specific law or notes, such as the Cone of Silence or a protest window, with no dates.
- A row may carry `timing` or `legalBasis` to add to or replace the template's for this body.
- `anchorBasis` on a statutory window says which estimated or unknown date it was computed from, for example `first-public-hearing:pattern`. A window computed from a pattern date is only as good as that date.
- `leverLinks` is the first link for each lever in the body's cycle file. The library attaches it to each resident action.

## How dates are classified (`dateBasis`)

| Value | Meaning | Source required |
|---|---|---|
| `body-source` | A dated row from the body's own calendar, notice, agenda or the Supervisor of Elections calendar | yes, `source` |
| `statutory-window` | Computed from the law and an anchor date. For the budget, the anchor is July 1, the legal day 1 (s. 200.065(12), F.S.). If the Property Appraiser certifies later, every window shifts by the same number of days. | no (the law is cited on the template) |
| `pattern` | Estimated from an earlier year: the same weekday, 52 or 104 weeks later. The note always says "Estimated" and names the earlier date. | yes, the earlier year's source |
| `unknown` | Not found, or the pattern would break the law (see below) | no |

Rules that keep estimates honest:

- An estimated date is never shown as confirmed. `upcomingMilestones` adds `estimated: true` to pattern dates.
- If a pattern date for a budget hearing lands on a date the County Commission or School Board has proposed for its own 2027 hearing, it is not used. State law keeps other bodies off those dates (s. 200.065(2)(e)2., F.S.). The legal window is shown instead, with a note.
- If a pattern date falls outside the legal window (for example a first hearing outside day 65 to 80), the legal window is shown instead.
- The county's 2027 budget hearings (Sept 9 and 23) and all School Board 2027 dates come from proposed or tentative calendars. They are `body-source` with that caveat in the note.

## Adding or updating a body

1. Copy a city file of the same level and change `key` (it must match the file name), `name`, `jurisdiction`, `cycleFile`, `meetingPattern` and `leverLinks`.
2. For the budget, add a row for each step you have a dated source for. Use `body-source` for dates the body has posted for the coming year and `pattern` for last year's dates carried forward, with the earlier date and URL in the note. Add the statutory windows for the TRIM steps, computed from July 1.
3. For elections, use the Supervisor of Elections calendar or the city clerk's notice. Use `statutory-window` only for dates the law fixes, such as registration closing 29 days before.
4. Run `node scripts/build-decision-processes.mjs`. It validates every file and rewrites `index.json`. Fix every problem it lists. `--check` validates without writing and fails if `index.json` is stale. A unit test does the same.
5. Run `npx vitest run --project unit`.

The validator checks that keys are unique, every legal rule has a URL, every `body-source` or `pattern` date has a source, offsets are whole numbers within 400 days with min no greater than max, `dateBasis` is one of the four values, rows follow template order, and every date computed from an anchor sits inside the window the law allows.

## Library

`lib/decision-processes.mjs` holds pure functions with no imports. The caller passes in `index.json` as `data`.

- `chainFor(bodyKey, kind, data)`: the full chain or chains for one body and kind, with step numbers, law, resident actions and each step's dates.
- `upcomingMilestones(bodyKeys, today, data, { horizonDays })`: dated steps that are open or start within the horizon, soonest first. Each comes with its decision, "3 of 8", the step before it, the step it feeds, its resident actions and its `dateBasis`.
- `nextLeveragePoint(bodyKeys, today, data)`: the soonest high-influence step. A step open today wins.
- `buildIndex`, `validateDecisionData`, `windowFromAnchor`: used by the build script and the tests.

## Sources

Body dates come from the hand-researched cycle files in the Ballot305 repo (`scripts/data/cycles/*.json`, checked Oct 22 to 23, 2026), which cite each body's own pages, and from the Miami-Dade Supervisor of Elections 2026 and 2027 calendars. The law was read on flsenate.gov (2026 Florida Statutes), Florida DOR TRIM timetables (`trimregwb.pdf`, `trimschoolswb.pdf`), the Miami-Dade Home Rule Charter, the BCC Rules of Procedure, and the county Cone of Silence and bid protest pages, all in October 2026.

Known gaps: city bid protest deadlines (set by each city's code, not checked), the School Board's own procurement rules, the rule that moves the county's qualifying window off the state default, and most cities' 2027 budget dates (none posted yet).
