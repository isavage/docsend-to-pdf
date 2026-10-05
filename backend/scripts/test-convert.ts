/**
 * Ad-hoc end-to-end test of the converter against a real DocSend link.
 * Run: npx tsx scripts/test-convert.ts <url>
 * Uses the Playwright-bundled Chromium (no executablePath), writes PDF to /tmp/out.
 */
import { chromium } from 'playwright';
import { DocSendConverter, BROWSER_STEALTH_ARGS } from '../src/services/converter.js';

const url = process.argv[2] ?? 'https://docsend.com/view/s/4ju6hxsser8gsfzy';

const converter = new DocSendConverter({ outputDir: '/tmp/out' });
const t0 = Date.now();

try {
  const job = await converter.convert(
    { url, tier: 'member', email: process.env.GATE_EMAIL },
    {
      launchBrowser: () =>
        chromium.launch({
          headless: true,
          executablePath: process.env.CHROMIUM_PATH || undefined,
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', ...BROWSER_STEALTH_ARGS],
        }),
      onStage: (s) => console.log(`[stage ${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`),
      onProgress: (p) => console.log(`[progress] ${p}%`),
    }
  );
  console.log('RESULT:', {
    status: job.status,
    totalSlides: job.totalSlides,
    captured: job.capturedSlides,
    sizeKB: job.outputSizeBytes && Math.round(job.outputSizeBytes / 1024),
    output: job.outputPath,
  });
} catch (e) {
  console.error('FAILED after', ((Date.now() - t0) / 1000).toFixed(1), 's:');
  console.error(e);
  process.exitCode = 1;
}
