import { Tier, ConversionJob } from '../types.js';
import { CONFIG, getMaxSlidesForTier } from '../config.js';

export class TierLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TierLimitError';
  }
}

export function assertTierAllowsSlides(tier: Tier, slideCount: number): void {
  const max = getMaxSlidesForTier(tier);
  if (slideCount > max) {
    throw new TierLimitError(
      `${tier} tier is limited to ${max} slides. This document has ${slideCount} slides. Upgrade to paid for unlimited conversions.`
    );
  }
}

export function assertFileSizeUnderLimit(sizeBytes: number): void {
  if (sizeBytes > CONFIG.maxFileSizeBytes) {
    throw new TierLimitError(
      `Output file size ${formatBytes(sizeBytes)} exceeds the ${formatBytes(
        CONFIG.maxFileSizeBytes
      )} limit.`
    );
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

export function createUpsellMessage(job: ConversionJob): string {
  const max = getMaxSlidesForTier(job.tier);
  if (job.tier === 'paid') {
    return 'Thank you for being a paid subscriber. Your conversion includes unlimited slides and batch delivery.';
  }
  return `Free tier conversions are capped at ${max} slides. Upgrade to unlock unlimited slides, batch conversion, and email delivery plus AI pitch-deck analysis.`;
}
