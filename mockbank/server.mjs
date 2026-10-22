// MockBank: a stand-in for the company's bank, run as its own process so it is clearly not the app.
// Mode 1 (ATTESTATION_REQUIRED=false, default): it accepts orders from the Countersign backend.
// Mode 2 (ATTESTATION_REQUIRED=true): see verifyAttestation() — it only trusts the Tide network's signature.
// Mode 1 needs nothing but Node; Mode 2 parses Tide policies with @tideorg/js (npm run dev:attest).
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT ?? 4100);
const LEDGER = new URL('./data/ledger.json', import.meta.url);
const ATTESTATION_REQUIRED = process.env.ATTESTATION_REQUIRED === 'true' || process.argv.includes('--attest');

let ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : [];
const save = () => fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');

function decide(order) {
  if (!order.orderId || !order.account || !(Number(order.amount) > 0)) return 'Order is missing details';
  // The Tide signature is the stronger reason, so it is reported first.
  const attestationProblem = ATTESTATION_REQUIRED ? verifyAttestation(order) : null;
  if (attestationProblem) return attestationProblem;
  if (ledger.some((e) => e.orderId === order.orderId && e.accepted)) return 'Duplicate: this order id has already been paid';
  return null;
}

// Mode 2: trust only the Tide network. The attestation is a Tide policy whose `assignmentId` is the
// SHA-256 of the exact order; the realm's public key (VVK, from the adapter JSON) signs its
// `dataToVerify` bytes. Verified against the realm admin policy: that is the scheme the network uses.
const tide = ATTESTATION_REQUIRED ? await import('@tideorg/js') : null; // bundler-style ESM: run under tsx
const realm = JSON.parse(fs.readFileSync(new URL('../frontend/public/tidecloak.json', import.meta.url), 'utf8'));
const vvk = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: realm.jwk.keys.find((k) => k.crv === 'Ed25519').x }, format: 'jwk' });

export const orderDigest = (o) => crypto.createHash('sha256').update(`${o.orderId}|${o.vendorId}|${o.account}|${o.amount}`).digest('hex');

function verifyAttestation(order) {
  if (!order.attestation) return 'No attestation signed by the Tide network';
  let policy;
  try {
    policy = (tide.default ?? tide).Models.Policy.from(new Uint8Array(Buffer.from(order.attestation, 'base64')));
  } catch {
    return "Attestation can't be read";
  }
  if (!policy.signature?.length || !crypto.verify(null, Buffer.from(policy.dataToVerify), vvk, Buffer.from(policy.signature))) {
    return 'Tide network signature is invalid';
  }
  if (policy.params.entries.get('assignmentId') !== orderDigest(order)) {
    return "Attestation doesn't match this order: id, amount or account was changed";
  }
  return null;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function page() {
  const rows = ledger.slice().reverse().map((e) => `
    <tr>
      <td class="muted mono">${esc(new Date(e.at).toLocaleTimeString('en-GB'))}</td><td class="mono">${esc(e.orderId)}</td>
      <td class="num">$${Number(e.amount).toLocaleString('en-US')}</td><td class="mono">${esc(e.account)}</td>
      <td><span class="badge ${e.accepted ? 'ok' : 'no'}">${e.accepted ? 'Accepted' : 'Refused'}</span>${e.reason ? `<div class="muted reason">${esc(e.reason)}</div>` : ''}</td>
    </tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="3"><title>MockBank ledger</title>
<style>
  :root { color-scheme: light dark; --bg: #fff; --fg: #18181b; --muted: #71717a; --line: #e4e4e7; --ok: #15803d; --no: #b91c1c; }
  @media (prefers-color-scheme: dark) { :root { --bg: #09090b; --fg: #fafafa; --muted: #a1a1aa; --line: #27272a; --ok: #4ade80; --no: #f87171; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 'Geist', system-ui, sans-serif; }
  main { max-width: 64rem; margin: 0 auto; padding: 32px 16px; }
  h1 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
  .sub { margin: 4px 0 24px; color: var(--muted); }
  .wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
  th { color: var(--muted); font-weight: 500; font-size: 13px; }
  tr:last-child td { border-bottom: 0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .mono { font-family: ui-monospace, 'Geist Mono', monospace; font-size: 13px; }
  .muted { color: var(--muted); }
  .reason { font-size: 12px; margin-top: 4px; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 500; border: 1px solid currentColor; }
  .badge.ok { color: var(--ok); } .badge.no { color: var(--no); }
</style></head><body><main>
<h1>MockBank ledger</h1>
<p class="sub">Mock bank, running on its own. Mode: ${ATTESTATION_REQUIRED ? 'accepts only payments signed by the Tide network' : 'trusts the company backend'}. Refreshes every 3 seconds.</p>
<div class="wrap"><table><thead><tr><th>Time</th><th>Order</th><th class="num">Amount</th><th>Account</th><th>Result</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5" class="muted">No orders yet.</td></tr>'}</tbody></table></div></main></body></html>`;
}

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page());
    return;
  }
  if (req.method === 'POST' && req.url === '/orders') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let order;
      try { order = JSON.parse(body); } catch { order = {}; }
      const reason = decide(order);
      const entry = { at: new Date().toISOString(), orderId: order.orderId, amount: order.amount, account: order.account, accepted: !reason, reason };
      ledger.push(entry);
      save();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(entry));
    });
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, () => console.log(`MockBank on http://localhost:${PORT} (attestation required: ${ATTESTATION_REQUIRED})`));
