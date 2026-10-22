// Self-check for the approval rules (plan B AC-P1…P5, AC-N1/N2). Run: npm run check
// Uses a throwaway requests file and an unreachable bank, so approved requests stay "approved".
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.REQUESTS_FILE = path.join(os.tmpdir(), `countersign-check-${Date.now()}.json`);
process.env.MOCKBANK_URL = 'http://127.0.0.1:9';
const { createRequest, approveRequest, missingRoles, HttpError } = await import('./payments.ts');
const { runPenny } = await import('./penny.ts');

const rejects = async (fn: () => unknown, status: number, text: string) => {
  try { await fn(); } catch (e) {
    assert.ok(e instanceof HttpError, String(e));
    assert.equal(e.status, status);
    assert.match(e.message, new RegExp(text));
    return;
  }
  assert.fail(`expected ${status} ${text}`);
};
const packaging = { vendorId: 'mekong-packaging', account: 'VCB-0071-0042-118' };

// AC-N1 / AC-N2: Penny's clean invoice becomes a T0 request; the injected one is blocked at creation.
const [clean, poisoned] = runPenny();
assert.equal(clean.request.tier, 'T0');
assert.equal(clean.request.amount, 320);
assert.equal(clean.blocked, undefined);
assert.equal(poisoned.request.amount, 48000);
assert.match(poisoned.blocked ?? '', /không phải tài khoản đã xác minh/);

// AC-P1: T0 needs only the chief accountant.
assert.equal((await approveRequest(clean.request.id, 'ha.tran', ['chief-accountant'])).status, 'approved');

// AC-P2: T1, raised by the clerk, approved by the chief accountant.
const t1 = createRequest({ ...packaging, amount: 5000, purpose: 'T1' }, 'admin', 'human');
assert.equal(t1.tier, 'T1');
await rejects(() => approveRequest(t1.id, 'minh.le', ['cfo']), 403, 'role còn thiếu');
assert.equal((await approveRequest(t1.id, 'ha.tran', ['chief-accountant'])).status, 'approved');

// AC-P3: T2 stays pending until all three roles have signed, one signature each.
const t2 = createRequest({ ...packaging, amount: 15000, purpose: 'T2' }, 'admin', 'human');
assert.equal((await approveRequest(t2.id, 'sarah.nguyen', ['dept-head:ops'])).status, 'pending');
assert.equal((await approveRequest(t2.id, 'ha.tran', ['chief-accountant'])).status, 'pending');
await rejects(() => approveRequest(t2.id, 'ha.tran', ['chief-accountant', 'cfo']), 403, 'một lần');
assert.deepEqual(missingRoles(t2), ['cfo']);
assert.equal((await approveRequest(t2.id, 'minh.le', ['cfo'])).status, 'approved');

// AC-P4: nobody approves their own request, even holding the right role.
const own = createRequest({ ...packaging, amount: 15000, purpose: 'own' }, 'sarah.nguyen', 'human');
await rejects(() => approveRequest(own.id, 'sarah.nguyen', ['dept-head:ops']), 403, 'chính mình');

// AC-P5: an account outside the Vendor Registry is blocked when the request is created.
await rejects(() => createRequest({ vendorId: 'mekong-packaging', account: '9999-0000', amount: 100 }, 'admin', 'human'), 422, 'không phải tài khoản đã xác minh');
await rejects(() => createRequest({ vendorId: 'unknown', account: 'x', amount: 100 }, 'admin', 'human'), 422, 'chưa có trong danh sách');

console.log('payments check: OK');
