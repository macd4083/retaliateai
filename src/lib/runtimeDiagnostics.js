import { BUILD_VERSION } from './buildVersion';

export function installUnhandledRejectionLogger(target = window) {
  const handler = (event) => {
    const reason = event.reason;
    // Do not log arbitrary rejection payloads, which may contain user data.
    console.error('[Unhandled rejection]', {
      build: BUILD_VERSION,
      name: reason instanceof Error ? reason.name : 'Non-Error rejection',
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  };
  target.addEventListener('unhandledrejection', handler);
  return () => target.removeEventListener('unhandledrejection', handler);
}
