// Bootstrap the `countersign` realm on an already-running local TideCloak (infra/start-tidecloak.sh).
//
// Port of the Tide MCP pack's templates/shared/bootstrap-tidecloak.sh to Node, because that script
// needs sudo and jq (not available on Windows) and manages its own container. Same order of steps,
// plus: Countersign's roles and persona users are created and enrolled BEFORE the admin is granted
// tide-realm-admin, since that grant flips the realm to multiAdmin and blocks server-side writes.
//
// Usage:  node infra/bootstrap-realm.mjs            fresh realm
//         node infra/bootstrap-realm.mjs --resume   realm exists: re-print invite links and continue
//                                                   from "wait for enrolment"
//         node infra/bootstrap-realm.mjs --export-only   sign IdP settings + export adapter, nothing else

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

for (const line of fs.existsSync(path.join(here, '.env')) ? fs.readFileSync(path.join(here, '.env'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const BASE = process.env.TIDECLOAK_URL ?? 'http://localhost:8080';
const REALM = 'countersign';
const CLIENT = 'countersign-frontend';
const APP_URL = 'http://localhost:5173';
const ADAPTER_OUTPUT = path.join(root, 'frontend', 'public', 'tidecloak.json');
const INVITES_OUTPUT = path.join(here, 'data', 'invite-links.txt'); // gitignored: links are credentials
const ADMIN_USER = process.env.KC_BOOTSTRAP_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASS = process.env.KC_BOOTSTRAP_ADMIN_PASSWORD;
const EMAIL = process.env.TIDE_LICENSE_EMAIL ?? '';
const RESUME = process.argv.includes('--resume');

const ROLES = [
  'chief-accountant', 'deputy-chief-accountant', 'cfo', 'ceo', 'controller', 'cto',
  'dept-head:ops', 'dept-head:sales', 'ap-clerk', 'ap-agent',
];
// Synthetic personas from the Countersign plan. The free-tier licence has 5 account seats and one was
// lost to a failed enrolment on Tide's side, so `admin` also plays Linh (the clerk who raises requests).
const USERS = [
  { username: 'admin', firstName: 'Admin', lastName: 'User', email: EMAIL, roles: ['ap-clerk'] },
  { username: 'ha.tran', firstName: 'Hà', lastName: 'Trần', roles: ['chief-accountant'] },
  { username: 'minh.le', firstName: 'Minh', lastName: 'Lê', roles: ['cfo'] },
  { username: 'sarah.nguyen', firstName: 'Sarah', lastName: 'Nguyen', roles: ['dept-head:ops'] },
];
const DROPPED = ['linh.pham']; // created by earlier runs; removed so nobody waits on its enrolment
const ENROLLED = USERS.map((u) => u.username);
const NEVER_AUTO_APPROVE = new Set(['DISABLE_IGA', 'DELETE_REALM', 'OFFBOARD_REALM']);

const die = (msg, code = 1) => { console.error(`ERROR: ${msg}`); process.exit(code); };
const step = (msg) => console.log(`==> ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Licence email + Terms: answered by the owner, never defaulted (Tide pack AP-90) ---
const validEmail = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(EMAIL)
  && !/@(example\.(com|org|net)|test\.com|domain\.com|company\.com)$/i.test(EMAIL);
if (!validEmail || process.env.TIDE_TERMS_ACCEPTED !== 'yes') {
  die('TIDE_LICENSE_EMAIL and TIDE_TERMS_ACCEPTED=yes must be set in infra/.env by the owner (https://tide.org/legal).', 2);
}
if (!ADMIN_PASS) die('KC_BOOTSTRAP_ADMIN_PASSWORD is not set in infra/.env.');

async function token() {
  const res = await fetch(`${BASE}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: 'admin-cli', grant_type: 'password', username: ADMIN_USER, password: ADMIN_PASS }),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.access_token) die(`master admin login failed (HTTP ${res.status})`);
  return body.access_token;
}

// Admin REST call under /admin/realms. A fresh token per call: they live 60s and steps can be slow.
async function api(method, p, { json, form } = {}) {
  const headers = { Authorization: `Bearer ${await token()}` };
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form !== undefined) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form); }
  const res = await fetch(`${BASE}/admin/realms${p}`, { method, headers, body, redirect: 'manual' });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, text, json: parsed };
}

// Authorize then commit every pending change request (FirstAdmin mode signs server-side).
async function drain() {
  await sleep(2000);
  const pending = async () => {
    const { json } = await api('GET', `/${REALM}/iga/change-requests?status=PENDING`);
    return Array.isArray(json) ? json.filter((cr) => !NEVER_AUTO_APPROVE.has(cr.actionType)) : [];
  };
  for (const cr of await pending()) await api('POST', `/${REALM}/iga/change-requests/${cr.id}/authorize`, { json: {} });
  for (let pass = 0; pass < 5; pass++) {
    const ready = (await pending()).filter((cr) => cr.readyToCommit === true);
    if (!ready.length) break;
    for (const cr of ready) await api('POST', `/${REALM}/iga/change-requests/${cr.id}/commit`);
  }
}

