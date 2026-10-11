import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase/client';
import AppShellV2 from '../components/v2/AppShellV2';

const PAGE_SIZE = 25;
const LIST_FIELDS = 'id,sender,recipients,cc,subject,received_at,created_at';
const DETAIL_FIELDS = `${LIST_FIELDS},provider_email_id,message_id,text_body,html_body,attachments`;
const buttonClass = 'rounded-lg border border-zinc-700 px-3 py-2 text-sm disabled:opacity-50';
const errorText = (error) => error?.message || 'Unknown database or network error';
const addresses = (values) => Array.isArray(values) && values.length ? values.join(', ') : '—';
const dateText = (value) => value ? new Date(value).toLocaleString() : '—';

export default function AdminSupportInbox() {
  const { user, loading } = useAuth();
  const { messageId } = useParams();
  if (loading) return <p role="status">Checking authentication…</p>;
  if (!user?.id) return <p role="alert">Sign in to access the support inbox.</p>;
  // Remount on identity changes so prior authorization and private data cannot carry over.
  return <AdminAccess key={user.id} userId={user.id} messageId={messageId} />;
}

function AdminAccess({ userId, messageId }) {
  const [access, setAccess] = useState({ status: 'checking', error: '' });
  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const { data, error } = await supabase.from('user_profiles').select('role').eq('id', userId).maybeSingle();
        if (error) throw error;
        if (active) setAccess({ status: data?.role === 'admin' ? 'admin' : 'denied', error: '' });
      } catch (error) {
        if (active) setAccess({ status: 'error', error: errorText(error) });
      }
    }
    check();
    return () => { active = false; };
  }, [userId]);

  if (access.status === 'checking') return <p role="status">Checking administrator access…</p>;
  if (access.status === 'error') return <p role="alert">Unable to verify administrator access: {access.error}</p>;
  if (access.status !== 'admin') return <p role="alert">Administrator access required.</p>;
  return <InboxContent key={messageId || 'list'} messageId={messageId} />;
}

