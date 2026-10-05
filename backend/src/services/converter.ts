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

export class DocSendBlockedError extends Error {
  constructor() {
    super('DocSend blocked the request (bot protection). Please try again in a few minutes.');
    this.name = 'DocSendBlockedError';
  }
}

export class EmailGateRequiredError extends Error {
  constructor() {
    super('This DocSend link asks viewers to confirm their email first. Enter your email in the form and try again.');
    this.name = 'EmailGateRequiredError';
  }
}

export class SpaceLinkError extends Error {
  constructor() {
    super('This link is a DocSend Space (a folder of documents), not a single presentation. Open the document inside the space and paste its direct link.');
    this.name = 'SpaceLinkError';
  }
}

// DocSend sits behind CloudFront, which 403s the default headless browser
// ("HeadlessChrome" UA / automation flags). A realistic UA + hiding the
// automation feature flag gets us through; verified with live testing.
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
export const BROWSER_STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  `--user-agent=${BROWSER_USER_AGENT}`,
];

export interface ConverterDependencies {
  launchBrowser: () => Promise<Browser>;
  onProgress?: (percent: number) => void;
  // Human-readable phase label streamed to the client so the UI can show what
  // is happening during the long browser-launch / page-load phases (where the
  // numeric progress is still 0).
  onStage?: (stage: string) => void;
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
    deps.onStage?.('Launching browser');
    const browser = await deps.launchBrowser();

