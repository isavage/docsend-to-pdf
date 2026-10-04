import { Tier } from './types.js';

export const CONFIG = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  uploadsDir: process.env.UPLOADS_DIR ?? '/app/uploads',
  maxFileSizeBytes: Number(process.env.MAX_FILE_SIZE_BYTES ?? 50 * 1024 * 1024), // 50 MB
  freeTierMaxSlides: Number(process.env.FREE_TIER_MAX_SLIDES ?? 10),
  memberTierMaxSlides: Number(process.env.MEMBER_TIER_MAX_SLIDES ?? 1000),
  outputDir: process.env.OUTPUT_DIR ?? '/app/output',
  browserTimeoutMs: Number(process.env.BROWSER_TIMEOUT_MS ?? 60_000),
  slideWaitMs: Number(process.env.SLIDE_WAIT_MS ?? 2000),
  // EMAIL_ENABLED=true is only honoured when a real SMTP host is set. Without
  // one, nodemailer would dial 127.0.0.1:587 and fail — signups would create
  // stuck-unverified users. Empty host => behave as if email is disabled
  // (auto-verify at signup, log the verification link instead).
  emailEnabled:
    process.env.EMAIL_ENABLED === 'true' &&
    (process.env.SMTP_HOST ?? '').trim() !== '',
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  fromAddress: process.env.FROM_ADDRESS ?? 'noreply@docsend-to-pdf.online',

  // ---- Auth ----
  dbPath: process.env.DB_PATH ?? '/app/data/app.db',
  sessionTtlMs: Number(process.env.SESSION_TTL_MS ?? 30 * 24 * 3600_000), // 30 days
  cookieName: process.env.COOKIE_NAME ?? 'ds_session',
  // Set true when served over HTTPS (behind nginx). Cookie is __Host-secure.
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  // Public origin used to build email verification links, e.g. https://docsend-to-pdf.online
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:4000',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  // Google OAuth redirect must match the value configured in Google Cloud.
  googleRedirectPath: '/api/auth/google/callback',
};

export function getMaxSlidesForTier(tier: Tier): number {
  return tier === 'member' ? CONFIG.memberTierMaxSlides : CONFIG.freeTierMaxSlides;
}

if (process.env.EMAIL_ENABLED === 'true' && (process.env.SMTP_HOST ?? '').trim() === '') {
  console.warn(
    '[config] EMAIL_ENABLED=true but SMTP_HOST is empty — email sending is DISABLED. ' +
      'Signups will be auto-verified (member tier) and verification links logged. ' +
      'Set SMTP_HOST/PORT/USER/PASS to send real emails.',
  );
}
