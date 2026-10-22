// Countersign approval rules (plan B "Luật duyệt"). Roles always come from a verified token;
// this module never trusts identity or roles passed in a request body.
import fs from 'node:fs';
import crypto from 'node:crypto';

const DATA = new URL('../data/', import.meta.url);
const REQUESTS_FILE = process.env.REQUESTS_FILE ?? new URL('requests.json', DATA); // override in payments.check.ts
const MOCKBANK_URL = process.env.MOCKBANK_URL ?? 'http://localhost:4100';
// Hướng 2: approved requests wait for a network-signed attestation before going to the bank.
export const ATTESTATION_REQUIRED = process.env.ATTESTATION_REQUIRED === 'true' || process.argv.includes('--attest');

export type Tier = 'T0' | 'T1' | 'T2';
export type Status = 'pending' | 'approved' | 'sent' | 'bank_rejected' | 'rejected';
export type Vendor = { id: string; name: string; account: string };
export type Approval = { username: string; role: string; at: string };
export type PaymentRequest = {
  id: string;
  vendorId: string;
  vendorName?: string;
  account: string;
  amount: number;
  purpose: string;
  tier: Tier;
  requester: string;
  source: 'human' | 'penny';
  status: Status;
  approvals: Approval[];
  reason?: string; // why it was rejected (at creation, by an approver, or by the bank)
  createdAt: string;
  // Hướng 2. The backend only relays these bytes; the bank verifies them against the Tide network key.
  attestation?: {
    signers: string[];
    pendingRequest?: string; // base64 Tide sign request carrying the approvals collected so far
    policy?: string; // base64 policy signed by the Tide network
  };
};

export class HttpError extends Error {
  constructor(public status: number, message: string, public request?: PaymentRequest) { super(message); }
}

// Roles each tier needs, one signature per role.
const REQUIRED: Record<Tier, string[]> = {
  T0: ['chief-accountant'],
  T1: ['chief-accountant'],
  T2: ['dept-head:ops', 'chief-accountant', 'cfo'],
};

export const tierOf = (amount: number): Tier => (amount <= 500 ? 'T0' : amount <= 10_000 ? 'T1' : 'T2');

export const vendors: Vendor[] = JSON.parse(fs.readFileSync(new URL('vendors.json', DATA), 'utf8'));

let requests: PaymentRequest[] = fs.existsSync(REQUESTS_FILE) ? JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8')) : [];
const save = () => fs.writeFileSync(REQUESTS_FILE, JSON.stringify(requests, null, 2) + '\n');

export function missingRoles(req: PaymentRequest): string[] {
  const signed = new Set(req.approvals.map((a) => a.role));
  return REQUIRED[req.tier].filter((r) => !signed.has(r));
}

export const listRequests = () => requests.map((r) => ({ ...r, missingRoles: missingRoles(r) })).reverse();

function find(id: string): PaymentRequest {
  const req = requests.find((r) => r.id === id);
  if (!req) throw new HttpError(404, 'Không tìm thấy đề nghị chi');
  return req;
}

type NewRequest = { vendorId?: unknown; account?: unknown; amount?: unknown; purpose?: unknown };