    try {
      const page = await browser.newPage();
      await page.setViewportSize({ width: 1440, height: 900 });
      deps.onStage?.('Opening your DocSend link');
      const response = await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: CONFIG.browserTimeoutMs });
      await page.waitForLoadState('networkidle', { timeout: CONFIG.browserTimeoutMs }).catch(() => undefined);

      deps.onStage?.('Checking the document');
      // CloudFront bot-block answers with an HTTP 403 error page.
      if (response && typeof response.status === 'function' && response.status() >= 400) {
        throw new DocSendBlockedError();
      }
      await this.checkExpiration(page);
      await this.checkViewOnlyMode(page);
      await this.dismissCookieBanner(page);
      await this.passEmailGateIfNeeded(page, request.email);
      // The cookie banner can reappear on top of the unlocked viewer.
      await this.dismissCookieBanner(page);

      const kind = await this.detectPageKind(page);
      if (kind === 'blocked') throw new DocSendBlockedError();
      if (kind === 'space') throw new SpaceLinkError();

      await this.enterPasswordIfNeeded(page, request.password);

      deps.onStage?.('Detecting slides');
      const totalSlides = await this.countSlides(page);
      assertTierAllowsSlides(request.tier, totalSlides);
      job.totalSlides = totalSlides;

      const slides = await this.captureSlides(page, totalSlides, job, deps.onProgress, deps.onStage);
      deps.onStage?.('Building your PDF');
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

  private async dismissCookieBanner(page: Page): Promise<void> {
    // The consent banner can live in the main document OR in a cross-origin
    // iframe (DocSend embeds a dropbox.com/ccpa_iframe). Playwright can still
    // reach into out-of-process frames, so we try every frame.
    const selector =
      'button:has-text("Accept All"), button:has-text("Decline all cookies"), button:has-text("Decline")';
    let clicked = false;
    // Main-frame locator first.
    const button = page.locator(selector).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => undefined);
      clicked = true;
    }
    const frames = typeof page.frames === 'function' ? page.frames() : [];
    if (!clicked) {
      for (const frame of frames) {
        if (!/dropbox\.com|docsend\.com/i.test(frame.url())) continue;
        const fbtn = frame.locator(selector).first();
        if (await fbtn.isVisible().catch(() => false)) {
          await fbtn.click().catch(() => undefined);
          clicked = true;
          break;
        }
      }
    }
    if (clicked) await page.waitForTimeout(600);
  }

  /**
   * The email gate / password prompt is a React modal that can mount a second
   * or two *after* networkidle. A single isVisible() check races it and misses
   * (leaving the gate painted into the PDF), so wait briefly for it to appear.
   * Falls back to a plain isVisible() check when waitForSelector is absent.
   */
  private async gateInputVisible(page: Page, selector: string, input: { isVisible: () => Promise<boolean> }): Promise<boolean> {
    if (typeof page.waitForSelector === 'function') {
      const found = await page
        .waitForSelector(selector, { state: 'visible', timeout: 6000 })
        .catch(() => null);
      return !!found;
    }
    return input.isVisible().catch(() => false);
  }

  /**
   * DocSend links can be configured with an "email gate" ("… requests your
   * action to continue" — an email input + Confirm button) before the doc
   * renders. We pass the viewer's email through when they provided one.
   */
  private async passEmailGateIfNeeded(page: Page, email?: string): Promise<void> {
    const emailInput = page.locator('input[type="email"]').first();
    if (!(await this.gateInputVisible(page, 'input[type="email"]', emailInput))) return;
    if (!email) {
      throw new EmailGateRequiredError();
    }
    await emailInput.fill(email);
    // The submit button label varies between DocSend configs: Confirm,
    // Continue, Submit, Get access… Match by type or common labels.
    const submit = page
      .locator(
        'button[type="submit"], button:has-text("Confirm"), button:has-text("Continue"), button:has-text("Submit"), button:has-text("Get access"), button:has-text("Access")'
      )
      .first();
    await submit.click({ timeout: 5000 }).catch(async () => {
      await emailInput.press('Enter').catch(() => undefined);
    });
    // Wait for the gate to actually disappear (page content mounts behind it).
    await page.waitForTimeout(1500);
    const stillGated = await emailInput.isVisible().catch(() => false);
    if (stillGated) {
      await emailInput.press('Enter').catch(() => undefined);
    }
    if (typeof page.waitForFunction === 'function') {
      await page
        .waitForFunction(
          () => {
            const input = document.querySelector('input[type="email"]') as HTMLElement | null;
            return !input || input.getBoundingClientRect().height === 0;
          },
          null,
          { timeout: 20000 }
        )
        .catch(() => undefined);
    } else {
      await page.waitForTimeout(4000);
    }
  }

  /**
   * Distinguish a real deck from a bot-block page or a DocSend *Space*
   * (folder listing — `/view/s/…` links can point at a whole library).
   * Returns a sentinel string so mocks that return numbers never trip it.
   */
  private async detectPageKind(page: Page): Promise<'ok' | 'blocked' | 'space'> {
    return page.evaluate((): 'ok' | 'blocked' | 'space' => {
      const text = document.body?.innerText || '';
      if (/403 ERROR|The request could not be satisfied|Just a moment|Access Denied/i.test(text)) {
        return 'blocked';
      }
      const hasSlides =
        document.querySelectorAll('.slide, [data-testid="slide"], .viewer-slide, canvas').length > 0;
      const hasCounter = /\d+\s*\/\s*\d+/.test(text);
      const looksLikeFolder = /\b\d+ items?\b/i.test(text) || /(Source Files|Original Documents)/i.test(text);
      if (!hasSlides && !hasCounter && /\/view\/s\//.test(location.pathname) && looksLikeFolder) {
        return 'space';
      }
      return 'ok';
    });
  }

  private async enterPasswordIfNeeded(page: Page, password?: string): Promise<void> {
    const passwordInput = page.locator('input[type="password"]').first();
    if (await this.gateInputVisible(page, 'input[type="password"]', passwordInput)) {
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
      // 1) DocSend's viewer renders a "current / total" page counter; reading it
      //    is far more reliable than guessing slide container class names.
      const text = document.body?.innerText || '';
      const match = text.match(/(\d+)\s*\/\s*(\d+)/);
      if (match) {
        const total = parseInt(match[2], 10);
        if (total > 0 && total < 2000) return total;
      }
      // 2) Fall back to counting known slide containers.
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
    onProgress?: (percent: number) => void,
    onStage?: (stage: string) => void
  ): Promise<BrowserSlide[]> {
    const slides: BrowserSlide[] = [];

    for (let i = 0; i < totalSlides; i++) {
      onStage?.(`Capturing slide ${i + 1} of ${totalSlides}`);
      await page.waitForTimeout(CONFIG.slideWaitMs);
      // Some "slides" are single very tall pages (resumes, long docs). Grow the
      // viewport to the slide's real height so nothing below the fold is lost,
      // then clip to the reader region (excludes toolbar + carousel arrows).
      let clip = await this.fitViewportToSlide(page);
      // DocSend lazy-loads the page image — and re-loads it after a viewport
      // resize — leaving `blank.gif` painted in a full-size container until the
      // CloudFront image arrives. Screenshotting early yields a blank page, so
      // wait for real content, then re-measure (layout can shift).
      await this.waitForSlideRendered(page);
      clip = (await this.readClip(page)) ?? clip;
      // Cookie banner / breadcrumb drawer are fixed overlays that re-mount when
      // the viewport changes, so hide them right before each screenshot.
      await this.hideViewerOverlays(page);
      // Screenshot the viewport (clipped to the reader) rather than a specific
      // element: DocSend renders slides via canvas and an element locator often
      // times out waiting for a node that never becomes visible & stable.
      const imageBuffer = await page.screenshot({ type: 'png', clip: clip ?? undefined });
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

  /**
   * Hide fixed overlays that overlap the slide content in screenshots: the
   * cookie-consent banner (find its container by walking up from the visible
   * Accept/Decline buttons) and the bottom breadcrumb drawer.
   */
  private async hideViewerOverlays(page: Page): Promise<void> {
    await page
      .evaluate(() => {
        // A stylesheet rule also hides overlays that mount LATER (the drawer
        // re-initializes after viewport resizes), unlike inline styles.
        if (!document.getElementById('docsend-pdf-hide-overlays')) {
          const style = document.createElement('style');
          style.id = 'docsend-pdf-hide-overlays';
          style.textContent =
            '.js-init-drawer-controller, .drawer, .drawer_tab, ' +
            'iframe[src*="ccpa"], iframe[src*="cookie"], iframe[src*="consent"] ' +
            '{ display: none !important; }';
          document.head.appendChild(style);
        }
        const isVisible = (el: Element) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        for (const btn of Array.from(document.querySelectorAll('button, a'))) {
          if (/Accept All|Decline all cookies|Decline$/i.test(btn.textContent || '') && isVisible(btn)) {
            let el: HTMLElement | null = btn as HTMLElement;
            for (let i = 0; i < 6 && el?.parentElement; i++) {
              el = el.parentElement as HTMLElement;
              const r = el.getBoundingClientRect();
              if (r.width >= 300 && r.height >= 80) break;
            }
            el?.style.setProperty('display', 'none', 'important');
          }
        }
        for (const drawer of document.querySelectorAll('.js-init-drawer-controller, .drawer')) {
          (drawer as HTMLElement).style.setProperty('display', 'none', 'important');
        }
        // The consent banner is often a cross-origin dropbox.com/ccpa_iframe;
        // hiding the <iframe> element in this document removes it from the shot.
        for (const f of document.querySelectorAll('iframe')) {
          if (/ccpa|cookie|consent/i.test(f.src || '')) {
            f.style.setProperty('display', 'none', 'important');
          }
        }
      })
      .catch(() => undefined);
  }

  /**
   * DocSend swaps a loading placeholder for the real slide (canvas or image)
   * asynchronously; the container keeps its full height the whole time, so we
   * must detect the rendered content itself before screenshotting.
   */
  private async waitForSlideRendered(page: Page): Promise<void> {
    const deadline = Date.now() + 25000;
    // Two consecutive stable readings avoid capturing a half-painted canvas.
    let stable = 0;
    while (Date.now() < deadline && stable < 2) {
      const readyRaw = await page
        .evaluate((): boolean => {
          const active =
            document.querySelector('.carousel-inner .item.active') ||
            document.querySelector('.carousel-inner');
          const scope: ParentNode = active || document;
          const canvas = Array.from(scope.querySelectorAll('canvas')).some((c) => {
            const r = c.getBoundingClientRect();
            if (r.width < 100 || r.height < 100) return false;
            // A canvas can exist while still blank; sample a few pixels to
            // confirm real content was painted. Tainted canvases (CORS) throw
            // — in that case trust its size.
            try {
              const ctx = (c as HTMLCanvasElement).getContext('2d');
              if (!ctx) return true;
              const data = ctx.getImageData(0, 0, Math.min(c.width, 200), Math.min(c.height, 200)).data;
              for (let i = 3; i < data.length; i += 40) {
                if (data[i] > 0) return true;
              }
              return false;
            } catch {
              return true;
            }
          });
          const img = Array.from(scope.querySelectorAll('img')).some((im) => {
            const r = im.getBoundingClientRect();
            const el = im as HTMLImageElement;
            return (
              r.width > 100 &&
              r.height > 100 &&
              el.complete &&
              el.naturalWidth > 100 &&
              !/loading|loader|placeholder|blank/i.test(el.src || '')
            );
          });
          return canvas || img;
        })
        .catch(() => true); // mocks / unexpected pages: don't block forever
      // Mocks return non-boolean values (e.g. 0); treat anything unexpected as ready.
      const ready = typeof readyRaw === 'boolean' ? readyRaw : true;
      stable = ready ? stable + 1 : 0;
      await page.waitForTimeout(400);
    }
  }

  /**
   * If the active slide is taller than the viewport (single long-page docs),
   * grow the viewport so the whole slide renders, then return the reader's
   * bounding box as the screenshot clip. Falls back to the plain clip.
   */
  private async fitViewportToSlide(page: Page): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const geom = await page
      .evaluate((): { viewportH: number; itemH: number; viewportW: number } | null => {
        const inner = document.querySelector('.carousel-inner');
        if (!inner) return null;
        const active = inner.querySelector('.item.active') || inner;
        const ra = active.getBoundingClientRect();
        if (ra.width < 50 || ra.height < 50) return null;
        return { viewportH: window.innerHeight, itemH: Math.ceil(ra.height), viewportW: window.innerWidth };
      })
      .catch(() => null);
    // Mocks in unit tests return numbers here; ignore non-object results.
    if (geom && typeof geom === 'object' && geom.itemH + 80 > geom.viewportH) {
      const targetHeight = Math.min(geom.itemH + 80, 6000);
      await page.setViewportSize({ width: geom.viewportW, height: targetHeight }).catch(() => undefined);
      await page.waitForTimeout(600);
    }
    return this.readClip(page);
  }

  /**
   * Bounding box of the slide reader so captures exclude the DocSend chrome
   * (toolbar, carousel arrows). Returns null when no reader element is found.
   */
  private async readClip(page: Page): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return page
      .evaluate(() => {
        const reader =
          document.querySelector('.carousel-inner') ||
          document.querySelector('[data-testid="slide"]') ||
          document.querySelector('.viewer-slide') ||
          document.querySelector('.slide');
        if (!reader) return null;
        const r = reader.getBoundingClientRect();
        // Ignore zero-size / off-screen nodes.
        if (r.width < 50 || r.height < 50) return null;
        return {
          x: Math.max(0, Math.round(r.x)),
          y: Math.max(0, Math.round(r.y)),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
      })
      .catch(() => null);
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
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', ...BROWSER_STEALTH_ARGS],
  });
}
