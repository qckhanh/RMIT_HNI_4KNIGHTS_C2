import express from 'express';
import cors from 'cors';
import { realmRoles, requireAuth } from './auth.ts';

const PORT = Number(process.env.PORT ?? 4000);
const app = express();

// secureFetch sends `Authorization: DPoP <token>` plus a `DPoP` proof header.
app.use(cors({ origin: 'http://localhost:5173', allowedHeaders: ['Authorization', 'DPoP', 'Content-Type'] }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/me', requireAuth, (req, res) => {
  const claims = req.claims!;
  res.json({
    username: claims.preferred_username,
    name: claims.name,
    roles: realmRoles(claims).filter((r) => !r.startsWith('default-roles') && !r.startsWith('_tide') && r !== 'offline_access' && r !== 'uma_authorization'),
  });
});

app.listen(PORT, () => console.log(`countersign backend on http://localhost:${PORT}`));
