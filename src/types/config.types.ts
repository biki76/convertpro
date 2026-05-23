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
