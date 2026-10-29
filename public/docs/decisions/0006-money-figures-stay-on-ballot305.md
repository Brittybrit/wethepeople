# 0006. Money figures stay on Ballot305

- Status: Accepted
- Date: 2026-10-29

## Context
A dollar figure next to an official's name reads as an accusation unless it comes with what it is out of, where it came from and how it was counted. Ballot305 shows money with its full context, denominator and methodology. A short card here would strip that.

## Decision
Your area and the API do not include money behind officials. They link to Ballot305 for it. Amounts on posted agenda items (what an item spends) are shown as stated in the record.

## Consequences
- No figure on this platform is shown without its denominator.
- Residents take one extra click to see money.
- If money moves here later, it moves with the same context and methodology, not as a bare number.
