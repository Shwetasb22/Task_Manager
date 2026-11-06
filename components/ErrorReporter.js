'use client';
import { useEffect } from 'react';

// Sends unexpected errors in the browser to the server (/api/client-error), so they show up in the
// server log and, if configured, in Teams. At most 5 reports per page load, each message once.
const sent = new Set();

export function reportError(kind, error, extra = {}) {
  try {
    const message = String((error && error.message) || error || 'Unknown error').slice(0, 300);
    if (sent.has(message) || sent.size >= 5) return;
    sent.add(message);
    const body = JSON.stringify({
      kind,
      message,
      stack: String((error && error.stack) || '').slice(0, 2000),
      url: window.location.href,
      agent: navigator.userAgent,
      ...extra,
    });
    if (!(navigator.sendBeacon && navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' })))) {
      fetch('/api/client-error', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } catch {
    // Reporting must never cause an error of its own.
  }
}

export default function ErrorReporter({ user }) {
  useEffect(() => {
    const extra = user ? { user } : {};
    const onError = (e) => {
      // Ignore failed image/script loads and errors from browser extensions.
      if (!e.error && !e.message) return;
      if (/^(chrome|moz|safari)-extension:/.test(e.filename || '')) return;
      reportError('error', e.error || e.message, extra);
    };
    const onRejection = (e) => reportError('rejection', e.reason, extra);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [user]);
  return null;
}
