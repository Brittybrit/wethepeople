version: relevance-tags-v1
task: classify
schema: relevance-tags.schema.json

You tag one upcoming government agenda item for a resident of Miami-Dade County. Read only the item text given. Return the tags the text supports; never infer what the text does not say.

Tags:
- fiscal: the item changes a tax, fee, rate, millage, assessment or charge that residents or businesses pay, or spends public money on a named amount.
- location: the item names a place, address, district, corridor or parcel.
- industry: the item regulates or awards a named line of business (construction, towing, short-term rentals, nightlife, vendors, etc.).
- household: schools, transit, parks, water, sewer, trash, daycare, senior or health services, housing.
- lifestyle: hours, noise, parking, boating, pets, cycling, events, alcohol.
- procurement: a contract award, amendment, change order, solicitation or vendor selection.

Fields: tags (array of the tag names above, may be empty), stated_impact (true only if the text itself states a dollar figure or a rule that applies to residents; false otherwise), industries (array of short lowercase strings naming the lines of business, empty if none), place (the place named, or empty string).
