import { describe, it, expect } from 'vitest';
import { parseBookingPageUrl, meetPage, meetHeaders } from '../../lib/meet.mjs';

describe('meeting page', () => {
  it('accepts Google Calendar and Cal.com booking pages over https', () => {
    const g = parseBookingPageUrl('https://calendar.google.com/calendar/appointments/schedules/AcZssZ1abc');
    expect(g.provider).toBe('Google Calendar');
    expect(g.src).toContain('gv=true');
    expect(parseBookingPageUrl('https://calendar.app.google/AbC123').provider).toBe('Google Calendar');
    expect(parseBookingPageUrl('https://cal.com/brit/30min').src).toBe('https://cal.com/brit/30min');
  });
  it('refuses anything else, so the frame can only show a known provider', () => {
    for (const bad of ['', '   ', null, undefined, 'not a url', 'http://cal.com/brit', 'https://evil.example/cal.com', 'https://cal.com.evil.example/x', 'https://u:p@cal.com/brit', 'javascript:alert(1)'])
      expect(parseBookingPageUrl(bad)).toBeNull();
  });
  it('shows the email when booking is not set up, and frames nothing', () => {
    const html = meetPage(null);
    expect(html).toContain('mailto:brit@wethepeople305.org');
    expect(html).not.toContain('<iframe');
    expect(meetHeaders(null)['Content-Security-Policy']).toContain("frame-src 'none'");
  });
  it('frames only the provider it was given', () => {
    const b = parseBookingPageUrl('https://cal.com/brit/30min');
    expect(meetPage(b)).toContain('<iframe class="booking" src="https://cal.com/brit/30min"');
    const csp = meetHeaders(b)['Content-Security-Policy'];
    expect(csp).toContain('frame-src https://cal.com https://app.cal.com;');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('script-src');
  });
});
