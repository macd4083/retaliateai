// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));

describe('scheduler deployment boundaries', () => {
  it('retires legacy coaching endpoints and stays within the Hobby function budget', () => {
    const apiFiles = [];
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(filename);
        else if (entry.name.endsWith('.js')) apiFiles.push(path.relative(root, filename));
      }
    };
    visit(path.join(root, 'api'));
    for (const endpoint of ['reflection-coach', 'goals', 'synthesize-insights']) {
      expect(fs.existsSync(path.join(root, 'api', `${endpoint}.js`))).toBe(false);
    }
    expect(apiFiles.length).toBeLessThanOrEqual(12);
    expect(apiFiles).toEqual(expect.arrayContaining([
      'api/google-calendar.js', 'api/commitment-stats.js', 'api/admin.js',
      'api/stripe.js', 'api/stripe-webhook.js', 'api/feedback.js',
    ]));
    expect(fs.existsSync(path.join(root, 'src/pages/ReflectionV2.jsx'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'scripts/simulate-reflection.js'))).toBe(false);
  });

  it('provides the serverless Node crypto and abort timeout APIs', async () => {
    const { createHash, randomBytes } = await import('node:crypto');
    expect(createHash('sha256').update(randomBytes(32)).digest()).toHaveLength(32);
    const signal = AbortSignal.timeout(1);
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    expect(signal.reason.name).toBe('TimeoutError');
  });

  it('keeps API and Calendar callbacks out of the SPA fallback', () => {
    const config = JSON.parse(fs.readFileSync(`${root}/vercel.json`, 'utf8'));
    const fallback = config.rewrites.find((rewrite) => rewrite.destination === '/index.html');
    const matcher = new RegExp(`^${fallback.source}$`);
    expect(matcher.test('/today')).toBe(true);
    expect(matcher.test('/home')).toBe(true);
    expect(matcher.test('/settings')).toBe(true);
    expect(matcher.test('/api/google-calendar')).toBe(false);
    expect(matcher.test('/api/stripe')).toBe(false);
    expect(matcher.test('/api/google-calendar?action=status')).toBe(false);
    expect(matcher.test('/api/google-calendar?action=callback')).toBe(false);
  });

  it('imports the actual API without optional Google configuration and returns JSON', async () => {
    const { default: handler } = await import('../../api/google-calendar.js');
    const headers = {};
    const response = {
      setHeader(name, value) { headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await handler({ method: 'GET', query: { action: 'status' }, headers: {} }, response);
    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual(expect.objectContaining({ code: 'unauthorized' }));
    expect(headers['Cache-Control']).toContain('no-store');
  });

  it('keeps backend secrets and Node crypto outside all browser source imports', () => {
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') visit(filename);
        } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
          const source = fs.readFileSync(filename, 'utf8');
          expect(source, filename).not.toMatch(/(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"][^'"]*(?:node:crypto|\/server\/)/);
          expect(source, filename).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|GOOGLE_CALENDAR_CLIENT_SECRET|GOOGLE_CALENDAR_ENCRYPTION_KEY/);
        }
      }
    };
    visit(path.join(root, 'src'));
  });

  it('locks review textareas with supported native readOnly behavior while completing', () => {
    const page = fs.readFileSync(path.join(root, 'src/v2/pages/TodayV2Page.jsx'), 'utf8');
    expect(page).toContain('const readOnly = isCompleted || completionSaving;');
    expect(page).not.toMatch(/\binteractionDisabled\s*=/);
  });
});
