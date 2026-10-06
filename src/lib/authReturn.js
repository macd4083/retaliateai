const RETURN_PATHS = new Set([
  '/app', '/today', '/home', '/reflection', '/legacy/reflection',
  '/insights', '/settings', '/admin', '/admin/feedback', '/admin/session-log',
  '/admin/live-demo', '/admin/live-demo/insights',
]);

export function getSafeAuthReturn(value, origin = window.location.origin) {
  if (typeof value !== 'string' || !value || /[\\\u0000-\u0020]/.test(value)) return '/app';
  if (!value.startsWith('/') && !value.startsWith(`${origin}/`)) return '/app';
  if (value.startsWith('//')) return '/app';
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || !RETURN_PATHS.has(url.pathname)) return '/app';
    return `${url.pathname === '/reflection' ? '/app' : url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/app';
  }
}

export function getAuthCallbackUrl(returnTo, origin = window.location.origin) {
  const url = new URL('/auth/callback', origin);
  url.searchParams.set('next', getSafeAuthReturn(returnTo, origin));
  return url.href;
}

export function getAuthLinkError(search, hash) {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  return query.get('error_description') || fragment.get('error_description')
    || query.get('error') || fragment.get('error') || '';
}
