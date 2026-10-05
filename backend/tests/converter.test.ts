import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateDocSendUrl,
  DocSendConverter,
  ExpiredLinkError,
  PasswordRequiredError,
  ViewOnlyModeError,
} from '../src/services/converter.js';
import { ConversionRequest } from '../src/types.js';
import fs from 'fs/promises';
import * as pdfLib from 'pdf-lib';

// Mock entire pdf-lib to avoid needing real image data
vi.mock('pdf-lib', () => {
  const mockImage = { scaleToFit: vi.fn().mockReturnValue({ width: 400, height: 300 }) } as never;
  class MockPDFDocument {
    static create = vi.fn().mockResolvedValue(new this());
    embedPng = vi.fn().mockResolvedValue(mockImage);
    addPage = vi.fn().mockReturnValue({
      getSize: () => ({ width: 595.28, height: 841.89 }), // A4 in points
      drawImage: vi.fn().mockResolvedValue(undefined),
    });
    save = vi.fn().mockResolvedValue(Buffer.from('fake-pdf-bytes'));
  }
  return { PDFDocument: MockPDFDocument, PageSizes: { A4: {} } };
});
const mockSlideImage = Buffer.from([0]); // dummy

// Helper to check whether a locator should be considered "visible" based on context
type LocatorBuilder = () => ReturnType<typeof createLocator>;

function createLocator(overrides: Record<string, unknown> = {}) {
  const locator = {
    isVisible: vi.fn().mockResolvedValue(false),
    count: vi.fn().mockResolvedValue(0),
    fill: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(mockSlideImage),
    first: vi.fn().mockReturnThis(),
    ...overrides,
  };
  return locator;
}

function createMockPage(overrides: Record<string, unknown> = {}) {
  const defaultLocator = createLocator();
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue(defaultLocator),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    evaluate: vi.fn().mockResolvedValue(0),
    url: vi.fn().mockReturnValue('https://docsend.com/view/abc'),
    setViewportSize: vi.fn().mockResolvedValue(undefined),
    // captureSlides screenshots the whole viewport (not a slide element).
    screenshot: vi.fn().mockResolvedValue(mockSlideImage),
    ...overrides,
  };
}

function createMockBrowser(page: ReturnType<typeof createMockPage>) {
  return {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('validateDocSendUrl', () => {
  it('accepts valid docsend view URLs', () => {
    expect(validateDocSendUrl('https://docsend.com/view/abc123')).toBe(true);
    expect(validateDocSendUrl('https://www.docsend.com/view/abc123')).toBe(true);
  });

  it('rejects non-docsend URLs', () => {
    expect(validateDocSendUrl('https://example.com/view/abc123')).toBe(false);
    expect(validateDocSendUrl('not-a-url')).toBe(false);
  });

  it('rejects docsend URLs without view path', () => {
    expect(validateDocSendUrl('https://docsend.com/')).toBe(false);
  });
});

describe('DocSendConverter', () => {
  let converter: DocSendConverter;

  beforeEach(() => {
    converter = new DocSendConverter({ outputDir: '/tmp/out' });
  });

  it('throws on invalid URL', async () => {
    const req: ConversionRequest = {
      url: 'https://example.com/view/abc',
      tier: 'free',
    };
    await expect(converter.convert(req)).rejects.toThrow('Invalid DocSend URL');
  });

  it('detects expired links', async () => {
    const locator = createLocator({ isVisible: vi.fn().mockResolvedValue(true) });
    const page = createMockPage({
      locator: vi.fn().mockReturnValue(locator),
    });
    const browser = createMockBrowser(page);
    const req: ConversionRequest = {
      url: 'https://docsend.com/view/expired',
      tier: 'free',
    };
    await expect(
      converter.convert(req, { launchBrowser: async () => browser as never })
    ).rejects.toThrow(ExpiredLinkError);
  });

  it('detects password gate when no password provided', async () => {
    // The converter calls locator() in order: expired, view-only, cookie
    // banner, email gate input, cookie banner (again), then password input.
    const invisible = () => createLocator({ isVisible: vi.fn().mockResolvedValue(false) });
    const pwdLocator = createLocator({ isVisible: vi.fn().mockResolvedValue(true) });
    let callCount = 0;
    const page = createMockPage({
      locator: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount <= 5 ? invisible() : pwdLocator;
      }),
    });
    const browser = createMockBrowser(page);
    const req: ConversionRequest = {
      url: 'https://docsend.com/view/protected',
      tier: 'free',
    };
    await expect(
      converter.convert(req, { launchBrowser: async () => browser as never })
    ).rejects.toThrow(PasswordRequiredError);
  });

  it('enters password when provided', async () => {
    const fill = vi.fn().mockResolvedValue(undefined);
    const submitClick = vi.fn().mockResolvedValue(undefined);
    const pwdLocator = createLocator({ isVisible: vi.fn().mockResolvedValue(true), fill });
    const screenshot = vi.fn().mockResolvedValue(mockSlideImage);
    const slideLocator = createLocator({ count: vi.fn().mockResolvedValue(1), screenshot, click: submitClick });
    // Flow: expired(1) → view-only(2) → cookie(3) → email gate(4) → cookie(5)
    //       → password(6) → submit(7+)
    let callCount = 0;
    const page = createMockPage({
      locator: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 5) return createLocator({ isVisible: vi.fn().mockResolvedValue(false) });
        if (callCount === 6) return pwdLocator; // password input
        return slideLocator; // submit button + slide
      }),
      evaluate: vi.fn().mockResolvedValue(1),
    });
    const browser = createMockBrowser(page);
    const req: ConversionRequest = {
      url: 'https://docsend.com/view/protected',
      tier: 'free',
      password: 'secret',
    };
    await converter.convert(req, { launchBrowser: async () => browser as never });
    expect(fill).toHaveBeenCalledWith('secret');
    expect(submitClick).toHaveBeenCalled();
  });

  it('captures each slide and updates progress', async () => {
    const onProgress = vi.fn();
    const screenshot = vi.fn().mockResolvedValue(mockSlideImage);
    const slideLocator = createLocator({ count: vi.fn().mockResolvedValue(2), screenshot });
    const page = createMockPage({
      locator: vi.fn().mockReturnValue(slideLocator),
      evaluate: vi.fn().mockResolvedValue(2),
    });
    const browser = createMockBrowser(page);
    const req: ConversionRequest = {
      url: 'https://docsend.com/view/twoslides',
      tier: 'free',
    };
    // Disable actual sleep by mocking waitForTimeout
    page.waitForTimeout = vi.fn().mockResolvedValue(undefined);
    const job = await converter.convert(req, {
      launchBrowser: async () => browser as never,
      onProgress,
    });
    expect(job.totalSlides).toBe(2);
    expect(job.capturedSlides).toBe(2);
    expect(job.status).toBe('completed');
    expect(onProgress).toHaveBeenCalledWith(50);
    expect(onProgress).toHaveBeenCalledWith(100);
  });

  it('enforces free tier slide limit', async () => {
    const page = createMockPage({
      locator: vi.fn().mockReturnValue(
        createLocator({ isVisible: vi.fn().mockResolvedValue(false), count: vi.fn().mockResolvedValue(0) })
      ),
      evaluate: vi.fn().mockResolvedValue(11),
    });
    const browser = createMockBrowser(page);
    const req: ConversionRequest = {
      url: 'https://docsend.com/view/bigdeck',
      tier: 'free',
    };
    await expect(
      converter.convert(req, { launchBrowser: async () => browser as never })
    ).rejects.toThrow(/limited to 10 slides/);
  });
});
