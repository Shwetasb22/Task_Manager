export function formatError(error) {
  const message = error?.message || String(error || 'The request failed.');
  const details = [error?.code && `Code: ${error.code}`, error?.details && `Details: ${error.details}`].filter(Boolean);
  return [message, ...details].join(' · ');
}

export function databaseError(error) {
  return Object.assign(new Error(error?.message || 'The database request failed.'), {
    code: error?.code,
    details: error?.details,
  });
}
