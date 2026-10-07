import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = '/home/runner/work/retaliateai/retaliateai';

describe('scheduler deployment boundaries', () => {
  it('keeps API and Calendar callbacks out of the SPA fallback', () => {
    const config = JSON.parse(fs.readFileSync(`${root}/vercel.json`, 'utf8'));
    const fallback = config.rewrites.find((rewrite) => rewrite.destination === '/index.html');
    const matcher = new RegExp(`^${fallback.source}$`);
    expect(matcher.test('/today')).toBe(true);
    expect(matcher.test('/home')).toBe(true);
    expect(matcher.test('/settings')).toBe(true);
    expect(matcher.test('/api/google-calendar')).toBe(false);
    expect(matcher.test('/api/stripe')).toBe(false);
  });
});
