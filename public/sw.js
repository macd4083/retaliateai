// Preserve the existing worker URL in development and for legacy installations.
// The production Workbox worker imports the same notification handlers.
importScripts('/push-sw.js');
