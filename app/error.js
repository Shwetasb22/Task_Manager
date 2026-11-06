'use client';
import { useEffect } from 'react';
import { reportError } from '@/components/ErrorReporter';

// Shown instead of a blank page when something on the page breaks. The error is reported to the server.
export default function PageError({ error, reset }) {
  useEffect(() => { reportError('render', error); }, [error]);
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="bg-white border border-brembo-line rounded-lg shadow-card max-w-md p-6 text-[13.5px]" role="alert">
        <h1 className="text-[17px] font-bold mb-2">Something went wrong on this page</h1>
        <p className="text-brembo-sub mb-4">Nothing you saved is lost. The problem has been reported. Try again, or reload the page.</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => reset()} className="rounded-full px-4 py-1.5 bg-brembo-red text-white font-semibold">Try again</button>
          <button type="button" onClick={() => window.location.reload()} className="rounded-full px-4 py-1.5 border border-brembo-line font-semibold">Reload</button>
        </div>
      </div>
    </div>
  );
}
