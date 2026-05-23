export enum ProcessingStatus {
  IDLE = 'idle',
  QUEUED = 'queued',
  PREPROCESSING = 'preprocessing',
  OCR = 'ocr',
  CONVERTING = 'converting',
  COMPLETE = 'complete',
  ERROR = 'error',
  CANCELLED = 'cancelled',
}

export interface ProcessingProgress {
  percentage: number; // 0-100
  currentPage: number;
  totalPages: number;
  elapsedTime: number; // ms
  estimatedRemaining: number; // ms
  bytesProcessed: number;
  totalBytes: number;
}

export interface ProcessingMetrics {
  startTime: number;
  endTime?: number;
  preprocessTime?: number;
  ocrTime?: number;
  conversionTime?: number;
  inputSize: number; // bytes
  outputSize?: number; // bytes
  compressionRatio?: number;
  ocrConfidence?: number;
  pagesProcessed?: number;
  errors?: string[];
}

export interface ConversionJob {
  id: string;
  fileId: string;
  inputFormat: FileFormat;
  targetFormat: ConversionTarget;
  config: ConversionConfig;
  status: ProcessingStatus;
  progress: ProcessingProgress;
  metrics: ProcessingMetrics;
  output?: Blob;
  previewUrl?: string;
  error?: ConversionError;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface ConversionError {
  code: string;
  message: string;
  stack?: string;
  recoverable: boolean;
  retryCount: number;
  maxRetries: number;
}

export interface QueueState {
  active: string[];
  queued: string[];
  completed: string[];
  failed: string[];
  maxConcurrent: number;
  maxQueueSize: number;
}
