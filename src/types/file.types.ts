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
