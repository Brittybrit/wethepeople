<!-- Confirm this address is routed in Cloudflare Email Routing before publishing. -->
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

## What the site does not do
- No cookies set by the site.
- No accounts. Sign-in is planned and this notice will change before it ships.
- No ads, no tracking pixels, no selling or sharing data.
- No model sees your address.

## Officials
The site shows officials' public office contacts as published by their offices. It does not show home addresses or personal contacts.

## Contact
privacy@wethepeople305.org
