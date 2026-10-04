import { Tier } from './types.js';

export const CONFIG = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  uploadsDir: process.env.UPLOADS_DIR ?? '/app/uploads',
  maxFileSizeBytes: Number(process.env.MAX_FILE_SIZE_BYTES ?? 50 * 1024 * 1024), // 50 MB
  freeTierMaxSlides: Number(process.env.FREE_TIER_MAX_SLIDES ?? 10),
  paidTierMaxSlides: Number(process.env.PAID_TIER_MAX_SLIDES ?? 1000),
  outputDir: process.env.OUTPUT_DIR ?? '/app/output',
  browserTimeoutMs: Number(process.env.BROWSER_TIMEOUT_MS ?? 60_000),
  slideWaitMs: Number(process.env.SLIDE_WAIT_MS ?? 2000),
  emailEnabled: process.env.EMAIL_ENABLED === 'true',
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  fromAddress: process.env.FROM_ADDRESS ?? 'noreply@docsendpdf.dev',
};

export function getMaxSlidesForTier(tier: Tier): number {
  return tier === 'paid' ? CONFIG.paidTierMaxSlides : CONFIG.freeTierMaxSlides;
}