export function createRequest(input: NewRequest, requester: string, source: PaymentRequest['source']): PaymentRequest {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Số tiền không hợp lệ');
  const account = String(input.account ?? '').trim();
  const vendor = vendors.find((v) => v.id === input.vendorId);

  const req: PaymentRequest = {
    id: `PR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    vendorId: String(input.vendorId ?? ''),
    vendorName: vendor?.name,
    account,
    amount,
    purpose: String(input.purpose ?? '').slice(0, 200),
    tier: tierOf(amount),
    requester,
    source,
    status: 'pending',
    approvals: [],
    createdAt: new Date().toISOString(),
  };

  // Money only goes to an account already verified in the Vendor Registry.
  const blocked = !vendor
    ? 'Nhà cung cấp chưa có trong danh sách đã xác minh'
    : account !== vendor.account
      ? `Tài khoản ${account} không phải tài khoản đã xác minh của ${vendor.name}`
      : null;
  if (blocked) Object.assign(req, { status: 'rejected', reason: blocked });

  requests.push(req); // blocked attempts are kept so they show up in the list
  save();
  if (blocked) throw new HttpError(422, blocked, req);
  return req;
}

export async function approveRequest(id: string, username: string, roles: string[]): Promise<PaymentRequest> {
  const req = find(id);
  if (req.status !== 'pending') throw new HttpError(409, 'Đề nghị này không còn chờ duyệt');
  if (req.requester === username) throw new HttpError(403, 'Không được duyệt đề nghị của chính mình');
  if (req.approvals.some((a) => a.username === username)) throw new HttpError(403, 'Mỗi người chỉ ký một lần trên một đề nghị');

  const missing = missingRoles(req);
  const role = missing.find((r) => roles.includes(r));
  if (!role) throw new HttpError(403, `Bạn không giữ role còn thiếu cho đề nghị này (cần: ${missing.join(', ')})`);

  req.approvals.push({ username, role, at: new Date().toISOString() });
  if (missingRoles(req).length === 0) req.status = 'approved';
  save();
  if (req.status === 'approved' && !ATTESTATION_REQUIRED) await sendToBank(req);
  return req;
}

// Hướng 2: the chief accountant starts the attestation, other realm admins co-sign in their own
// enclave until the Tide network signs. The backend cannot forge any of this: it stores bytes.
type AttestationStep = { pendingRequest?: unknown; policy?: unknown };

export async function recordAttestation(id: string, username: string, roles: string[], step: AttestationStep): Promise<PaymentRequest> {
  const req = find(id);
  if (req.status !== 'approved') throw new HttpError(409, 'Chỉ ký chứng nhận cho đề nghị đã đủ chữ ký duyệt');
  if (req.attestation?.policy) throw new HttpError(409, 'Đề nghị này đã có chứng nhận');
  const signers = req.attestation?.signers ?? [];
  if (!signers.length && !roles.includes('chief-accountant')) throw new HttpError(403, 'Kế toán trưởng phải ký chứng nhận đầu tiên');
  if (signers.includes(username)) throw new HttpError(403, 'Bạn đã ký chứng nhận này rồi');

  req.attestation = {
    signers: [...signers, username],
    pendingRequest: typeof step.pendingRequest === 'string' ? step.pendingRequest : undefined,
    policy: typeof step.policy === 'string' ? step.policy : undefined,
  };
  save();
  if (req.attestation.policy) await sendToBank(req);
  return req;
}

// DEMO ONLY: "Tuấn" has the server. He reuses a real attestation to send the money elsewhere,
// skipping every rule. With Hướng 1 the bank cannot tell; with Hướng 2 the signature gives him away.
export async function tamper(id: string): Promise<{ accepted?: boolean; reason?: string }> {
  const req = find(id);
  const forged = { orderId: `${req.id}-X`, vendorId: req.vendorId, account: '9999-0000', amount: req.amount, attestation: req.attestation?.policy };
  const res = await fetch(`${MOCKBANK_URL}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(forged) });
  return res.json();
}

export function rejectRequest(id: string, username: string, roles: string[]): PaymentRequest {
  const req = find(id);
  if (req.status !== 'pending') throw new HttpError(409, 'Đề nghị này không còn chờ duyệt');
  if (req.requester === username) throw new HttpError(403, 'Người tạo không tự từ chối được; hãy để người duyệt quyết định');
  if (!REQUIRED[req.tier].some((r) => roles.includes(r))) throw new HttpError(403, 'Bạn không phải người duyệt của đề nghị này');
  Object.assign(req, { status: 'rejected', reason: `Bị ${username} từ chối` });
  save();
  return req;
}

// Hướng 1: the bank trusts this backend. The README states this limit plainly.
export async function sendToBank(req: PaymentRequest): Promise<PaymentRequest> {
  if (req.status !== 'approved' && req.status !== 'sent' && req.status !== 'bank_rejected') {
    throw new HttpError(409, 'Chỉ gửi được đề nghị đã đủ chữ ký');
  }
  try {
    const res = await fetch(`${MOCKBANK_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: req.id, vendorId: req.vendorId, account: req.account, amount: req.amount, attestation: req.attestation?.policy }),
    });
    const body = (await res.json().catch(() => ({}))) as { accepted?: boolean; reason?: string };
    if (body.accepted) Object.assign(req, { status: 'sent', reason: undefined });
    else Object.assign(req, { status: 'bank_rejected', reason: `Ngân hàng từ chối: ${body.reason ?? res.status}` });
  } catch {
    Object.assign(req, { status: 'approved', reason: 'Chưa gửi được tới ngân hàng (MockBank không chạy?)' });
  }
  save();
  return req;
}

export const resend = (id: string) => sendToBank(find(id));
