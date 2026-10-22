# Countersign

## Project overview

**Countersign is a dual-control expense desk where no admin, server or AI can move company money alone: approvals are tied to real Tide identities, approver roles are governed by a Tide quorum, and the bank can verify each payment itself.**

**Vision & originality.** In most finance tools, "approved" is a database flag an IT admin can flip. Countersign builds internal controls the company itself cannot quietly break, and that outsiders can verify.

**Trust constraint insight.** Dual control fails in practice: directors hand banking tokens to accountants "to save time", deepfaked executives (Arup, 2024, ~US$25M) and fake "new bank account" emails fool one person at a time, and admins can grant themselves roles. The only safeguard is trusting whoever runs the server, so nobody lets an AI agent near payments.

**Value & impact.** Approving takes one tap with your own Tide identity, so there is no token to hand over. The chief accountant signs every payment, as Vietnamese accounting practice expects. A prompt-injected AI invoice clerk does no harm. Banks and auditors check proofs, not logs.

**Why TideCloak matters.** Tide login with DPoP binds every approval to a person. Granting the CFO role is an IGA change request that needs 2 of 4 admins: one insider cannot promote herself. In mode 2, each payment carries a policy signed by the Tide network under the realm admin policy (threshold = that quorum); MockBank verifies it with the realm key, so a compromised server cannot redirect money.

**Prototype & storytelling.** Watch: Penny (a simulated AI) reads a poisoned invoice and is blocked; a $15,000 payment waits for the Ops head, chief accountant and CFO; Sarah tries to make herself CFO and is denied; "Tuấn", who owns the server, redirects a paid order: accepted in mode 1, rejected in mode 2.

---

## What is real, what is simulated

| Part | Status |
|---|---|
| Login, DPoP-bound tokens, server-side JWT + DPoP verification | Real (TideCloak + Tide network) |
| Approver-role governance (2 of 4 admins) | Real (TideCloak IGA). Verified: Sarah's self-granted `cfo` stayed at 1/2 and was denied by the CFO |
| Approval rules T0–T2, one signature per role, no self-approval, vendor registry | Enforced by the Countersign backend (mode 1). `npm run check` covers them |
| Bank verification of Tide signatures | Real crypto: MockBank verifies Ed25519 signatures with the realm key. Checked against the realm's own signed admin policy: missing, malformed, mismatched and tampered attestations are all refused |
| Network-signed payment attestation (mode 2) | Implemented (Hà starts, another admin co-signs in their enclave). **Not yet run end-to-end on the Tide network** |
| Penny, the AI accounts-payable agent | **Simulated**: fixed parsing rules, deliberately gullible |
| MockBank | A stand-in bank running as its own process |
| Data | Synthetic companies, people, vendors and invoices |

**Known limits.** In mode 1 the bank trusts the backend (the "Tuấn" scene shows exactly that). Collusion between enough approvers, and forged paperwork good enough to fool them, are out of scope. Real banks do not verify Tide signatures today; the adoption path is to register the realm public key with the bank the way companies already register signing certificates.

## Approval rules

| Tier | Amount | Must be signed by |
|---|---|---|
| T0 | ≤ $500 | Chief accountant |
| T1 | $500 – $10,000 | Chief accountant |
| T2 | > $10,000 | Ops department head + chief accountant + CFO |

Anyone may raise a request; nobody approves their own; each person signs once; money only goes to the verified account in `backend/data/vendors.json`. Roles come only from the verified token.

## Run it

Requirements: Docker, Node.js 20+.

```bash
npm run setup                     # install backend, mockbank, frontend
bash infra/start-tidecloak.sh     # TideCloak on :8080 (tideorg/tidecloak-dev)
cp infra/.env.example infra/.env  # fill in admin password, licence email, TIDE_TERMS_ACCEPTED=yes
node infra/bootstrap-realm.mjs    # realm, roles, users; prints Tide enrolment links
npm run dev                       # mode 1: app :5173, backend :4000, MockBank :4100
npm run dev:attest                # mode 2: bank accepts only network-signed attestations
npm run check                     # approval-rule self-check
```

Each enrolment link is opened once, in its own browser profile, to link a Tide account. The free licence allows 5 Tide accounts and counts failed attempts, so this realm uses 4:

| User | Role |
|---|---|
| `admin` | clerk who raises requests (`ap-clerk`) + realm admin |
| `ha.tran` | chief accountant |
| `minh.le` | CFO |
| `sarah.nguyen` | Ops department head |

After adding realm admins, `node infra/bootstrap-realm.mjs --export-only` re-exports the adapter and the admin policy.

## Demo walkthrough

1. `admin`: **Tạo sẵn các ca demo**. Penny's $320 invoice becomes a T0 request; the poisoned invoice ("pay $48,000 to 9999-0000") is blocked at creation.
2. `ha.tran` approves T0 and T1; `sarah.nguyen`, `ha.tran` and `minh.le` approve the $15,000 T2. MockBank (:4100) shows each order accepted.
3. `sarah.nguyen` raises her own request: the app will not let her approve it.
4. In the TideCloak console, Sarah assigns herself `cfo`: the change request stays at 1/2. Minh denies it.
5. **🕵 Tuấn đổi tài khoản** on a paid order: mode 1 bank accepts the forged order; mode 2 bank refuses it.
6. Mode 2: once approved, Hà clicks **Ký chứng nhận (Tide)** and a second admin **Đồng ký**; the order reaches the bank with the network's signature.

## Layout

```
frontend/   React + Vite, @tidecloak/react (DPoP), attestation signing (src/attestation.ts)
backend/    Express: JWT + DPoP verification, approval rules, Penny
mockbank/   independent bank: ledger page, duplicate check, Tide signature verification
infra/      TideCloak container and realm bootstrap
```

## Credits

Built with the Tide MCP pack (Raziel): the React + Vite template, `verifyDpop.ts`, the realm template and the relationship-attestation helper are adapted from it under the Tide Community Open Code License. Ratidefy (tide-foundation) was the reference for policy-governed signing.