async function findUser(username) {
  const { json } = await api('GET', `/${REALM}/users?username=${encodeURIComponent(username)}&exact=true`);
  return Array.isArray(json) ? json[0] : undefined;
}

async function createRealm() {
  step(`Creating realm '${REALM}' from the Tide template...`);
  const template = fs.readFileSync(path.join(here, 'realm.json.template'), 'utf8')
    .replaceAll('REALM_NAME', REALM).replaceAll('CLIENT_NAME', CLIENT).replaceAll('CLIENT_APP_URL', APP_URL);
  const created = await api('POST', '', { json: JSON.parse(template) });
  if (created.status !== 201) die(`realm import failed (HTTP ${created.status}): ${created.text.slice(0, 300)}`);

  // Before IGA: stop Keycloak's "Update Account Information" page (Tide asserts no name/email).
  step('Disabling the first-broker-login profile page...');
  const flow = `/${REALM}/authentication/flows/first%20broker%20login/executions`;
  const review = (await api('GET', flow)).json?.find((e) => e.providerId === 'idp-review-profile');
  const cfg = { alias: 'review profile config', config: { 'update.profile.on.first.login': 'off' } };
  if (review?.authenticationConfig) await api('PUT', `/${REALM}/authentication/config/${review.authenticationConfig}`, { json: cfg });
  else if (review?.id) await api('POST', `/${REALM}/authentication/executions/${review.id}/config`, { json: cfg });
  const now = (await api('GET', flow)).json?.find((e) => e.providerId === 'idp-review-profile')?.authenticationConfig;
  const value = now && (await api('GET', `/${REALM}/authentication/config/${now}`)).json?.config?.['update.profile.on.first.login'];
  if (value !== 'off') die(`could not disable the first-broker-login profile page (read back '${value}')`);

  step('Initializing Tide realm (licence + vendor key)...');
  const setup = await api('POST', `/${REALM}/vendorResources/setUpTideRealm`, { form: { email: EMAIL, isRagnarokEnabled: 'true' } });
  if (setup.status === 303) die('setUpTideRealm answered 303 (paid checkout): no free-tier licence issued');
  if (setup.status < 200 || setup.status > 299) die(`setUpTideRealm failed (HTTP ${setup.status}): ${setup.text.slice(0, 300)} — see 'docker logs countersign-tidecloak' ([Midgard])`);
  if (setup.text.includes('NEED_PAYMENT')) die('setUpTideRealm answered NEED_PAYMENT: realm is NOT licensed');

  step('Stamping iga.attestor=tide and enabling IGA...');
  const rep = (await api('GET', `/${REALM}`)).json;
  rep.attributes = { ...(rep.attributes ?? {}), 'iga.attestor': 'tide' };
  await api('PUT', `/${REALM}`, { json: rep });
  // toggle-iga is a flip: call it at most once, only when IGA is off.
  const igaOn = String((await api('GET', `/${REALM}`)).json?.attributes?.isIGAEnabled ?? 'false').toLowerCase() === 'true';
  if (!igaOn) {
    const iga = await api('POST', `/${REALM}/tide-admin/toggle-iga`, { form: { isIGAEnabled: 'true' } });
    if (!iga.text.includes('"enabled":true')) die(`toggle-iga did not report enabled=true: ${iga.text.slice(0, 300)}`);
    if (/warnings|commitFailures/.test(iga.text)) console.warn(`WARNING: toggle-iga reported: ${iga.text.slice(0, 300)}`);
  }
  await drain();
}

// Idempotent: safe to re-run with --resume after a partial bootstrap.
async function ensurePeople() {
  // Personas are synthetic and Tide needs no email, so make email optional instead of inventing one (Tide pack AP-85).
  step('Making email optional in the user profile...');
  const profile = (await api('GET', `/${REALM}/users/profile`)).json;
  const email = profile?.attributes?.find((a) => a.name === 'email');
  if (email?.required) {
    delete email.required;
    await api('PUT', `/${REALM}/users/profile`, { json: profile });
    await drain();
    if ((await api('GET', `/${REALM}/users/profile`)).json?.attributes?.find((a) => a.name === 'email')?.required) {
      die('email is still required in the user profile');
    }
  }

  step(`Creating ${ROLES.length} realm roles...`);
  for (const name of ROLES) await api('POST', `/${REALM}/roles`, { json: { name } }); // 409 if it exists
  await drain();

  for (const username of DROPPED) {
    const user = await findUser(username);
    if (user) { step(`Removing dropped user ${username}...`); await api('DELETE', `/${REALM}/users/${user.id}`); }
  }
  await drain();

  step(`Creating users: ${ENROLLED.join(', ')}...`);
  for (const u of USERS) {
    if (await findUser(u.username)) continue;
    const res = await api('POST', `/${REALM}/users`, {
      json: {
        username: u.username, firstName: u.firstName, lastName: u.lastName, ...(u.email ? { email: u.email } : {}),
        enabled: true, emailVerified: false, attributes: { tideInvitable: ['true'] },
      },
    });
    if (res.status !== 201 && res.status !== 202) die(`creating user '${u.username}' failed (HTTP ${res.status}): ${res.text.slice(0, 300)}`);
  }
  await drain();

  step('Assigning persona roles...');
  for (const p of USERS) {
    const user = await findUser(p.username);
    if (!user) die(`user '${p.username}' not found after creation (change request not committed?)`);
    const reps = [];
    for (const r of p.roles) reps.push((await api('GET', `/${REALM}/roles/${encodeURIComponent(r)}`)).json);
    await api('POST', `/${REALM}/users/${user.id}/role-mappings/realm`, { json: reps });
  }
  await drain();
}

