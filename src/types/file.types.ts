export enum FileFormat {
  PDF = 'application/pdf',
  DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  CSV = 'text/csv',
  TXT = 'text/plain',
  PNG = 'image/png',
  JPEG = 'image/jpeg',
  TIFF = 'image/tiff',
  BMP = 'image/bmp',
  WEBP = 'image/webp',
  GIF = 'image/gif',
  SVG = 'image/svg+xml',
}

export enum ConversionTarget {
  PDF = 'pdf',
  DOCX = 'docx',
  XLSX = 'xlsx',
  CSV = 'csv',
  TXT = 'txt',
  PNG = 'png',
  JPEG = 'jpeg',
  WEBP = 'webp',
  SVG = 'svg',
  JSON = 'json',
  HTML = 'html',
}

export interface FileMetadata {
  id: string;
  originalName: string;
  format: FileFormat;
  size: number; // bytes
  lastModified: number;
  dimensions?: {
    width: number;
    height: number;
    dpi?: number;
  };
  pages?: number;
  hasTextLayer: boolean;
  isScanned: boolean;
}

export interface UploadedFile {
  id: string;
  file: File;
  metadata: FileMetadata;
  thumbnail?: string; // base64 data URL
  uploadedAt: number; // timestamp
}

export interface ConversionConfig {
  target: ConversionTarget;
  quality?: number; // 1-100
  dpi?: number;
  compressionLevel?: 'lossless' | 'high' | 'medium' | 'low';
  preserveTransparency?: boolean;
  colorSpace?: 'RGB' | 'CMYK' | 'Grayscale';
  pageRange?: {
    start: number;
    end: number;
  };
  ocrOptions?: OCREngineConfig;
  batchMode?: 'sequential' | 'parallel';
  maxConcurrent?: number; // max parallel conversions
}

export interface OCREngineConfig {
  language: string; // 'eng', 'spa', 'fra', etc.
  psm?: PSMode;
  oem?: OEMMode;
  preprocessImage: boolean;
  deskew: boolean;
  adaptiveThreshold: boolean;
  preserveFormatting: boolean;
  confidenceThreshold: number; // 0-100
  createSearchablePDF: boolean;
}

export enum PSMode {
  OSD_ONLY = 0,
  AUTO_OSD = 1,
  AUTO_ONLY = 2,
  AUTO = 3,
  SINGLE_COLUMN = 4,
  SINGLE_BLOCK_VERT = 5,
  SINGLE_BLOCK = 6,
  SINGLE_LINE = 7,
  SINGLE_WORD = 8,
  CIRCLE_WORD = 9,
  SINGLE_CHAR = 10,
  SPARSE_TEXT = 11,
  SPARSE_TEXT_OSD = 12,
  RAW_LINE = 13,
}

export enum OEMMode {
  TESSERACT_ONLY = 0,
  LSTM_ONLY = 1,
  TESSERACT_LSTM = 2,
  DEFAULT = 3,
}

// src/types/processing.types.ts
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

// src/types/config.types.ts
export interface AppConfig {
  maxFileSize: number; // bytes
  allowedFormats: FileFormat[];
  conversionPairs: Map<FileFormat, ConversionTarget[]>;
  ocr: {
    enabled: boolean;
    maxResolution: number;
    defaultLanguage: string;
    availableLanguages: string[];
  };
  ui: {
    theme: 'dark' | 'light' | 'system';
    glassmorphism: boolean;
    animations: boolean;
    adFrequency: number; // every N conversions
  };
  performance: {
    maxConcurrentConversions: number;
    maxQueueSize: number;
    chunkSize: number;
    workerPool: boolean;
  };
}

export interface AdSlotConfig {
  id: string;
  position: 'inline-feed' | 'sidebar' | 'post-conversion';
  frequency: number; // show every N items
  sizes: Array<{ width: number; height: number }>;
  skeletonHeight: number;
  skeletonWidth: number;
  backgroundColor: string;
  shimmerColor: string;
}
