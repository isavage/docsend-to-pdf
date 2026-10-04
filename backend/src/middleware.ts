import type { Request, Response, NextFunction } from 'express';
import { CONFIG } from './config.js';
import { getSessionUser } from './services/auth.js';
import type { Tier, Viewer } from './types.js';
import type { PublicUser } from './db.js';

// Attach a Viewer to every request. Anonymous -> free tier.
// Signed-in AND email-verified -> member tier.
// Signed-in but not verified -> free tier, but `user` is present so the UI can prompt verification.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      viewer: Viewer;
      authUser?: PublicUser;
    }
  }
}

export function attachViewer(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[CONFIG.cookieName];
  if (token) {
    const user = getSessionUser(token);
    if (user) {
      const tier: Tier = user.email_verified === 1 ? 'member' : 'free';
      req.viewer = { tier, userId: user.id, email: user.email ?? undefined };
      req.authUser = {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.email_verified === 1,
        hasPassword: !!user.password_hash,
        hasGoogle: !!user.google_id,
      };
      return next();
    }
  }
  req.viewer = { tier: 'free' };
  next();
}
