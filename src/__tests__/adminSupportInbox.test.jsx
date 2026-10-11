import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: { user: { id: 'admin-a' }, loading: false }, from: vi.fn() }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../lib/supabase/client', () => ({ supabase: { from: mocks.from } }));
vi.mock('../components/v2/AppShellV2', () => ({ default: ({ children }) => <main>{children}</main> }));
import AdminSupportInbox from '../pages/AdminSupportInbox';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const id = '11111111-1111-4111-8111-111111111111';
const message = {
  id, subject: 'Support request', sender: 'sender@example.test',
  recipients: ['help@example.test'], cc: ['copy@example.test'],
  received_at: '2026-10-10T12:00:00Z', created_at: '2026-10-10T12:01:00Z',
  provider_email_id: 'provider-id', message_id: '<email-id@example.test>',
  text_body: 'Please help https://untrusted.example',
  html_body: '<script>alert(1)</script><img src="https://untrusted.example/pixel"><a href="https://untrusted.example">Click</a>',
  attachments: [{ id: 'attachment-id', filename: 'image.png', content_type: 'image/png', size: 42, content_id: 'inline-id', disposition: 'inline', url: 'https://untrusted.example/file' }],
};
const success = (data, count) => ({ data, count, error: null });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

describe('Admin support inbox', () => {
  let root;
  let container;
  let queries;
  let replies;

  const render = async (path = '/admin/support-inbox') => act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><Routes>
      <Route path="/admin/support-inbox" element={<AdminSupportInbox />} />
      <Route path="/admin/support-inbox/:messageId" element={<AdminSupportInbox />} />
    </Routes></MemoryRouter>);
  });
  const click = async (label) => {
    const button = [...container.querySelectorAll('button')].find((node) => node.textContent === label);
    expect(button).toBeTruthy();
    await act(async () => button.click());
  };
  const supportQueries = () => queries.filter((query) => query.table === 'support_messages');
  const deletions = () => supportQueries().filter((query) => query.ops.some(([op]) => op === 'delete'));

  beforeEach(() => {
    mocks.auth = { user: { id: 'admin-a' }, loading: false };
    queries = [];
    replies = {
      user_profiles: [success({ role: 'admin' })],
      support_messages: [success([message], 1)],
      support_notification_jobs: [success([{ message_id: id, status: 'needs_review', attempts: 2, last_error: 'Delivery uncertain' }])],
    };
    mocks.from.mockReset();
    mocks.from.mockImplementation((table) => {
      const entry = { table, ops: [] };
      queries.push(entry);
      const query = {};
      for (const op of ['select', 'eq', 'order', 'range', 'maybeSingle', 'delete']) {
        query[op] = (...args) => { entry.ops.push([op, ...args]); return query; };
      }
      query.then = (resolve, reject) => {
        const reply = replies[table].shift();
        return Promise.resolve(typeof reply === 'function' ? reply() : reply).then(resolve, reject);
      };
      return query;
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it.each([success({ role: 'user' }), success(null)])('denies non-admin or missing profiles without loading private tables (%j)', async (reply) => {
    replies.user_profiles = [reply];
    await render();
    expect(container.textContent).toContain('Administrator access required');
    expect(queries.map((query) => query.table)).toEqual(['user_profiles']);
    expect(queries[0].ops).toContainEqual(['eq', 'id', 'admin-a']);
  });

  it.each([
    () => ({ data: null, error: { message: 'Profile permission denied' } }),
    () => Promise.reject(new Error('Profile network unavailable')),
  ])('reports profile failures honestly and never reads messages (%j)', async (reply) => {
    replies.user_profiles = [reply];
    await render();
    expect(container.querySelector('[role="alert"]').textContent).toContain('Unable to verify administrator access');
    expect(supportQueries()).toHaveLength(0);
  });

  it('waits for authorization and discards a stale admin result after an identity change', async () => {
    const profile = deferred();
    replies.user_profiles = [profile.promise, success({ role: 'user' })];
    await render();
    expect(container.textContent).toContain('Checking administrator access');
    expect(supportQueries()).toHaveLength(0);
    mocks.auth.user = { id: 'other-user' };
    await render();
    await act(async () => profile.resolve(success({ role: 'admin' })));
    expect(container.textContent).toContain('Administrator access required');
    expect(supportQueries()).toHaveLength(0);
  });

  it('hides already loaded private messages immediately when the user changes or signs out', async () => {
    await render();
    expect(container.textContent).toContain(message.subject);
    mocks.auth.user = { id: 'other-user' };
    replies.user_profiles = [success({ role: 'user' })];
    await render();
    expect(container.textContent).not.toContain(message.subject);
    mocks.auth.user = null;
    await render();
    expect(container.textContent).toContain('Sign in');
    expect(supportQueries()).toHaveLength(1);
  });

  it('ignores an in-flight private response after the authorized user changes', async () => {
    const messages = deferred();
    replies.support_messages = [messages.promise];
    await render();
    mocks.auth.user = { id: 'other-user' };
    replies.user_profiles = [success({ role: 'user' })];
    await render();
    await act(async () => messages.resolve(success([message], 1)));
    expect(container.textContent).not.toContain(message.subject);
    expect(container.textContent).toContain('Administrator access required');
  });

  it('links list rows to exact-ID details and displays inert bodies, attachment metadata, and read-only notification status', async () => {
    await render();
    const link = container.querySelector('article a');
    expect(link.getAttribute('href')).toBe(`/admin/support-inbox/${id}`);
    replies.support_messages.push(success(message));
    await act(async () => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
    expect(supportQueries()[1].ops).toContainEqual(['eq', 'id', id]);
    expect(supportQueries()[1].ops).toContainEqual(['maybeSingle']);
    for (const value of [message.sender, ...message.recipients, ...message.cc, id, message.provider_email_id, message.message_id, message.text_body, message.html_body, 'image.png', '42', 'needs_review', 'Delivery uncertain']) {
      expect(container.textContent).toContain(value);
    }
    expect(container.textContent).toContain('Metadata only');
    expect(container.textContent).not.toContain(message.attachments[0].url);
    expect(container.querySelectorAll('script,img,iframe,article a')).toHaveLength(0);
    expect(queries.find((query) => query.table === 'support_notification_jobs').ops).toEqual([
      ['select', 'message_id,status,last_error,attempts'], ['eq', 'message_id', id],
    ]);
  });

  it('opens a deep link without fetching the inbox list and handles absent nullable bodies', async () => {
    replies.support_messages = [success({ ...message, text_body: null, html_body: null, attachments: [] })];
    await render(`/admin/support-inbox/${id}`);
    expect(supportQueries()).toHaveLength(1);
    expect(supportQueries()[0].ops).toContainEqual(['eq', 'id', id]);
    expect(container.textContent).toContain('No plain-text body');
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).toContain('No attachment metadata');
  });

  it('shows missing detail and query errors without claiming the inbox is empty', async () => {
    replies.support_messages = [success(null)];
    await render(`/admin/support-inbox/${id}`);
    expect(container.textContent).toContain('Message not found or not accessible');
    replies.support_messages.push({ error: { message: 'Database unavailable' } });
    await click('Refresh');
    expect(container.querySelector('[role="alert"]').textContent).toContain('Database unavailable');
    expect(container.textContent).not.toContain('Message not found');
  });

  it('reports notification read errors while preserving the message detail', async () => {
    replies.support_messages = [success(message)];
    replies.support_notification_jobs = [() => Promise.reject(new Error('Notification network failure'))];
    await render(`/admin/support-inbox/${id}`);
    expect(container.textContent).toContain(message.text_body);
    expect(container.textContent).toContain('Unable to load notification status: Notification network failure');
  });

  it('requires confirmation and only reports success after the exact deleted row is returned', async () => {
    await render();
    window.confirm.mockReturnValueOnce(false);
    await click('Delete message');
    expect(deletions()).toHaveLength(0);
    const pending = deferred();
    replies.support_messages.push(pending.promise);
    await click('Delete message');
    expect(container.textContent).toContain('Deleting message');
    expect([...container.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    expect(container.textContent).not.toContain('Message deleted.');
    expect(deletions()[0].ops).toEqual([['delete'], ['eq', 'id', id], ['select', 'id']]);
    replies.support_messages.push(success([], 0));
    await act(async () => pending.resolve(success([{ id }])));
    expect(container.textContent).toContain('Message deleted.');
    expect(container.querySelector('article')).toBeNull();
  });

  it.each([
    [{ error: { message: 'Delete permission denied' } }, 'Delete permission denied'],
    [success([]), 'Deletion was not confirmed'],
    [success([{ id: 'wrong-id' }]), 'Deletion was not confirmed'],
  ])('retains the row and reports failed or unconfirmed deletion (%j)', async (reply, expected) => {
    await render();
    replies.support_messages.push(reply);
    await click('Delete message');
    expect(container.textContent).toContain(`Delete failed: ${expected}`);
    expect(container.textContent).not.toContain('Message deleted.');
    expect(container.querySelector('article')).not.toBeNull();
    expect([...container.querySelectorAll('button')].find((button) => button.textContent === 'Delete message').disabled).toBe(false);
  });

  it('recovers from rejected deletion requests and allows a verified retry', async () => {
    await render();
    replies.support_messages.push(() => Promise.reject(new Error('Delete network failure')));
    await click('Delete message');
    expect(container.textContent).toContain('Delete failed: Delete network failure');
    replies.support_messages.push(success([{ id }]));
    replies.support_messages.push(success([], 0));
    await click('Delete message');
    expect(container.textContent).toContain('Message deleted.');
  });

  it('does not expose a stale deletion result after a user change', async () => {
    await render();
    const pending = deferred();
    replies.support_messages.push(pending.promise);
    await click('Delete message');
    mocks.auth.user = { id: 'other-user' };
    replies.user_profiles = [success({ role: 'user' })];
    await render();
    await act(async () => pending.resolve(success([{ id }])));
    expect(container.textContent).toContain('Administrator access required');
    expect(container.textContent).not.toContain('Message deleted.');
  });

  it('paginates in deterministic 25-row ranges and disables next on the final page', async () => {
    replies.support_messages = [success(Array.from({ length: 25 }, (_, index) => ({ ...message, id: `row-${index}` })), 26), success([{ ...message, id: 'last-row' }], 26)];
    await render();
    expect(container.querySelectorAll('article')).toHaveLength(25);
    expect(supportQueries()[0].ops).toContainEqual(['range', 0, 24]);
    expect(supportQueries()[0].ops).toContainEqual(['order', 'id', { ascending: false }]);
    await click('Next');
    expect(supportQueries()[1].ops).toContainEqual(['range', 25, 49]);
    expect(container.querySelectorAll('article')).toHaveLength(1);
    expect(container.textContent).toContain('Page 2');
    expect([...container.querySelectorAll('button')].find((button) => button.textContent === 'Next').disabled).toBe(true);
    replies.support_messages.push(success([message], 26));
    await click('Previous');
    expect(supportQueries()[2].ops).toContainEqual(['range', 0, 24]);
  });
});
