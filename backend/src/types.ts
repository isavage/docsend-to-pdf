export type Tier = 'free' | 'paid';

export interface ConversionJob {
  id: string;
  url: string;
  password?: string;
  tier: Tier;
  email?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number; // 0-100
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
