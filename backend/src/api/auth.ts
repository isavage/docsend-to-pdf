import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { CONFIG } from '../config.js';
import { getDb } from '../db.js';
import {
  AuthError,
  createUser,
  consumeVerifyToken,
  createSession,
  createVerifyToken,
  destroySession,
  exchangeGoogleCode,
  findUserByEmail,
  findUserByGoogleId,
  googleAuthUrl,
  hashPassword,
  markEmailVerified,
  publicUserFromRow,
  setSessionCookie,
  clearSessionCookie,
  verificationLink,
  verifyPassword,
} from '../services/auth.js';
import { sendVerificationEmail } from '../services/mailer.js';

const router = Router();

const OAUTH_STATE_COOKIE = 'ds_oauth_state';

const emailSchema = z.string().email().max(254);
const passwordSchema = z.string().min(8, 'Password must be at least 8 characters').max(200);
const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().max(120).optional(),
});
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200) });

function fail(res: Response, err: unknown) {
  if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
  if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0]?.message ?? 'Invalid input' });
  console.error('auth error:', err);
  return res.status(500).json({ error: 'Internal error' });
}

// Whether the server is configured to allow Google sign-in.
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    googleEnabled: !!(CONFIG.googleClientId && CONFIG.googleClientSecret),
    emailVerificationRequired: CONFIG.emailEnabled,
    memberTierMaxSlides: CONFIG.memberTierMaxSlides,
    freeTierMaxSlides: CONFIG.freeTierMaxSlides,
  });
});

router.get('/me', (req: Request, res: Response) => {
  res.json({ user: req.authUser ?? null, tier: req.viewer.tier });
});

router.post('/signup', async (req: Request, res: Response) => {
  try {
    const body = signupSchema.parse(req.body);
    if (findUserByEmail(body.email)) {
      throw new AuthError('An account with this email already exists. Try signing in.', 409);
    }
    // Without SMTP we cannot deliver a verification link, so auto-verify in dev.
    const autoVerify = !CONFIG.emailEnabled;
    const user = createUser({
      email: body.email,
      passwordHash: hashPassword(body.password),
      name: body.name,
      emailVerified: autoVerify,
    });

    let verifyToken = '';
    if (!autoVerify) {
      verifyToken = createVerifyToken(user.id);
      await sendVerificationEmail(user.email!, verificationLink(verifyToken)).catch((e) => {
        console.error('verification email failed:', e);
      });
    }

    const { token, expiresAt } = createSession(user.id);
    setSessionCookie(res, token, expiresAt);
    // req.viewer was resolved before this cookie existed — derive the tier from
    // the user we just authenticated instead.
    const publicUser = publicUserFromRow(user);
    res.json({ user: publicUser, tier: publicUser.emailVerified ? 'member' : 'free' });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = findUserByEmail(body.email);
    // Same generic message whether email or password is wrong (no user enumeration).
    if (!user || !user.password_hash || !verifyPassword(body.password, user.password_hash)) {
      throw new AuthError('Invalid email or password', 401);
    }
    const { token, expiresAt } = createSession(user.id);
    setSessionCookie(res, token, expiresAt);
    const publicUser = publicUserFromRow(user);
    res.json({ user: publicUser, tier: publicUser.emailVerified ? 'member' : 'free' });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/logout', (req: Request, res: Response) => {
  const token = req.cookies?.[CONFIG.cookieName];
  if (token) destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Email verification — linked from the email; returns a tiny HTML page.
router.get('/verify', (req: Request, res: Response) => {
  const token = String(req.query.token ?? '');
  const user = token ? consumeVerifyToken(token) : null;
  // consumeVerifyToken only resolves the token — persist the verification on
  // the user row, otherwise the SPA keeps showing the "verify your email" banner.
  if (user) markEmailVerified(user.id);
  res.status(user ? 200 : 400).type('html').send(`<!doctype html><meta charset="utf-8">
<title>Email verification</title>
<body style="font-family:-apple-system,system-ui,sans-serif;max-width:480px;margin:15vh auto;text-align:center;padding:0 24px">
<h2>${user ? '✅ Email confirmed' : '⚠️ Invalid or expired link'}</h2>
<p>${user
    ? 'Your account is now a member. You can close this tab and go back to the app.'
    : 'This verification link is invalid or has already been used.'}</p>
<p><a href="${CONFIG.publicUrl}" style="color:#635bff">Go to DocSend PDF →</a></p>
</body>`);
});

// Re-send the verification email for the logged-in user.
router.post('/resend-verification', async (req: Request, res: Response) => {
  try {
    if (!req.authUser) throw new AuthError('Not signed in', 401);
    if (req.authUser.emailVerified) return res.json({ ok: true, already: true });
    if (!CONFIG.emailEnabled) throw new AuthError('Email is not configured on this server', 400);
    const token = createVerifyToken(req.authUser.id);
    await sendVerificationEmail(req.authUser.email!, verificationLink(token));
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// ---- Google OAuth (authorization-code flow, server-side) ----
router.get('/google', (_req: Request, res: Response) => {
  if (!CONFIG.googleClientId || !CONFIG.googleClientSecret) {
    return res.status(400).type('html').send('<p>Google sign-in is not configured.</p>');
  }
  const state = crypto.randomBytes(16).toString('hex');
  // Short-lived CSRF state cookie (10 min).
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: CONFIG.cookieSecure,
    maxAge: 10 * 60_000,
    path: CONFIG.googleRedirectPath.substring(0, CONFIG.googleRedirectPath.lastIndexOf('/')),
  });
  res.redirect(googleAuthUrl(state));
});

router.get('/google/callback', async (req: Request, res: Response) => {
  try {
    const code = String(req.query.code ?? '');
    const state = String(req.query.state ?? '');
    const expected = req.cookies?.[OAUTH_STATE_COOKIE];
    res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });
    if (!code) throw new AuthError('Missing authorization code', 400);
    if (!expected || state !== expected) throw new AuthError('OAuth state mismatch', 400);

    const payload = await exchangeGoogleCode(code);
    if (!payload.email_verified) throw new AuthError('Google account email is not verified', 403);

    let user = findUserByGoogleId(payload.sub);
    if (!user) {
      // Link to an existing email account if one exists, else create.
      const byEmail = findUserByEmail(payload.email);
      if (byEmail) {
        getDb()
          .prepare('UPDATE users SET google_id = ?, email_verified = 1 WHERE id = ?')
          .run(payload.sub, byEmail.id);
        user = findUserByEmail(payload.email);
      } else {
        user = createUser({
          email: payload.email,
          googleId: payload.sub,
          name: payload.name,
          emailVerified: true,
        });
      }
    }

    const { token, expiresAt } = createSession(user!.id);
    setSessionCookie(res, token, expiresAt);
    // Redirect back to the SPA; the app reads /me on load.
    res.redirect(`${CONFIG.publicUrl}/?signedin=1`);
  } catch (err) {
    fail(res, err);
  }
});

export default router;