async function inviteLinks() {
  const lines = [];
  for (const username of ENROLLED) {
    const user = await findUser(username);
    if (!user) die(`user '${username}' not found`);
    if (user.attributes?.tideUserKey?.[0]) { lines.push(`${username}: already linked`); continue; }
    const res = await api('POST', `/${REALM}/tideAdminResources/get-required-action-link?userId=${user.id}&lifespan=43200`, { json: ['link-tide-account-action'] });
    if (res.status !== 200) die(`invite link for '${username}' failed (HTTP ${res.status}): ${res.text.slice(0, 200)}`);
    lines.push(`${username}: ${res.text.trim()}`);
  }
  fs.mkdirSync(path.dirname(INVITES_OUTPUT), { recursive: true });
  fs.writeFileSync(INVITES_OUTPUT, lines.join('\n') + '\n');
  console.log(`\nInvite links (also in ${path.relative(root, INVITES_OUTPUT)}). Open each in its own Chrome profile:\n${lines.join('\n')}\n`);
}

async function waitForEnrolment() {
  step('Waiting for every account to link its Tide identity (polling every 5s)...');
  const linked = new Set();
  while (linked.size < ENROLLED.length) {
    for (const username of ENROLLED) {
      if (linked.has(username)) continue;
      if ((await findUser(username))?.attributes?.tideUserKey?.[0]) {
        linked.add(username);
        console.log(`    linked: ${username} (${linked.size}/${ENROLLED.length})`);
      }
    }
    if (linked.size < ENROLLED.length) await sleep(5000);
  }
  await drain();
}

async function signIdpAndExport() {
  step('Pointing the tide IdP at this realm console and signing IdP settings...');
  const inst = (await api('GET', `/${REALM}/identity-provider/instances/tide`)).json;
  if (!inst) die('tide identity provider not found on the realm');
  inst.config = { ...inst.config, CustomAdminUIDomain: `${BASE}/realms/${REALM}/tide-console/` };
  await api('PUT', `/${REALM}/identity-provider/instances/tide`, { json: inst });
  const signed = await api('POST', `/${REALM}/vendorResources/sign-idp-settings`);
  if (signed.status < 200 || signed.status > 299) die(`sign-idp-settings failed (HTTP ${signed.status}): ${signed.text.slice(0, 200)}`);
  await exportAdapter();
}

async function exportAdapter() {
  step('Exporting adapter config...');
  const client = (await api('GET', `/${REALM}/clients?clientId=${CLIENT}`)).json?.[0];
  const adapter = await api('GET', `/${REALM}/vendorResources/get-installations-provider?clientId=${client.id}&providerId=keycloak-oidc-keycloak-json`);
  if (!adapter.json?.jwk) die(`adapter export has no jwk: ${adapter.text.slice(0, 200)}`);
  fs.writeFileSync(ADAPTER_OUTPUT, JSON.stringify(adapter.json, null, 2) + '\n');
  console.log(`    wrote ${path.relative(root, ADAPTER_OUTPUT)}`);
}

async function finish() {
  await signIdpAndExport();

  // LAST server-side write: committing this grant flips the realm firstAdmin -> multiAdmin.
  step('Granting tide-realm-admin to admin (flips realm to multiAdmin)...');
  const rm = (await api('GET', `/${REALM}/clients?clientId=realm-management`)).json?.[0];
  const role = (await api('GET', `/${REALM}/clients/${rm.id}/roles/tide-realm-admin`)).json;
  if (!role?.id) die('tide-realm-admin role not found');
  const admin = await findUser('admin');
  await api('POST', `/${REALM}/users/${admin.id}/role-mappings/clients/${rm.id}`, { json: [role] });
  await drain();
  await exportAdapter();
  console.log(`\nBootstrap complete. Realm: ${REALM}  Client: ${CLIENT}  Adapter: ${path.relative(root, ADAPTER_OUTPUT)}`);
}

// --export-only: sign IdP settings and export the adapter without waiting for enrolment or flipping
// the realm, so the app can be developed against the accounts linked so far.
if (process.argv.includes('--export-only')) {
  await signIdpAndExport();
  process.exit(0);
}

const exists = (await api('GET', `/${REALM}`)).status === 200;
if (exists && !RESUME) die(`realm '${REALM}' already exists. Use --resume to continue an interrupted bootstrap.`);
if (!exists && RESUME) die(`realm '${REALM}' does not exist; run without --resume.`);
if (!exists) await createRealm();
await ensurePeople();
await inviteLinks();
await waitForEnrolment();
await finish();
