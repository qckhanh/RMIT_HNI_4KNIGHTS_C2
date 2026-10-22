import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { realmRoles, requireAuth } from './auth.ts';
import { approveRequest, ATTESTATION_REQUIRED, createRequest, HttpError, listRequests, recordAttestation, rejectRequest, resend, tamper, vendors } from './payments.ts';
import { runPenny } from './penny.ts';

const PORT = Number(process.env.PORT ?? 4000);
const app = express();

// secureFetch sends `Authorization: DPoP <token>` plus a `DPoP` proof header.
app.use(cors({ origin: 'http://localhost:5173', allowedHeaders: ['Authorization', 'DPoP', 'Content-Type'] }));
app.use(express.json());

const username = (req: Request) => req.claims!.preferred_username!;
const roles = (req: Request) => realmRoles(req.claims!);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/me', requireAuth, (req, res) => {
  const claims = req.claims!;
  res.json({
    username: claims.preferred_username,
    name: claims.name,
    roles: roles(req).filter((r) => !r.startsWith('default-roles') && !r.startsWith('_tide') && r !== 'offline_access' && r !== 'uma_authorization'),
  });
});

app.get('/vendors', requireAuth, (_req, res) => {
  res.json(vendors);
});

app.get('/requests', requireAuth, (_req, res) => {
  res.json(listRequests());
});

app.post('/requests', requireAuth, (req, res) => {
  res.status(201).json(createRequest(req.body ?? {}, username(req), 'human'));
});

app.post('/requests/:id/approve', requireAuth, async (req, res) => {
  res.json(await approveRequest(String(req.params.id), username(req), roles(req)));
});

app.post('/requests/:id/reject', requireAuth, (req, res) => {
  res.json(rejectRequest(String(req.params.id), username(req), roles(req)));
});

app.post('/requests/:id/send', requireAuth, async (req, res) => {
  res.json(await resend(String(req.params.id)));
});

app.get('/config', requireAuth, (_req, res) => {
  res.json({ attestationRequired: ATTESTATION_REQUIRED });
});

app.post('/requests/:id/attestation', requireAuth, async (req, res) => {
  res.json(await recordAttestation(String(req.params.id), username(req), roles(req), req.body ?? {}));
});

// DEMO ONLY: the compromised-server scene. Kept visible on purpose.
app.post('/demo/tamper/:id', requireAuth, async (req, res) => {
  res.json(await tamper(String(req.params.id)));
});

// Penny proposes on behalf of the clerk who runs it.
app.post('/penny/run', requireAuth, (req, res) => {
  if (!roles(req).includes('ap-clerk')) throw new HttpError(403, 'Only the AP clerk can run Penny');
  res.json(runPenny());
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, request: err.request });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => console.log(`countersign backend on http://localhost:${PORT}`));
