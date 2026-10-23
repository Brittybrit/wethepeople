# Governance cycle files: coverage after the Oct 22-23 research runs

All 20 local bodies have a file in scripts/data/cycles/ (commit 60ea50f): county, school board, 18 cities on the Nov 3 ballot. Merged: 93 posted meetings, 116 phases, 189 levers; 9 lever rows dropped for lacking a source. Live at ballot305.org/api/v1/cycles and inside /api/v1/now?precinct=.

## Coverage by body (as of Oct 23)
| Body | Next posted meeting | Posted meetings left | Charter petition | Recall | Comment rule |
|---|---|---|---|---|---|
| County | Nov 9 | 9 (2026 only; 2027 proposal: Sept 9 and 23 hearings) | 8.01: 4%/8%, 120 days | 8.02: 4% | Rules 6.02-6.06: 2 min items, 5 min hearings |
| School Board | Nov 17 | 20 (2026 + tentative 2027) | yes | yes | 2 min items, 3 min hearings, Monday 4:30 deadline |
| Coral Gables | Oct 27 | 1 (Legistar; nothing after Oct 27) | Sec. 10: 20% initiative, 10% referendum | yes | 3 min (CAO 2015-104) |
| Doral | Nov 18 | 2 | 5.02: 10% | yes | no time limit posted |
| Hialeah | Oct 27 | 5 (Nov 24, Dec 22 cancelled) | missing (Municode blocked) | yes (state law) | 3 min; written comment email |
| North Miami | Oct 27 | 5 | Code Ch. 6: 10% | F.S. 100.361 | yes; agenda posted Thursday before |
| North Miami Beach | none posted | 0 (Oct 20 postponed, no date) | missing | state law | 3 min hearings |
| Aventura | Nov 10 | 3 | missing | state law | no limit posted |
| Cutler Bay | Nov 18 | 2 (third Wednesday rule) | 5.2: 10%, 60 days | 2.7: 10% | 3 min; 400-word email |
| Key Biscayne | none posted | 0 | yes | missing | yes, no time limit |
| Sunny Isles Beach | Nov 19 | 1 | yes | missing | none posted |
| Opa-locka | Oct 28 | 1 | yes | yes | 3 min (Code 2-57) |
| South Miami | Nov 3 | 3 | 15% initiative, 30-day referendum | state law | yes |
| Pinecrest | Dec 8 | 1 | 10%, 60 days | 10% | no limit posted |
| Miami Gardens | Oct 28 | 1 | yes (state law fallback) | yes | missing |
| Palmetto Bay | Nov 2 | 3 | 5.2: 5% | 2.7: 10% | written: 5 pm, read 1 min |
| Medley | Nov 2 | 2 | state law | yes | 3 min |
| El Portal | Oct 27 | 3 | state law | yes | 3 min; packets Friday |
| Virginia Gardens | Nov 19 | 1 | state law | yes | missing (scanned agendas) |
| Biscayne Park | Nov 10 | 2 | state law | yes | 7-day notice rule |

## Systemic gaps
- No city has posted 2027 dates. The county has a proposed 2027 calendar memo; the school board a tentative 2027 schedule.
- Municode, CivicWeb, Granicus, Laserfiche and eScribe refuse automated fetches. Where the charter could not be read, the file cites state law (F.S. 100.361 recall, 166.031 charter petitions), which is correct but less specific than the city's own thresholds. Hand-check in the browser: Hialeah, North Miami Beach, Aventura, Key Biscayne (recall), Sunny Isles Beach (recall), Medley, El Portal, Virginia Gardens, Biscayne Park, Miami Gardens (charter is a scan).
- Comment time limits missing for Doral, Aventura, Key Biscayne, Sunny Isles Beach, Pinecrest, Miami Gardens, Virginia Gardens.
- Contacts: individual member emails missing for the school board, South Miami, Biscayne Park; mayor contact missing for the county.
- The schedule field needs a refresh cadence: most cities post one or two months out, so a monthly re-pull is required for "next meeting" to stay true. Not scheduled yet.
