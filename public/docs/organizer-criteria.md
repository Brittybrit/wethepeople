# Organizer admission criteria

**DRAFT. Waiting for the founder's approval. Not in force until this line is removed.**

As of 2026-10-29.

## What the organizer role is
Anyone can have a citizen account. The organizer role is for organizations that do civic work in Miami-Dade. It will unlock organizer tools (watchlists, alerts, bulk access) as they are built. It is granted by these published criteria, checked by a person, not by name or by who someone knows. The same criteria apply to every organization, whatever its views or politics.

A person can hold both roles. An organizer is still a citizen.

## Criteria
An organization must meet all five. Each has an id, used by the application form and the API.

1. `miami-dade-civic-work`: The organization does civic work in Miami-Dade County: for example attending public meetings, public comment, voter education, or neighborhood service.
2. `verifiable-public-presence`: The organization can be checked in public: a website, a public social media page, a Florida corporation record, or a listing of its public meetings.
3. `not-a-campaign`: The organization is not a candidate, a campaign, a political party, or a political committee, and is not run by one.
4. `named-contact-for-review`: The organization has someone who can answer questions from the reviewer about this application.
5. `code-of-conduct`: The organization agrees to the project Code of Conduct and to use organizer tools within it.

## How to apply
1. Create an account at [/account](https://wethepeople305.org/account) (a passkey, or Google).
2. Fill in the form at [/organizers](https://wethepeople305.org/organizers): organization name, a website or public page, which criteria you meet, and a short statement (20 to 1,000 characters) on what you do in Miami-Dade.
3. Your account page shows the status: pending, approved or declined.

The API is `POST /api/v1/organizer-applications` with a session cookie. See `identity.md`.

## How review works
- An admin reviews each application against the five criteria, using public records: the website, the Florida Division of Corporations, the Florida campaign finance database, meeting minutes.
- The admin approves or declines and may add a short note. Approval grants the organizer role at once.
- An admin cannot review their own application.
- Admin is not a role anyone can apply for. It is granted only by the founder running a command (see `identity.md`).

## Open questions for the founder
- Should individuals (not organizations) be able to qualify, for example a neighborhood leader with a record of public comment?
- Should all five criteria be required, or some subset?
- How long should an approval last before it is checked again?
- Should a declined applicant be able to reapply at once, or after a wait? Today they can reapply at once.
- Who besides the founder reviews applications, and should the reviewer's name be public?
