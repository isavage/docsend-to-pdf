import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { Response } from 'express';
import { CONFIG } from '../config.js';
import { getDb, UserRow, toPublicUser, PublicUser } from '../db.js';

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Password hashing — Node's built-in scrypt (no native module needed).
// Stored as: scrypt$<saltHex>$<hashHex>
// ---------------------------------------------------------------------------
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, saltHex, hashHex] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Opaque tokens (sessions + email verification). We only ever store the
// SHA-256 hash of a token, never the token itself.
// ---------------------------------------------------------------------------
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function createSession(userId: string): { token: string; expiresAt: number } {
  const db = getDb();
  const token = newToken();
  const expiresAt = Date.now() + CONFIG.sessionTtlMs;
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).run(hashToken(token), userId, expiresAt, Date.now());
  return { token, expiresAt };
}

export function destroySession(token: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function getSessionUser(token: string): UserRow | null {
  const db = getDb();
  const session = db
    .prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .get(hashToken(token), Date.now()) as { user_id: string } | undefined;
  if (!session) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as UserRow | undefined ?? null;
}

// Periodic cleanup of expired sessions/tokens.
export function purgeExpired(): void {
  const db = getDb();
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM tokens WHERE expires_at <= ?').run(now);
}

// ---------------------------------------------------------------------------
// Cookie helpers — the session token lives in an httpOnly cookie.
// ---------------------------------------------------------------------------
export function setSessionCookie(res: Response, token: string, expiresAt: number): void {
  res.cookie(CONFIG.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: CONFIG.cookieSecure,
    maxAge: expiresAt - Date.now(),
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(CONFIG.cookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: CONFIG.cookieSecure,
    path: '/',
  });
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export function findUserByEmail(email: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as
    | UserRow
    | undefined;
}

export function findUserByGoogleId(googleId: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE google_id = ?').get(googleId) as
    | UserRow
    | undefined;
}

export function getUserById(id: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createUser(opts: {
  email?: string;
  passwordHash?: string;
  googleId?: string;
  name?: string;
  emailVerified?: boolean;
}): UserRow {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, google_id, name, email_verified, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.email ? normalizeEmail(opts.email) : null,
    opts.passwordHash ?? null,
    opts.googleId ?? null,
    opts.name ?? null,
    opts.emailVerified ? 1 : 0,
    Date.now()
  );
  return getUserById(id)!;
}

export function setPassword(userId: string, passwordHash: string): void {
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

export function markEmailVerified(userId: string): void {
  getDb().prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);
}

// ---------------------------------------------------------------------------
// Email verification tokens
// ---------------------------------------------------------------------------
export function createVerifyToken(userId: string): string {
  const db = getDb();
  const token = newToken();
  const id = uuidv4();
  db.prepare(
    'INSERT INTO tokens (id, user_id, kind, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, userId, 'verify', hashToken(token), Date.now() + 24 * 3600_000);
  return token;
}

export function consumeVerifyToken(token: string): UserRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT user_id FROM tokens
       WHERE token_hash = ? AND kind = 'verify' AND used_at IS NULL AND expires_at > ?`
    )
    .get(hashToken(token), Date.now()) as { user_id: string } | undefined;
  if (!row) return null;
  db.prepare('UPDATE tokens SET used_at = ? WHERE token_hash = ?').run(Date.now(), hashToken(token));
  return getUserById(row.user_id) ?? null;
}

export function verificationLink(token: string): string {
  return `${CONFIG.publicUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// Google OAuth — server-side authorization-code flow (no client secret in the
// browser). We exchange the code for an id_token and verify its signature via
// Google's tokeninfo endpoint (simple + avoids JWKS key rotation handling).
// ---------------------------------------------------------------------------
export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CONFIG.googleClientId,
    redirect_uri: `${CONFIG.publicUrl}${CONFIG.googleRedirectPath}`,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GooglePayload {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}

export async function exchangeGoogleCode(code: string): Promise<GooglePayload> {
  const body = new URLSearchParams({
    code,
    client_id: CONFIG.googleClientId,
    client_secret: CONFIG.googleClientSecret,
    redirect_uri: `${CONFIG.publicUrl}${CONFIG.googleRedirectPath}`,
    grant_type: 'authorization_code',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new AuthError('Google code exchange failed', 502);
  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) throw new AuthError('Google returned no id_token', 502);
  return verifyGoogleIdToken(json.id_token);
}

// Decode + verify the JWT signature against Google's public keys.
async function verifyGoogleIdToken(idToken: string): Promise<GooglePayload> {
  const [headerB64, payloadB64, sigB64] = idToken.split('.');
  if (!payloadB64 || !sigB64) throw new AuthError('Malformed id_token', 502);

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as GooglePayload & {
    aud: string;
    iss: string;
    exp: number;
  };

  // Basic claims checks (audience + expiry + issuer).
  if (payload.aud !== CONFIG.googleClientId) throw new AuthError('id_token audience mismatch', 401);
  if (!payload.exp || payload.exp * 1000 < Date.now()) throw new AuthError('id_token expired', 401);
  if (!/^https:\/\/(accounts\.google\.com|oauth2\.googleapis\.com)$/.test(payload.iss)) {
    throw new AuthError('id_token issuer mismatch', 401);
  }

  // Signature verification via Google's tokeninfo endpoint (authoritative).
  const info = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );
  if (!info.ok) throw new AuthError('id_token signature verification failed', 401);

  return {
    sub: payload.sub,
    email: payload.email,
    email_verified: payload.email_verified,
    name: payload.name,
  };
}

export function publicUserFromRow(u: UserRow): PublicUser {
  return toPublicUser(u);
}
