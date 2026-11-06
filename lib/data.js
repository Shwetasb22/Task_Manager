import { fmtDate as _fmt } from './rules';

// DEMO-MODE ONLY: quick-login accounts shown when Supabase is not configured.
// In production, people, roles and tracker names come from the `profiles` table.
export const MANAGER_DEPTS = {
  'Sagar Ingle': 'PRGM',
  'Abhijit Mendki': 'LAUNCH',
  'Akhil Deshmukh': 'PRCE',
  'Yogesh Dhamale': 'KAM',
};

export const MANAGERS = Object.entries(MANAGER_DEPTS).map(([name, dept]) => ({ name, dept }));

export const MAIN_TEAM_MANAGERS = [
  'Abhijit Mendki',
  'Akhil Deshmukh',
  'Sagar Ingle',
  'Vishal Shinde',
  'Yogesh Dhamale',
];

export const QUICK_LOGINS = [
  { name: 'Naveen Sahni', role: 'Admin', dept: 'All' },
  { name: 'Vishal Shinde', role: 'Admin', dept: 'All', canEditOwnerNames: true },
  { name: 'Sagar Ingle', role: 'Manager', dept: 'PRGM' },
  { name: 'Abhijit Mendki', role: 'Manager', dept: 'LAUNCH' },
  { name: 'Akhil Deshmukh', role: 'Manager', dept: 'PRCE' },
  { name: 'Yogesh Dhamale', role: 'Manager', dept: 'KAM' },
  // Demo-only accounts so the owner and department-head flows (proof, close, remarks, L1/L3) can be tried.
  { name: 'Vishal Pawar', role: 'Owner', dept: 'PRGM' },
  { name: 'Process Dept Head', role: 'Dept Head', dept: 'PROCESS' },
];

export const fmtDate = _fmt;
