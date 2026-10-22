// MockBank: a stand-in for the company's bank, run as its own process so it is clearly not the app.
// Hướng 1 (ATTESTATION_REQUIRED=false, default): it accepts orders from the Countersign backend.
// Hướng 2 (ATTESTATION_REQUIRED=true): see verifyAttestation() — it only trusts the Tide network's signature.
// Hướng 1 needs nothing but Node; Hướng 2 parses Tide policies with @tideorg/js (npm run dev:attest).
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT ?? 4100);
const LEDGER = new URL('./data/ledger.json', import.meta.url);
const ATTESTATION_REQUIRED = process.env.ATTESTATION_REQUIRED === 'true' || process.argv.includes('--attest');

let ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : [];
const save = () => fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');

function decide(order) {
  if (!order.orderId || !order.account || !(Number(order.amount) > 0)) return 'Lệnh thiếu thông tin';
  if (ledger.some((e) => e.orderId === order.orderId && e.accepted)) return 'Lệnh trùng: mã lệnh này đã được thanh toán';
  if (ATTESTATION_REQUIRED) return verifyAttestation(order);
  return null;
}

// Hướng 2: trust only the Tide network. The attestation is a Tide policy whose `assignmentId` is the
// SHA-256 of the exact order; the realm's public key (VVK, from the adapter JSON) signs its
// `dataToVerify` bytes. Verified against the realm admin policy: that is the scheme the network uses.
const tide = ATTESTATION_REQUIRED ? await import('@tideorg/js') : null; // bundler-style ESM: run under tsx
const realm = JSON.parse(fs.readFileSync(new URL('../frontend/public/tidecloak.json', import.meta.url), 'utf8'));
const vvk = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: realm.jwk.keys.find((k) => k.crv === 'Ed25519').x }, format: 'jwk' });

export const orderDigest = (o) => crypto.createHash('sha256').update(`${o.orderId}|${o.vendorId}|${o.account}|${o.amount}`).digest('hex');

function verifyAttestation(order) {
  if (!order.attestation) return 'Không có chứng nhận do mạng Tide ký';
  let policy;
  try {
    policy = (tide.default ?? tide).Models.Policy.from(new Uint8Array(Buffer.from(order.attestation, 'base64')));
  } catch {
    return 'Chứng nhận không đọc được';
  }
  if (!policy.signature?.length || !crypto.verify(null, Buffer.from(policy.dataToVerify), vvk, Buffer.from(policy.signature))) {
    return 'Chữ ký của mạng Tide không hợp lệ';
  }
  if (policy.params.entries.get('assignmentId') !== orderDigest(order)) {
    return 'Chứng nhận không khớp lệnh: mã lệnh, số tiền hoặc tài khoản đã bị đổi';
  }
  return null;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function page() {
  const rows = ledger.slice().reverse().map((e) => `
    <tr class="${e.accepted ? 'ok' : 'no'}">
      <td>${esc(new Date(e.at).toLocaleTimeString('vi-VN'))}</td><td>${esc(e.orderId)}</td>
      <td class="num">$${Number(e.amount).toLocaleString('en-US')}</td><td>${esc(e.account)}</td>
      <td><strong>${e.accepted ? 'Chấp nhận' : 'Từ chối'}</strong>${e.reason ? ` — ${esc(e.reason)}` : ''}</td>
    </tr>`).join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="3"><title>MockBank</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px 16px; background: #f4f6f8; color: #1c2430; }
  h1 { margin: 0 0 4px; } p { margin: 0 0 16px; color: #5a6675; }
  table { border-collapse: collapse; width: 100%; background: #fff; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #e3e7ec; text-align: left; font-size: 14px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.ok td:last-child { color: #11703b; } tr.no td:last-child { color: #b3261e; }
</style></head><body>
<h1>MockBank</h1>
<p>Ngân hàng giả lập · chế độ: ${ATTESTATION_REQUIRED ? 'chỉ tin chứng nhận do mạng Tide ký' : 'tin backend của công ty (Hướng 1)'} · tự làm mới 3 giây</p>
<table><thead><tr><th>Giờ</th><th>Mã lệnh</th><th class="num">Số tiền</th><th>Tài khoản</th><th>Kết quả</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5">Chưa có lệnh nào.</td></tr>'}</tbody></table></body></html>`;
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
