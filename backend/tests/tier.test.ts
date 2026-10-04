import { describe, it, expect } from 'vitest';
import {
  assertTierAllowsSlides,
  assertFileSizeUnderLimit,
  formatBytes,
  createUpsellMessage,
  TierLimitError,
} from '../src/services/tier.js';
import { ConversionJob } from '../src/types.js';

describe('assertTierAllowsSlides', () => {
  it('allows free tier within 10 slides', () => {
    expect(() => assertTierAllowsSlides('free', 10)).not.toThrow();
  });

  it('rejects free tier above 10 slides', () => {
    expect(() => assertTierAllowsSlides('free', 11)).toThrow(TierLimitError);
  });

  it('allows member tier up to 1000 slides', () => {
    expect(() => assertTierAllowsSlides('member', 1000)).not.toThrow();
  });

  it('rejects member tier above 1000 slides', () => {
    expect(() => assertTierAllowsSlides('member', 1001)).toThrow(TierLimitError);
  });
});

describe('assertFileSizeUnderLimit', () => {
  it('allows size under 50MB', () => {
    expect(() => assertFileSizeUnderLimit(10 * 1024 * 1024)).not.toThrow();
  });

  it('rejects size over 50MB', () => {
    expect(() => assertFileSizeUnderLimit(51 * 1024 * 1024)).toThrow(TierLimitError);
  });
});

describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats KB', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats MB', () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB');
  });
});

describe('createUpsellMessage', () => {
  it('returns upsell for free tier job', () => {
    const job: ConversionJob = {
      id: '1',
      url: 'https://docsend.com/view/abc',
      tier: 'free',
      status: 'completed',
      progress: 100,
      capturedSlides: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const msg = createUpsellMessage(job);
    expect(msg).toContain('Free conversions are capped at 10 slides');
    expect(msg).toContain('Sign in');
  });

  it('returns member note for member tier job', () => {
    const job: ConversionJob = {
      id: '2',
      url: 'https://docsend.com/view/abc',
      tier: 'member',
      status: 'completed',
      progress: 100,
      capturedSlides: 50,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const msg = createUpsellMessage(job);
    expect(msg).toContain('Signed-in members can convert up to 1000 slides');
  });
});