function InboxContent({ messageId }) {
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [messages, setMessages] = useState([]);
  const [count, setCount] = useState(0);
  const [jobs, setJobs] = useState([]);
  const [jobsError, setJobsError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleted, setDeleted] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const active = useRef(true);
  const deleteLock = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    async function load() {
      setLoading(true);
      setError('');
      setJobsError('');
      setMessages([]);
      setJobs([]);
      setDeleteError('');
      try {
        let query = supabase.from('support_messages').select(messageId ? DETAIL_FIELDS : LIST_FIELDS, { count: 'exact' });
        query = messageId
          ? query.eq('id', messageId).maybeSingle()
          : query.order('received_at', { ascending: false }).order('id', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        const result = await query;
        if (!current) return;
        if (result.error) throw result.error;
        setMessages(messageId ? (result.data ? [result.data] : []) : (result.data || []));
        setCount(result.count || 0);
        if (messageId && result.data) {
          try {
            const notification = await supabase.from('support_notification_jobs')
              .select('message_id,status,last_error,attempts').eq('message_id', messageId);
            if (notification.error) throw notification.error;
            if (current) setJobs(notification.data || []);
          } catch (jobError) {
            if (current) setJobsError(errorText(jobError));
          }
        }
      } catch (loadError) {
        if (current) setError(errorText(loadError));
      } finally {
        if (current) setLoading(false);
      }
    }
    load();
    return () => { current = false; };
  }, [messageId, page, revision]);

  async function deleteMessage(id) {
    if (!active.current || loading || deleteLock.current || !window.confirm('Permanently delete this support message?')) return;
    deleteLock.current = true;
    setDeleting(true);
    setDeleteError('');
    setDeleted(false);
    try {
      const { data, error: databaseError } = await supabase.from('support_messages').delete().eq('id', id).select('id');
      if (databaseError) throw databaseError;
      if (!Array.isArray(data) || data.length !== 1 || data[0].id !== id) {
        throw new Error('Deletion was not confirmed by the database. The message may be missing or access denied.');
      }
      if (!active.current) return;
      setMessages((previous) => previous.filter((message) => message.id !== id));
      setCount((previous) => Math.max(0, previous - 1));
      setDeleted(true);
      if (!messageId) {
        if (messages.length === 1 && page > 0) setPage((previous) => previous - 1);
        setRevision((previous) => previous + 1);
      }
    } catch (failure) {
      if (active.current) setDeleteError(errorText(failure));
    } finally {
      deleteLock.current = false;
      if (active.current) setDeleting(false);
    }
  }

  return (
    <AppShellV2 title="Support Inbox">
      <div className="h-full overflow-y-auto px-4 py-6 space-y-5 text-zinc-200">
        <div className="flex flex-wrap items-center gap-4">
          <h2 className="text-lg font-semibold">Support Inbox</h2>
          {messageId && <Link className="underline" to="/admin/support-inbox">Back to inbox</Link>}
          <button className={buttonClass} disabled={loading || deleting} onClick={() => setRevision((value) => value + 1)}>Refresh</button>
        </div>
        {loading && <p role="status">Loading support messages…</p>}
        {error && <p role="alert">Unable to load support messages: {error}</p>}
        {deleteError && <p role="alert">Delete failed: {deleteError}</p>}
        {deleting && <p role="status">Deleting message…</p>}
        {deleted && <p role="status">Message deleted.</p>}
        {!loading && !error && !deleted && messages.length === 0 && <p>{messageId ? 'Message not found or not accessible.' : 'No support messages.'}</p>}
        {!loading && messages.map((message) => (
          <article key={message.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3 break-words">
            <h3 className="font-semibold">{messageId ? message.subject || '(No subject)' : <Link className="underline" to={`/admin/support-inbox/${encodeURIComponent(message.id)}`}>{message.subject || '(No subject)'}</Link>}</h3>
            <p>From: {message.sender || '—'}</p>
            <p>To: {addresses(message.recipients)}</p>
            <p>Cc: {addresses(message.cc)}</p>
            <p>Received: {dateText(message.received_at)}</p>
            <p>Created: {dateText(message.created_at)}</p>
            <p>Inbox ID: {message.id}</p>
            {messageId && <>
              <p>Provider email ID: {message.provider_email_id || '—'}</p>
              <p>Email Message-ID: {message.message_id || '—'}</p>
              <h4 className="font-semibold">Plain text</h4>
              <pre className="whitespace-pre-wrap break-words font-sans">{message.text_body ?? 'No plain-text body.'}</pre>
              {message.html_body != null && <details>
                <summary>HTML source (inert text only)</summary>
                <pre className="whitespace-pre-wrap break-all">{message.html_body}</pre>
              </details>}
              <h4 className="font-semibold">Attachments</h4>
              <p>Metadata only. Attachments cannot be opened or downloaded here.</p>
              {Array.isArray(message.attachments) && message.attachments.length > 0
                ? <ul className="space-y-2">{message.attachments.map((attachment, index) => (
                  <li key={index} className="border border-zinc-800 p-2">
                    {['id', 'filename', 'content_type', 'size', 'content_id', 'disposition'].map((field) => (
                      <p key={field}>{field}: {String(attachment?.[field] ?? '—')}</p>
                    ))}
                  </li>
                ))}</ul> : <p>No attachment metadata.</p>}
              <h4 className="font-semibold">Notification delivery (read-only)</h4>
              {jobsError ? <p role="alert">Unable to load notification status: {jobsError}</p>
                : jobs.length ? jobs.map((job, index) => <div key={index}>
                  <p>Status: {job.status}</p><p>Attempts: {job.attempts ?? '—'}</p><p>Last error: {job.last_error || '—'}</p>
                </div>) : <p>No notification job recorded.</p>}
            </>}
            <button className={buttonClass} disabled={deleting || loading} onClick={() => deleteMessage(message.id)}>Delete message</button>
          </article>
        ))}
        {!messageId && <nav aria-label="Inbox pagination" className="flex items-center gap-4">
          <button className={buttonClass} disabled={loading || deleting || page === 0} onClick={() => setPage((value) => value - 1)}>Previous</button>
          <span>Page {page + 1}</span>
          <button className={buttonClass} disabled={loading || deleting || Boolean(error) || (page + 1) * PAGE_SIZE >= count} onClick={() => setPage((value) => value + 1)}>Next</button>
        </nav>}
      </div>
    </AppShellV2>
  );
}
