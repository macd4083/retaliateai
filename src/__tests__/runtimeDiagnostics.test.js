import { describe, expect, it, vi } from 'vitest';
import { BUILD_VERSION } from '../lib/buildVersion';
import { installUnhandledRejectionLogger } from '../lib/runtimeDiagnostics';

describe('runtime rejection diagnostics', () => {
  it('logs build identity and a trace without suppressing the browser error', () => {
    const target = new EventTarget();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dispose = installUnhandledRejectionLogger(target);
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.assign(event, { reason: new TypeError('Cannot read properties of undefined') });
    target.dispatchEvent(event);
    expect(log).toHaveBeenCalledWith('[Unhandled rejection]', expect.objectContaining({
      build: BUILD_VERSION,
      name: 'TypeError',
      stack: expect.stringContaining('TypeError'),
    }));
    expect(event.defaultPrevented).toBe(false);
    dispose();
    log.mockClear();
    target.dispatchEvent(event);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('does not serialize arbitrary rejection payloads', () => {
    const target = new EventTarget();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dispose = installUnhandledRejectionLogger(target);
    const event = new Event('unhandledrejection');
    Object.assign(event, { reason: { access_token: 'private-value' } });
    target.dispatchEvent(event);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-value');
    dispose();
    log.mockRestore();
  });
});
