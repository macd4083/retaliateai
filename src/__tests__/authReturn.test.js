import { describe, expect, it } from 'vitest';
import { getAuthCallbackUrl, getAuthLinkError, getSafeAuthReturn } from '../lib/authReturn';

const origin = 'https://retaliate.example';

describe('safe auth return destinations', () => {
  it.each(['/app', '/today', '/home', '/insights', '/settings', '/legacy/reflection', '/admin/feedback'])(
    'preserves the allowlisted path %s', (path) => {
      expect(getSafeAuthReturn(path, origin)).toBe(path);
      expect(getSafeAuthReturn(`${origin}${path}`, origin)).toBe(path);
    }
  );

  it('preserves reminder query and anchor state', () => {
    expect(getSafeAuthReturn('/today?source=reminder#review', origin)).toBe('/today?source=reminder#review');
  });

  it('normalizes old generic entry links to /app', () => {
    expect(getSafeAuthReturn('/reflection?source=old-link', origin)).toBe('/app?source=old-link');
  });

  it.each([
    undefined, null, '', '/', '/login', '/login?next=/today', '/auth/callback',
    '/auth/reset-password', '/not-a-route', '/today/extra', 'https://evil.example/today',
    '//evil.example/today', '/\\evil.example/today', 'javascript:alert(1)',
    'https://retaliate.example.evil.example/today', 'https://retaliate.example@evil.example/today',
    '/%2f%2fevil.example', '/%74oday', ' /today', '/today\n', '/today\t',
  ])('defaults unsafe or unsupported return %s to /app', (value) => {
    expect(getSafeAuthReturn(value, origin)).toBe('/app');
  });

  it('builds confirmation URLs with a sanitized return target', () => {
    const url = new URL(getAuthCallbackUrl('//evil.example', origin));
    expect(url.origin).toBe(origin);
    expect(url.pathname).toBe('/auth/callback');
    expect(url.searchParams.get('next')).toBe('/app');
    expect(new URL(getAuthCallbackUrl('/today?source=email', origin)).searchParams.get('next'))
      .toBe('/today?source=email');
  });
});

describe('auth link diagnostics', () => {
  it('reads useful errors from query and implicit auth fragments', () => {
    expect(getAuthLinkError('?error=access_denied&error_description=Link+expired', '')).toBe('Link expired');
    expect(getAuthLinkError('', '#error=access_denied&error_description=Invalid+token')).toBe('Invalid token');
    expect(getAuthLinkError('?error=access_denied', '')).toBe('access_denied');
    expect(getAuthLinkError('', '')).toBe('');
  });
});
