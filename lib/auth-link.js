// Reads what a Supabase email link (password reset, confirmation) left in the address bar.
// The app used to rely only on the PASSWORD_RECOVERY event, which can fire before the page is
// listening. Reading the address directly makes the "set a new password" screen reliable.

const EXPIRED = 'That link has expired or was already used. Some email scanners open links before you do. Request a new link and open it right away.';

// hash is window.location.hash, search is window.location.search.
export function parseAuthLink(hash = '', search = '') {
  const fromHash = new URLSearchParams(String(hash).replace(/^#/, ''));
  const fromSearch = new URLSearchParams(String(search).replace(/^\?/, ''));
  const get = (key) => fromHash.get(key) ?? fromSearch.get(key);

  const code = get('error_code');
  const error = get('error');
  if (code || error) {
    const text = code === 'otp_expired' || error === 'access_denied'
      ? EXPIRED
      : (get('error_description') || 'The link could not be used. Request a new one.').replace(/\+/g, ' ');
    return { recovery: false, error: text };
  }
  return { recovery: get('type') === 'recovery', error: null };
}
