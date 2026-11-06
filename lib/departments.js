export const DEPARTMENT_ALIASES = {
  PM: 'PRGM',
  'PM-BI': 'PRGM',
  'PM_BI': 'PRGM',
  'PM-BREMBO': 'PRGM',
  'PM_BREMBO': 'PRGM',
  'PM-AM': 'PRGM',
  'PM-PUR': 'PRGM',
  SALES: 'KAM',
  ENGG: 'PE',
  PROCESS: 'PRCE',
  QUALITY: 'QE',
  PUR: 'PBYR',
  'PUR-INDIRECT': 'PBYR',
  LOG: 'LOG',
  FINANCE: 'CE',
  Finance: 'CE',
};

export function normalizeDepartment(value) {
  const cleaned = String(value || '').trim();
  return DEPARTMENT_ALIASES[cleaned] || DEPARTMENT_ALIASES[cleaned.toUpperCase()] || cleaned || 'Unassigned';
}