"""Builds the link-preview images (1200x630) in public/og/, one per page, in the precinct-map brand.
Run: python3 scripts/og/build-og-images.py   (needs: pip install playwright && python3 -m playwright install chromium)
Add a page by adding a row to PAGES; then add its og:image tags (see public/your-area.html)."""
import pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'public' / 'og'
PAGES = [
    # file, kicker chip, headline, subline
    ('your-area', 'YOUR AREA', 'Who works for you, and what is about to be decided', 'Put in your address. Every seat that represents you, the next decisions, and what you can do now.'),
    ('account', 'ACCOUNT', 'Your We the People account', 'Sign in with a passkey or Google. Save your area, follow decisions, apply as an organizer.'),
    ('organizers', 'ORGANIZERS', 'Civic intelligence for organizers', 'Apply for organizer access: watchlists, alerts and the data behind every decision in Miami-Dade.'),
]

TEMPLATE = """<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#131F3C;color:#FAFAF7;font-family:'Libre Franklin','Helvetica Neue',Arial,sans-serif;position:relative;overflow:hidden}
svg{position:absolute;inset:0}
.k{position:absolute;left:72px;top:92px;font-family:'IBM Plex Mono',Menlo,monospace;font-size:26px;letter-spacing:.16em;color:#C9CFDF}
.m{position:absolute;left:66px;top:128px;font-weight:900;font-size:120px;letter-spacing:-.04em;line-height:1}
.chip{position:absolute;right:72px;top:96px;background:#2F6B3C;color:#FAFAF7;font-family:'IBM Plex Mono',Menlo,monospace;font-weight:600;font-size:22px;letter-spacing:.08em;padding:12px 18px;display:flex;align-items:center;gap:12px}
.chip:before{content:"";width:16px;height:16px;background:#8FD19E;display:inline-block}
h1{position:absolute;left:72px;right:200px;top:300px;font-weight:900;font-size:62px;line-height:1.04}
p{position:absolute;left:72px;right:240px;bottom:64px;font-size:28px;line-height:1.35;color:#C9CFDF}
</style></head><body>
<svg viewBox="0 0 1200 630" fill="none" stroke="#FAFAF7" stroke-opacity=".28" stroke-width="2">
<path d="M0 124 L180 98 L370 150 L585 112 L772 164 L1000 120 L1200 156"/><path d="M0 288 L210 262 L400 312 L605 278 L810 326 L1030 290 L1200 312"/>
<path d="M0 456 L170 430 L380 474 L600 444 L800 492 L1010 460 L1200 478"/><path d="M137 0 L150 188 L130 378 L156 630"/><path d="M357 0 L368 188 L350 378 L376 630"/>
<path d="M590 0 L604 188 L584 378 L610 630"/><path d="M811 0 L824 188 L804 378 L830 630"/><path d="M1031 0 L1044 188 L1024 378 L1050 630"/>
<path d="M1044 188 L1030 290 L1200 312 L1200 170 Z" fill="#2F6B3C" fill-opacity=".9" stroke="#8FD19E" stroke-opacity="1" stroke-width="3"/>
</svg>
<div class="k">WE THE PEOPLE</div><div class="m">305</div><div class="chip">{chip}</div><h1>{h1}</h1><p>{p}</p></body></html>"""

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        page = b.new_page(viewport={'width': 1200, 'height': 630})
        for name, chip, h1, p in PAGES:
            page.set_content(TEMPLATE.replace('{chip}', chip).replace('{h1}', h1).replace('{p}', p))
            page.wait_for_timeout(150)
            page.screenshot(path=str(OUT / (name + '.png')))
            print('wrote public/og/' + name + '.png')
        b.close()

if __name__ == '__main__':
    main()
