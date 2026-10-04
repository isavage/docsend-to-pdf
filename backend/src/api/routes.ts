import { Router } from 'express';
import { z } from 'zod';
import { DocSendConverter } from '../services/converter.js';
import type { ConversionRequest, ConversionJob } from '../types.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { CONFIG } from '../config.js';

const router = Router();

// In-memory store for active jobs
export const jobStore: Map<string, ConversionJob> = new Map();

// NOTE: `tier` is intentionally NOT part of the request body — it is derived
// server-side from the authenticated session (see req.viewer.tier below).
const convertSchema = z.object({
  url: z.string(),
  password: z.string().optional(),
  email: z.string().email().optional(),
});

// Background worker — runs a single conversion
async function processJob(jobId: string, request: ConversionRequest) {
  const job = jobStore.get(jobId);
  if (!job) return;

  job.status = 'running';
  job.updatedAt = new Date();

  try {
    const converter = new DocSendConverter();
    const onProgress = (pct: number) => {
      job.progress = pct;
      job.updatedAt = new Date();
    };

    const browserFactory = async () => {
      const { chromium } = await import('playwright');
      return chromium.launch({
        headless: true,
        executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
    };

    const resultJob = await converter.convert(request, { launchBrowser: browserFactory, onProgress });
    Object.assign(job, resultJob);
  } catch (err: unknown) {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
  } finally {
    job.updatedAt = new Date();
  }
}

router.post('/convert', async (req, res) => {
  try {
    const body = convertSchema.parse(req.body);
    const jobId = uuidv4();
    const now = new Date();

    // Tier comes from the verified session, never from the client.
    const tier = req.viewer.tier;

    const job: ConversionJob = {
      id: jobId,
      url: body.url,
      password: body.password,
      tier,
      email: body.email ?? req.viewer.email,
      status: 'pending',
      progress: 0,
      capturedSlides: 0,
      createdAt: now,
      updatedAt: now,
    };

    jobStore.set(jobId, job);

    // Start background conversion (tier + email resolved server-side).
    void processJob(jobId, { url: body.url, password: body.password, tier, email: job.email });

    res.json({ jobId, status: 'pending' });
  } catch {
    res.status(400).json({ error: 'Invalid request body' });
  }
});

router.get('/jobs/:id', (_req, res) => {
  const job = jobStore.get(_req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json(job);
});

// SSE stream for job updates
router.get('/events/:id', (req, res) => {
  const jobId = req.params.id;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    // Tell nginx not to buffer this response, otherwise SSE updates
    // only arrive when the stream closes.
    'X-Accel-Buffering': 'no',
  });

  let lastUpdate = jobStore.get(jobId)?.updatedAt;

  const interval = setInterval(() => {
    const job = jobStore.get(jobId);
    if (!job || job.status === 'completed' || job.status === 'failed') {
      clearInterval(interval);
      res.write(`data: ${JSON.stringify(job)}\n\n`);
      res.end();
      return;
    }
    if (lastUpdate?.getTime() !== job.updatedAt.getTime()) {
      res.write(`data: ${JSON.stringify(job)}\n\n`);
      lastUpdate = job.updatedAt;
    }
  }, 500);

  res.on('close', () => clearInterval(interval));
});

// Download the generated PDF
router.get('/download/:id', async (req, res) => {
  const jobId = req.params.id;
  const filePath = path.join(CONFIG.outputDir, `${jobId}.pdf`);
  try {
    await fs.access(filePath);
    const stat = await fs.stat(filePath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${jobId}.pdf"`);
    res.setHeader('Content-Length', stat.size);
    const data = await fs.readFile(filePath);
    res.send(data);
  } catch {
    res.status(404).json({ error: 'PDF not found. Conversion may still be in progress.' });
  }
});

const pitchDeckAnalysisRouter = Router();

pitchDeckAnalysisRouter.post('/analyze', async (req, res) => {
  const { jobId } = req.body as { jobId: string };
  const job = jobStore.get(jobId);
  if (!job || job.status !== 'completed') {
    return res.status(404).json({ error: 'Job not found or not completed' });
  }

  // TODO: Connect to an LLM API for real AI analysis.
  // This stub returns a sample analysis based on slide count.
  const slideCount = job.totalSlides ?? 10;
  const score = Math.min(95, Math.max(50, 60 + Math.floor(Math.random() * 30)));

  res.json({
    jobId,
    analysis: {
      score,
      strengths: [
        'Clear value proposition on slide 2-3',
        `${slideCount} slides within optimal range`,
        'Strong visual hierarchy and consistent design system',
      ],
      weaknesses: [
        'Missing competitive differentiation section',
        'Revenue projections need more granular breakdown',
        'Call-to-action could be more prominent',
      ],
    },
    upsellNote:
      req.viewer.tier === 'member'
        ? undefined
        : 'Sign in free to unlock full AI analysis and 1,000-slide conversions.',
  });
});

router.use('/pitch-deck', pitchDeckAnalysisRouter);

export default router;
