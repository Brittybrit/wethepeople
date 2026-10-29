# AI use policy

These rules bind every contributor, person or agent, and the platform itself. A pull request that breaks one is not merged. Where a rule covers something not built yet, it applies the day that thing is built.

## 1. The model never sees a source it cannot cite
Inputs to a tier 3 or tier 4 call are records with a URL or a content hash. Outputs must point back to them. An output that cites nothing is dropped. No model is asked what it knows from training about an official, a body or an item.

## 2. Model output is a candidate, not a fact
Model output is stored with its tier, model, prompt version and input hash, as a candidate. It becomes fact only when a rule or a person confirms it against the record. Status: the adapter records the decision today; the candidate store (D1 ledger) is planned.

## 3. No persuasion and no voting recommendations
The platform does not tell anyone how to vote, which side to take, or what to think of an official. It says what is being decided, when, by whom, and how to take part. Prompts must not ask a model to judge an item as good or bad.

## 4. Nonpartisan symmetry
Every official, candidate and party gets the same fields, the same wording and the same rules. A prompt or rule that names a party, a person or a side is not allowed. Evals must include cases from across the spectrum when a prompt touches people or positions.

## 5. No profiling of residents
The platform does not build a profile of a resident from what they look up. No model receives an address, name, email, phone, IP or ballot choice. Events have no field for them. A precinct code is the most specific location the platform keeps, and only in events.

## 6. No generated content attributed to real people
A model never writes a quote, statement, position or summary that is presented as coming from a real person. Officials' words are shown only from the record, with a link.

## 7. Disclose model-written text
Any text a model wrote is labeled as model-written where it appears, with the tier and a link to the source it was drawn from. Today no model-written text is shown to residents.

## 8. A person reviews before anyone acts
Nothing a model produced is shown as a step for a resident to take, or sent anywhere, until a person or a published rule has confirmed it. The do-now list is built from fixed rules for this reason. See ADR 0003.

## 9. Spend caps
Every model call is logged with its cost. Each eval file sets a cost ceiling and CI fails above it. Per-key and per-worker caps are planned with identity and the usage ledger. Until they exist, no model is called from a public route.

## 10. Evals before a prompt or model change merges
A change to a prompt, its schema, the routing table or a model choice runs `pnpm eval` and must pass the file's floor and ceiling. The result line goes in the pull request. A new prompt needs a schema and an eval file in the same change.

## Related
- `system-card.md`: what AI does today.
- `evals.md`: how evals run.
- `../security/threat-model.md`: prompt injection and other risks.
