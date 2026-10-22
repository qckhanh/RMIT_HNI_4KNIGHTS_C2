// Shared types and display helpers. Display only: every rule is enforced by the backend.

// secureFetch needs an absolute URL (Tide pack AP-74).
export const API_URL = 'http://localhost:4000'
export const BANK_URL = 'http://localhost:4100'

export const ROLE_LABELS: Record<string, string> = {
  'chief-accountant': 'Chief accountant',
  cfo: 'CFO',
  'dept-head:ops': 'Ops head',
  'ap-clerk': 'AP clerk',
}
export const label = (role: string) => ROLE_LABELS[role] ?? role

export type Tone = 'success' | 'warning' | 'danger'
export const STATUS: Record<string, [string, Tone]> = {
  pending: ['Awaiting approval', 'warning'],
  approved: ['Approved', 'warning'],
  sent: ['Paid', 'success'],
  bank_rejected: ['Bank refused', 'danger'],
  rejected: ['Blocked', 'danger'],
}

export const money = (n: number) => `$${n.toLocaleString('en-US')}`
export const tierOf = (n: number) => (n <= 500 ? 'T0' : n <= 10_000 ? 'T1' : 'T2')
export const TIER_HINT: Record<string, string> = {
  T0: 'Up to $500. Needs the chief accountant.',
  T1: '$500 to $10,000. Needs the chief accountant.',
  T2: 'Over $10,000. Needs the ops head, chief accountant and CFO.',
}

export type Vendor = { id: string; name: string; account: string }
export type Approval = { username: string; role: string; at: string }
export type PaymentRequest = {
  id: string; vendorId: string; vendorName?: string; account: string; amount: number; purpose: string; tier: string
  requester: string; source: 'human' | 'penny'; status: string; approvals: Approval[]; missingRoles: string[]; reason?: string
  attestation?: { signers: string[]; pendingRequest?: string; policy?: string }
}
