import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

// Every public page carries a full link preview with its own image, so shared links never fall back to a generic card.
const dir = new URL('../../public/', import.meta.url);
const pages = readdirSync(dir).filter(f => f.endsWith('.html'));
const REQUIRED = ['og:type', 'og:title', 'og:description', 'og:url', 'og:image', 'og:image:width', 'og:image:height', 'twitter:card', 'twitter:image'];

describe('link previews', () => {
  for (const f of pages) {
    it(f + ' has every preview tag and an image that exists', () => {
      const s = readFileSync(new URL(f, dir), 'utf8');
      for (const k of REQUIRED) expect(s, f + ' ' + k).toMatch(new RegExp('(property|name)="' + k + '"'));
      const img = s.match(/property="og:image" content="https:\/\/wethepeople305\.org\/([^"]+)"/)[1];
      expect(existsSync(new URL(img, dir)), img).toBe(true);
      expect(s).toMatch(/name="twitter:card" content="summary_large_image"/);
    });
  }
  it('no two pages share a preview image, except the home page', () => {
    const imgs = pages.filter(f => f !== 'index.html').map(f => readFileSync(new URL(f, dir), 'utf8').match(/property="og:image" content="([^"]+)"/)[1]);
    expect(new Set(imgs).size).toBe(imgs.length);
  });
});
