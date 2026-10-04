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
    if (tier === 'free') {
      throw new TierLimitError(
        `Free conversions are limited to ${max} slides. This document has ${slideCount} slides. Sign in to unlock up to ${CONFIG.memberTierMaxSlides} slides per conversion.`
      );
    }
    throw new TierLimitError(
      `Member conversions are limited to ${max} slides. This document has ${slideCount} slides.`
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
  if (job.tier === 'member') {
    return `Signed-in members can convert up to ${max} slides per document.`;
  }
  return `Free conversions are capped at ${max} slides. Sign in to unlock up to ${CONFIG.memberTierMaxSlides} slides per conversion.`;
}
