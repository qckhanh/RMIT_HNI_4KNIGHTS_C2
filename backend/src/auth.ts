// Token verification for API routes, following the Tide pack playbook `verify-jwt-server-side`:
// signature against the adapter's embedded JWKS (never a remote fetch), issuer, azp, time claims,
// then the RFC 9449 DPoP proof (verifyDpop.ts, shipped by the pack).
import fs from 'node:fs';
import { createLocalJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { NextFunction, Request, Response } from 'express';
import { verifyDpop } from './verifyDpop.ts';

// Single source of truth: the adapter exported by infra/bootstrap-realm.mjs.
const ADAPTER_PATH = process.env.TIDECLOAK_ADAPTER ?? new URL('../../frontend/public/tidecloak.json', import.meta.url);
const config = JSON.parse(fs.readFileSync(ADAPTER_PATH, 'utf8'));
if (!config.jwk) throw new Error('Adapter JSON has no jwk: export it with infra/bootstrap-realm.mjs (Tide pack I-04).');

const JWKS = createLocalJWKSet(config.jwk);
const ISSUER = `${config['auth-server-url'].replace(/\/+$/, '')}/realms/${config.realm}`;

export type Claims = JWTPayload & {
  azp?: string;
  preferred_username?: string;
  name?: string;
  realm_access?: { roles?: string[] };
  cnf?: { jkt?: string };
};

declare global {
  namespace Express {
    interface Request { claims?: Claims }
  }
}

async function verifyRequest(req: Request): Promise<Claims> {
  const header = req.get('authorization') ?? '';
  const token = header.replace(/^(Bearer|DPoP) /i, '');
  if (!token || token === header) throw new Error('missing token');

  const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER });
  const claims = payload as Claims;
  if (claims.azp !== config.resource) throw new Error('azp mismatch');
  if (claims.iat && claims.iat > Date.now() / 1000 + 60) throw new Error('iat in the future');

  // Direct localhost, no proxy: do not trust x-forwarded-* when rebuilding the htu.
  await verifyDpop(
    { url: `${req.protocol}://${req.get('host')}${req.originalUrl}`, method: req.method, headers: { get: (n) => req.get(n) ?? null } },
    token,
    claims,
    { trustForwardedHeaders: false },
  );
  return claims;
}

// Roles come only from the verified token, never from the body or query.
export function realmRoles(claims: Claims): string[] {
  return claims.realm_access?.roles ?? [];
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    req.claims = await verifyRequest(req);
    next();
  } catch (e) {
    console.warn(`401 ${req.method} ${req.originalUrl}: ${e instanceof Error ? e.message : e}`);
    res.status(401).json({ error: 'unauthorized' }); // no detail to the caller
  }
}
