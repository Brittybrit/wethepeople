# Prompt card: relevance-tags

| Field | Value |
|---|---|
| Version | relevance-tags-v1 |
| File | `prompts/relevance-tags.md` |
| Schema | `prompts/relevance-tags.schema.json` |
| Eval | `prompts/relevance-tags.eval.json` |
| Task | `classify`, tier 3 |
| Models, in order | claude-haiku-4-5, then local-small (qwen2.5:7b) |
| Max output | 400 tokens |
| Status | Runs in evals only. Not called by any route. |

## Task
Tag one agenda item for a Miami-Dade resident, from the item text alone. The prompt says to return only tags the text supports and never infer.

## Output schema
- `tags`: zero or more of `fiscal`, `location`, `industry`, `household`, `lifestyle`, `procurement`.
- `stated_impact`: true only if the text states a dollar figure or a rule that applies to residents.
- `industries`: short lowercase names of the lines of business, each up to 40 characters.
- `place`: the place named, or an empty string, up to 120 characters.
- No other fields are allowed.

## Intended use (planned)
The relevance service will tag items whose packets are prose, where tier 1 code cannot. Output will be stored as a candidate with its tier, prompt version and input hash, and shown only with a link to the item.

## Out of scope
- Whether an item is good or bad, or how anyone should feel or vote on it.
- Predicting the outcome of a vote.
- Who is behind an item (donors, lobbyists). That is a records join, not a classification.
- Text other than one agenda item: full packets, minutes, news, social posts.
- Personal circumstances of a resident.

## Eval
- 7 cases. Five are real agenda-item shapes: a stormwater fee change, a rezoning, a towing contract, a proclamation, an amplified-sound hours change. Two are prompt-injection cases: instructions inside the item text, and a fake system note.
- Checks: required tags present, wrong tags absent, exact `stated_impact` and `industries` where the answer is a fact.
- Floor: 0.8 pass rate (4 of 5). Ceiling: $0.05 per full run.
- The set is too small to show more than gross failures. Growing it is the first priority before this prompt serves anything.

## Failure modes to watch
- Tagging `fiscal` on a rezoning because development implies money. The rezoning case guards this.
- Tagging `procurement` on a fee ordinance. The stormwater case guards this.
- `stated_impact: true` when the text implies but does not state a figure.
- Reading instructions placed inside agenda text. Item text is untrusted input. See `../../security/threat-model.md`.
- Free-text `industries` drifting in spelling (towing vs tow services), which breaks joins.

## Change process
1. Edit the prompt and bump `version:` (for example to relevance-tags-v2).
2. Add or update eval cases. Every production correction becomes a case.
3. Run `pnpm eval relevance-tags` and paste the result line in the pull request.
4. The pull request merges only if the eval passes its floor and ceiling.
5. Changing the model order in `config/models.json` follows the same steps.
