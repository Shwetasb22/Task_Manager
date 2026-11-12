// Who may enter the app. Owners are approved on sign-up; a Manager request waits for an Admin.
// The database decides what each person can really do; this only chooses which screen to show.

// Sign-up offers two choices. Anything else (Admin, Dept Head) cannot be requested.
export const SIGNUP_ROLES = ['Owner', 'Manager'];

export function requestedRoleFor(label) {
  return label === 'Manager' ? 'manager' : 'owner';
}

// 'approved' | 'pending' | 'rejected'. A database without the access columns means everyone is approved.
export function accessOf(profile) {
  const status = profile?.status;
  return status === 'pending' || status === 'rejected' ? status : 'approved';
}

export function isApproved(session) {
  return !session?.access || session.access === 'approved';
}
