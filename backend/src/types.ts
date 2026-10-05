export type Tier = 'free' | 'member';

// Identity attached to each request by the session middleware.
// 'free' = anonymous visitor, 'member' = any signed-in (and verified) user.
export interface Viewer {
  tier: Tier;
  userId?: string;
  email?: string;
}

export interface ConversionJob {
  id: string;
  url: string;
  password?: string;
  tier: Tier;
  email?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number; // 0-100
  // Short human-readable phase label (e.g. "Opening your DocSend link") so the
  // UI can show activity during the early stages where progress is still 0.
  stage?: string;
  totalSlides?: number;
  capturedSlides: number;
  outputPath?: string;
  outputSizeBytes?: number;
  error?: string;
  analysis?: PitchDeckAnalysis;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversionRequest {
  url: string;
  password?: string;
  tier: Tier;
  email?: string;
}

export interface PitchDeckAnalysis {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  score: number; // 0-100
}

export interface BrowserSlide {
  index: number;
  imageBuffer: Buffer;
}
