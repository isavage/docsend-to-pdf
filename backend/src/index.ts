import express from 'express';
import cors from 'cors';
import apiRoutes from './api/routes.js';
import { CONFIG } from './config.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Ensure output directory exists
await fs.mkdir(CONFIG.outputDir, { recursive: true });
await fs.mkdir(CONFIG.uploadsDir, { recursive: true });

// API routes
app.use('/api', apiRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Serve frontend for single-page app (fallback)
const distPath = path.join(__dirname, '..', '..', 'frontend', 'dist');
try {
  await fs.access(distPath);
  app.use(express.static(distPath));
  // SPA fallback — serve index.html for non-API routes
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} catch {
  // Frontend not built yet; just serve health check
  console.log('Frontend not built yet, serving only API routes');
}

app.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`Server running at http://${CONFIG.host}:${CONFIG.port}`);
});

export default app;
