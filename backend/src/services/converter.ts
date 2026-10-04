import { Browser, Page } from 'playwright';
import { PDFDocument, PageSizes } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ConversionRequest, ConversionJob, BrowserSlide } from '../types.js';
import { CONFIG } from '../config.js';
import { assertTierAllowsSlides, assertFileSizeUnderLimit } from './tier.js';

export class InvalidUrlError extends Error {
  constructor() {
    super('Invalid DocSend URL');
    this.name = 'InvalidUrlError';
  }
}

export class ExpiredLinkError extends Error {
  constructor() {
    super('This DocSend link has expired');
    this.name = 'ExpiredLinkError';
  }
}

export class PasswordRequiredError extends Error {
  constructor() {
    super('Password is required for this DocSend link');
    this.name = 'PasswordRequiredError';
  }
}

export class ViewOnlyModeError extends Error {
  constructor() {
    super('Document is in view-only mode and cannot be converted');
    this.name = 'ViewOnlyModeError';
  }
}

export interface ConverterDependencies {
  launchBrowser: () => Promise<Browser>;
  onProgress?: (percent: number) => void;
}

export function validateDocSendUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const isDocSend = /^(www\.)?docsend\.com$/i.test(parsed.hostname);
    const isViewPath = /^\/view\//.test(parsed.pathname);
    return isDocSend && isViewPath;
  } catch {
    return false;
  }
}

export class DocSendConverter {
  private outputDir: string;

  constructor(options: { outputDir?: string } = {}) {
    this.outputDir = options.outputDir ?? CONFIG.outputDir;
  }

  async convert(
    request: ConversionRequest,
    deps: ConverterDependencies = { launchBrowser: defaultLaunchBrowser }
  ): Promise<ConversionJob> {
    if (!validateDocSendUrl(request.url)) {
      throw new InvalidUrlError();
    }

    const job = this.createJob(request);
    const browser = await deps.launchBrowser();

    try {
      const page = await browser.newPage();
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: CONFIG.browserTimeoutMs });
      await page.waitForLoadState('networkidle', { timeout: CONFIG.browserTimeoutMs });

      await this.checkExpiration(page);
      await this.checkViewOnlyMode(page);
      await this.enterPasswordIfNeeded(page, request.password);

      const totalSlides = await this.countSlides(page);
      assertTierAllowsSlides(request.tier, totalSlides);
      job.totalSlides = totalSlides;

      const slides = await this.captureSlides(page, totalSlides, job, deps.onProgress);
      const outputPath = await this.stitchPdf(job.id, slides);
      const stats = await fs.stat(outputPath);
      assertFileSizeUnderLimit(stats.size);

      job.outputPath = outputPath;
      job.outputSizeBytes = stats.size;
      job.status = 'completed';
      job.progress = 100;
      job.updatedAt = new Date();
      return job;
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      job.updatedAt = new Date();
      throw err;
    } finally {
      await browser.close();
    }
  }

  private createJob(request: ConversionRequest): ConversionJob {
    const now = new Date();
    return {
      id: uuidv4(),
      url: request.url,
      password: request.password,
      tier: request.tier,
      email: request.email,
      status: 'running',
      progress: 0,
      capturedSlides: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async checkExpiration(page: Page): Promise<void> {
    const expiredLocator = page.locator('text=/expired|no longer available/i').first();
    if (await expiredLocator.isVisible().catch(() => false)) {
      throw new ExpiredLinkError();
    }
  }

  private async checkViewOnlyMode(page: Page): Promise<void> {
    const viewOnlyLocator = page.locator('text=/view.only|download disabled/i').first();
    if (await viewOnlyLocator.isVisible().catch(() => false)) {
      throw new ViewOnlyModeError();
    }
  }

  private async enterPasswordIfNeeded(page: Page, password?: string): Promise<void> {
    const passwordInput = page.locator('input[type="password"]').first();
    if (await passwordInput.isVisible().catch(() => false)) {
      if (!password) {
        throw new PasswordRequiredError();
      }
      await passwordInput.fill(password);
      const submitButton = page.locator('button[type="submit"], button:has-text("Submit"), button:has-text("Access")').first();
      await submitButton.click();
      await page.waitForTimeout(1500);
    }
  }

  private async countSlides(page: Page): Promise<number> {
    return page.evaluate(() => {
      const selectors = [
        '[data-testid="slide"]',
        '.slide',
        '.viewer-slide',
        '.page',
        'img[src*="slide"]',
      ];
      for (const selector of selectors) {
        const count = document.querySelectorAll(selector).length;
        if (count > 0) return count;
      }
      return 1;
    });
  }

  private async captureSlides(
    page: Page,
    totalSlides: number,
    job: ConversionJob,
    onProgress?: (percent: number) => void
  ): Promise<BrowserSlide[]> {
    const slides: BrowserSlide[] = [];
    const slideLocator = page.locator('.slide, [data-testid="slide"], .viewer-slide, img').first();

    for (let i = 0; i < totalSlides; i++) {
      await page.waitForTimeout(CONFIG.slideWaitMs);
      const imageBuffer = await slideLocator.screenshot({ type: 'png' });
      slides.push({ index: i, imageBuffer });
      job.capturedSlides = i + 1;
      job.progress = Math.round(((i + 1) / totalSlides) * 100);
      onProgress?.(job.progress);

      if (i < totalSlides - 1) {
        await page.keyboard.press('ArrowRight').catch(() => undefined);
      }
    }

    return slides;
  }

  private async stitchPdf(jobId: string, slides: BrowserSlide[]): Promise<string> {
    await fs.mkdir(this.outputDir, { recursive: true });
    const pdfDoc = await PDFDocument.create();

    for (const slide of slides) {
      const pngImage = await pdfDoc.embedPng(slide.imageBuffer);
      const page = pdfDoc.addPage(PageSizes.A4);
      const { width, height } = page.getSize();
      const imgDims = pngImage.scaleToFit(width, height);
      page.drawImage(pngImage, {
        x: (width - imgDims.width) / 2,
        y: (height - imgDims.height) / 2,
        width: imgDims.width,
        height: imgDims.height,
      });
    }

    const outputPath = path.join(this.outputDir, `${jobId}.pdf`);
    const pdfBytes = await pdfDoc.save();
    await fs.writeFile(outputPath, pdfBytes);
    return outputPath;
  }
}

async function defaultLaunchBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright');
  return chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
}
