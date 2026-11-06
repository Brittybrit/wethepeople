// The meeting page: meet.wethepeople305.org (and wethepeople305.org/meet).
// It embeds the founder's booking page from a scheduling provider. The provider holds the calendar and sends the
// invite; this Worker stores nothing a visitor types. The booking page URL comes from the BRIT_BOOKING_PAGE_URL var in
// wrangler.toml. Until it is set, the page shows the email address instead.

export const MEET_HOST = 'meet.wethepeople305.org';
export const MEET_CONTACT_EMAIL = 'brit@wethepeople305.org';

// Providers we allow in the frame, and every origin the frame may load or redirect to.
const PROVIDERS = [
  { name: 'Google Calendar', hosts: ['calendar.google.com', 'calendar.app.google'], frameOrigins: ['https://calendar.google.com', 'https://calendar.app.google'],
    prepare: u => { if (u.hostname === 'calendar.google.com') u.searchParams.set('gv', 'true'); return u; } },
  { name: 'Cal.com', hosts: ['cal.com', 'app.cal.com'], frameOrigins: ['https://cal.com', 'https://app.cal.com'], prepare: u => u }
];

// Returns { src, provider, frameOrigins } for an allowed https booking URL, or null.
export function parseBookingPageUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const p = PROVIDERS.find(x => x.hosts.includes(u.hostname));
  if (!p) return null;
  return { src: p.prepare(u).toString(), provider: p.name, frameOrigins: p.frameOrigins };
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function meetHeaders(booking) {
  const frame = booking ? booking.frameOrigins.join(' ') : "'none'";
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': `default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-src ${frame}; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'`
  };
}

export function meetPage(booking) {
  const body = booking
    ? `<p class="sub">Pick a time that works for you. You will get a calendar invite by email.</p>
  <div class="frame wtp-card"><iframe src="${esc(booking.src)}" title="Book a time with Brit" loading="lazy"></iframe></div>
  <p class="fine">Booking runs on ${esc(booking.provider)}. What you enter goes to them to set up the meeting. We the People 305 does not see or keep it. <a href="${esc(booking.src)}" target="_blank" rel="noopener">Open the booking page in a new tab</a> if the calendar does not load.</p>`
    : `<p class="sub">Online booking is not open yet. Email <a href="mailto:${MEET_CONTACT_EMAIL}">${MEET_CONTACT_EMAIL}</a> and we will find a time.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Book time with Brit · We the People 305</title>
<link rel="canonical" href="https://${MEET_HOST}/">
<meta name="description" content="Book a meeting with Brit, founder of We the People 305.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="We the People 305">
<meta property="og:title" content="Book time with Brit · We the People 305">
<meta property="og:url" content="https://${MEET_HOST}/">
<meta property="og:image" content="https://wethepeople305.org/og.png">
<link rel="icon" href="https://wethepeople305.org/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;600;800;900&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/brand/brand.css">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.55}
  a{color:inherit}
  header{background:#131F3C;color:#FAFAF7;padding:22px 16px 20px}
  .wrap{max-width:860px;margin:0 auto}
  header .wrap{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}
  header a{text-decoration:none}
  .kicker{font-family:var(--mono);font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#C9CFDF}
  header .wtp-mark{font-size:44px}
  main{max-width:860px;margin:0 auto;padding:24px 16px 56px}
  h1{font-weight:900;font-size:26px;line-height:1.1;margin-bottom:6px}
  p{margin:8px 0}
  .sub{color:var(--ink-soft);font-size:15px}
  .frame{margin:16px 0 8px;background:#FFFFFF}
  .frame iframe{display:block;width:100%;height:760px;border:0}
  .fine{font-size:12px;color:var(--ink-soft);font-family:var(--mono)}
  footer{border-top:4px solid var(--ink);padding:18px 16px;font-family:var(--mono);font-size:12px;color:var(--ink-soft);text-align:center}
</style>
</head>
<body>
<header><div class="wrap">
  <a href="https://wethepeople305.org/"><div class="kicker">We the People</div><div class="wtp-mark">305</div></a>
  <span class="wtp-area">Meet</span>
</div></header>
<main>
  <h1>Book time with Brit</h1>
  <p>Founder, We the People 305.</p>
  ${body}
</main>
<footer>Open source (MIT) · <a href="https://github.com/Brittybrit/wethepeople">github.com/Brittybrit/wethepeople</a> · <a href="https://wethepeople305.org/docs/privacy.md">privacy</a><br>Nonpartisan. No money from candidates, campaigns, parties or political committees.</footer>
</body>
</html>
`;
}
