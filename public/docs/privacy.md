# Privacy

This describes the site as of 2026-10-29.

## Looking up your precinct
When you enter an address, the site sends it to:
- the Esri World Geocoder, and if that does not find it, the U.S. Census geocoder, to get coordinates;
- Miami-Dade County's precinct map (GIS), which receives only the coordinates.

Those services have their own privacy terms. The site does not log, store or cache your address. The answer is sent with `Cache-Control: no-store`.

## What stays in your browser
After a lookup, the page puts your precinct code in the page link (for example `/your-area?precinct=033.0`) and saves it in your browser's localStorage under the key `wtp.precinct`, so the page opens to your area next time. It stays on your device. Clear it by clearing site data in your browser.

## What the site records
The site records events about how it runs: which route was called, how long it took, whether it worked, and for Your area, the precinct code. Events have no field for an address, name, email, phone or IP, and the code refuses to record one.

## Hosting
The site runs on Cloudflare. Like any host, Cloudflare receives standard request data such as IP address, browser and the page requested. The site does not add logging of that data. To stop the address lookup being used for bulk geocoding, Cloudflare counts lookups per IP address for one minute; the count is held by Cloudflare's rate limiter, not stored or logged by the site. Cloudflare's own processing is governed by its privacy policy.

Pages load fonts from Google Fonts, which receives the standard request data for those files.

## Accounts (optional)
You do not need an account to use the site. If you make one (at /account), we keep only:
- an account id we make up, the date it was created, and your roles (citizen; organizer if an application is approved);
- for each passkey, its public key, a counter and when it was last used. The private key stays on your device;
- if you link Google, Google's account number for you (not your name or photo). Your Google email only if you tick the box to save it;
- anything optional you add: a display name, an email address, a precinct code;
- if you apply to be an organizer, what you put in the application;
- a hash of your session id, so you stay signed in for up to 30 days.

We do not store your name, address, phone number or IP address with your account. Sign-in events record only which route ran and whether it worked. Details: `identity.md`.

### Deleting your account
Sign in at /account and choose "Delete my account", or send `DELETE /api/v1/me` with your session. It removes your account, passkeys, Google link, sessions and organizer applications at once, and cannot be undone. Your device may still keep the passkey; you can remove it in your password manager. To unlink Google on Google's side, use your Google account's "Third-party connections" page.

## Cookies
The site sets cookies only when you sign in:
- `__Host-wtp305_session`: keeps you signed in. HttpOnly, Secure, SameSite=Lax. Deleted when you sign out.
- `__Host-wtp305_oauth`: holds a one-time value for up to 10 minutes while you sign in with Google.

No other cookies. No analytics or advertising cookies.

## What the site does not do
- No ads, no tracking pixels, no selling or sharing data.
- No email from us unless you give an address, and then only about your account or an application.
- No model sees your address.

## Officials
The site shows officials' public office contacts as published by their offices. It does not show home addresses or personal contacts.

## Contact
privacy@wethepeople305.org
