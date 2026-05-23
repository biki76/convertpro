import { ProcessingStatus, ConversionJob, ConversionConfig, ConversionTarget, FileFormat, ProcessingMetrics, ConversionError, OCREngineConfig } from '../types';
import { ImageProcessor } from './imageProcessor';
import { QueueManager } from './queueManager';
import { v4 as uuidv4 } from 'uuid';
import * as pdfLib from 'pdf-lib';
import * as XLSX from 'xlsx';
import Tesseract from 'tesseract.js';

export class Converter {
  private imageProcessor: ImageProcessor;
  private queueManager: QueueManager;
  private activeJobs: Map<string, ConversionJob>;
  private abortControllers: Map<string, AbortController>;
  private onProgressCallbacks: Map<string, (job: ConversionJob) => void>;

  constructor(maxConcurrent = 3) {
    this.imageProcessor = new ImageProcessor();
    this.queueManager = new QueueManager(maxConcurrent);
    this.activeJobs = new Map();
    this.abortControllers = new Map();
    this.onProgressCallbacks = new Map();
  }

  async convert(
    fileId: string,
    inputBlob: Blob,
    inputFormat: FileFormat,
    targetFormat: ConversionTarget,
    config: ConversionConfig,
    onProgress?: (job: ConversionJob) => void
  ): Promise<string> {
    const jobId = uuidv4();
    
    const job: ConversionJob = {
      id: jobId,
      fileId,
      inputFormat,
      targetFormat,
      config,
      status: ProcessingStatus.QUEUED,
      progress: {
        percentage: 0,
        currentPage: 0,
        totalPages: 1,
        elapsedTime: 0,
        estimatedRemaining: 0,
        bytesProcessed: 0,
        totalBytes: inputBlob.size,
      },
      metrics: {
        startTime: Date.now(),
        inputSize: inputBlob.size,
      },
      createdAt: Date.now(),
    };

    if (onProgress) {
      this.onProgressCallbacks.set(jobId, onProgress);
    }

    this.activeJobs.set(jobId, job);

    return this.queueManager.enqueue(async () => {
      const controller = new AbortController();
      this.abortControllers.set(jobId, controller);
      
      try {
        return await this.processConversion(job, inputBlob, controller.signal);
      } catch (error) {
        await this.handleConversionError(job, error as Error);
        throw error;
      } finally {
        this.abortControllers.delete(jobId);
        this.activeJobs.delete(jobId);
      }
    });
  }

  private async processConversion(
    job: ConversionJob,
    inputBlob: Blob,
    signal: AbortSignal
  ): Promise<string> {
    job.status = ProcessingStatus.PREPROCESSING;
    job.startedAt = Date.now();
    this.updateProgress(job);

    // Check for abort
    if (signal.aborted) throw new Error('Conversion aborted');

    // Preprocess if image format
    let processedBlob = inputBlob;
    if (this.isImageFormat(job.inputFormat) && job.config.ocrOptions?.preprocessImage) {
      processedBlob = await this.preprocessImage(inputBlob, signal);
    }

    // Perform OCR if needed
    if (job.config.ocrOptions && this.needsOCR(job.inputFormat, job.targetFormat)) {
      await this.performOCR(job, processedBlob, signal);
    }

    // Convert to target format
    job.status = ProcessingStatus.CONVERTING;
    this.updateProgress(job);

    const outputBlob = await this.convertFormat(
      job.inputFormat,
      job.targetFormat,
      processedBlob,
      job.config,
      signal
    );

    job.status = ProcessingStatus.COMPLETE;
    job.output = outputBlob;
    job.metrics.endTime = Date.now();
    job.metrics.outputSize = outputBlob.size;
    job.metrics.compressionRatio = job.metrics.outputSize / job.metrics.inputSize;
    job.completedAt = Date.now();
    job.progress.percentage = 100;
    
    this.updateProgress(job);
    
    return job.id;
  }

  private async preprocessImage(blob: Blob, signal: AbortSignal): Promise<Blob> {
    const imageData = await this.imageProcessor.loadImageFromBlob(blob);
    
    const processed = await this.imageProcessor.preprocessDocument(imageData, {
      removeShadows: true,
      deskew: true,
      binarize: true,
      binarizationConfig: {
        method: 'adaptive-gaussian',
        blockSize: 11,
        C: 2,
      },
    });

    return this.imageProcessor.imageDataToBlob(processed);
  }

  private async performOCR(
    job: ConversionJob,
    blob: Blob,
    signal: AbortSignal
  ): Promise<string> {
    job.status = ProcessingStatus.OCR;
    this.updateProgress(job);

    const ocrConfig = job.config.ocrOptions!;
    
    try {
      const worker = await Tesseract.createWorker(ocrConfig.language, ocrConfig.oem);
      
      const result = await worker.recognize(blob);
      
      job.metrics.ocrTime = Date.now() - (job.startedAt || 0);
      job.metrics.ocrConfidence = result.data.confidence;
      
      await worker.terminate();
      
      return result.data.text;
    } catch (error) {
      throw new Error(`OCR processing failed: ${(error as Error).message}`);
    }
  }

  private async convertFormat(
    inputFormat: FileFormat,
    targetFormat: ConversionTarget,
    inputBlob: Blob,
    config: ConversionConfig,
    signal: AbortSignal
  ): Promise<Blob> {
    switch (targetFormat) {
      case ConversionTarget.PDF:
        return this.convertToPDF(inputFormat, inputBlob, config, signal);
      case ConversionTarget.XLSX:
        return this.convertToXLSX(inputFormat, inputBlob, config, signal);
      case ConversionTarget.CSV:
        return this.convertToCSV(inputFormat, inputBlob, config, signal);
      case ConversionTarget.TXT:
        return this.convertToTXT(inputFormat, inputBlob, config, signal);
      case ConversionTarget.PNG:
        return this.convertToImage(inputBlob, 'image/png', config);
      case ConversionTarget.JPEG:
        return this.convertToImage(inputBlob, 'image/jpeg', config);
      case ConversionTarget.WEBP:
        return this.convertToImage(inputBlob, 'image/webp', config);
      case ConversionTarget.JSON:
        return this.convertToJSON(inputFormat, inputBlob, config, signal);
      case ConversionTarget.HTML:
        return this.convertToHTML(inputFormat, inputBlob, config, signal);
      default:
        throw new Error(`Unsupported conversion: ${inputFormat} -> ${targetFormat}`);
    }
  }

  private async convertToPDF(
    inputFormat: FileFormat,
    inputBlob: Blob,
    config: ConversionConfig,
    signal: AbortSignal
  ): Promise<Blob> {
    const { PDFDocument } = pdfLib;
    
    if (inputFormat === FileFormat.PDF) {
      // Already PDF, just return
      return inputBlob;
    }

    const pdfDoc = await PDFDocument.create();
    
    if (this.isImageFormat(inputFormat)) {
      // Convert image to PDF
      let imageBytes: Uint8Array;
      
      switch (inputFormat) {
        case FileFormat.PNG:
          imageBytes = new Uint8Array(await inputBlob.arrayBuffer());
          const pngImage = await pdfDoc.embedPng(imageBytes);
          const pngPage = pdfDoc.addPage([pngImage.width, pngImage.height]);
          pngPage.drawImage(pngImage, {
            x: 0,
            y: 0,
            width: pngImage.width,
            height: pngImage.height,
          });
          break;
        
        case FileFormat.JPEG:
          imageBytes = new Uint8Array(await inputBlob.arrayBuffer());
          const jpgImage = await pdfDoc.embedJpg(imageBytes);
          const jpgPage = pdfDoc.addPage([jpgImage.width, jpgImage.height]);
          jpgPage.drawImage(jpgImage, {
            x: 0,
            y: 0,
            width: jpgImage.width,
            height: jpgImage.height,
          });
          break;
        
        default:
          // Convert unsupported image to PNG first
          const pngBlob = await this.convertToImage(inputBlob, 'image/png', config);
          const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
          const image = await pdfDoc.embedPng(pngBytes);
          const page = pdfDoc.addPage([image.width, image.height]);
          page.drawImage(image, {
            x: 0,
            y: 0,
            width: image.width,
            height: image.height,
          });
      }
    } else if (inputFormat === FileFormat.TXT) {
      // Convert text to PDF
      const text = await inputBlob.text();
      const page = pdfDoc.addPage();
      const { width, height } = page.getSize();
      const fontSize = 12;
      const lineHeight = fontSize * 1.5;
      const lines = text.split('\n');
      
      let y = height - fontSize;
      for (const line of lines) {
        if (y < fontSize) {
          break; // Stop if we run out of space
        }
        page.drawText(line, {
          x: 50,
          y,
          size: fontSize,
        });
        y -= lineHeight;
      }
    }

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
  }

  private async convertToXLSX(
    inputFormat: FileFormat,
    inputBlob: Blob,
    config: ConversionConfig,
    signal: AbortSignal
  ): Promise<Blob> {
    if (inputFormat === FileFormat.XLSX) {
      return inputBlob;
    }

    const workbook = XLSX.utils.book_new();
    
    if (inputFormat === FileFormat.CSV) {
      const text = await inputBlob.text();
      const worksheet = XLSX.utils.aoa_to_sheet(
        text.split('\n').map(row => row.split(','))
      );
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    } else if (inputFormat === FileFormat.JSON) {
      const text = await inputBlob.text();
      const data = JSON.parse(text);
      const worksheet = XLSX.utils.json_to_sheet(Array.isArray(data) ? data : [data]);
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    } else {
      throw new Error(`Cannot convert ${inputFormat} to XLSX`);
    }

    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    return new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  private async convertToCSV(
    inputFormat: FileFormat,
    inputBlob: Blob,
    config: ConversionConfig,
    signal: AbortSignal
  ): Promise<Blob> {
    if (inputFormat === FileFormat.CSV) {
      return inputBlob;
    }

    if (inputFormat === FileFormat.XLSX) {
      const buffer = await inputBlob.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const csv = XLSX.utils.sheet_to_csv(firstSheet);
      return new Blob([csv], { type: 'text/csv' });
    } else if (inputFormat === FileFormat.JSON) {
      const text = await inputBlob.text();
      const data = JSON.parse(text);
      const worksheet = XLSX.utils.json_to_sheet(Array.isArray(data) ? data : [data]);
      const csv = XLSX.utils.sheet_to_csv(worksheet);
      return new Blob([csv], { type: 'text/csv' });
    }

    throw new Error(`Cannot convert ${inputFormat} to CSV`);
  }

  private async convertToTXT(
    inputFormat: FileFormat,
    inputBlob: Blob,
    config: ConversionConfig,
    signal: AbortSignal
  ): Promise<Blob> {
    if (inputFormat === FileFormat.TXT) {
      return inputBlob;
    }

    if (this.isImageFormat(inputFormat)) {
      // OCR to text
      const ocrConfig: OCREngineConfig = {
        language: 'eng',
        psm: 3, // PSMode.AUTO
        oem: 3, // OEMMode.DEFAULT
        preprocessImage: true,
        deskew: true,
        adaptiveThreshold: true,
        preserveFormatting: false,
        confidenceThreshold: 60,
        createSearchablePDF: false,
      };
      
      const worker = await Tesseract.createWorker(ocrConfig.language, ocrConfig.oem);
      const result = await worker.recognize(inputBlob);
      await worker.terminate();
      
      return new Blob([result.data.text], { type: 'text/plain' });
    } else if (inputFormat === FileFormat.PDF) {
      // Extract text from PDF (simplified)
      const pdfBytes = await inputBlob.arrayBuffer();
      const pdfDoc = await pdfLib.PDFDocument.load(pdfBytes);
      const pages = pdfDoc.getPages();
      const textContent: string[] = [];
      
      // Note: PDF text extraction is complex; this is simplified
      for (const page of pages) {
        textContent.push(`[Page ${pages.indexOf(page) + 1}]`);
        // Text extraction would require additional libraries
      }
      
      return new Blob([textContent.join('\n')], { type: 'text/plain' });
    }

    // Default: read as text
    const text = await inputBlob.text();
    return new Blob([text], { type: 'text/plain' });
  }

  private async convertToJSON(
    inputFormat: FileFormat,
    inputBlob: Blob,
    config: ConversionConfig,
    signal: AbortSignal
  ): Promise<Blob> {
    const text = await inputBlob.text();
    let data: any;

    switch (inputFormat) {
      case FileFormat.CSV:
        data = text.split('\n').map(row => {
          const values = row.split(',');
          return values;
        });
        break;
      
      case FileFormat.XLSX: {
        const buffer = await inputBlob.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        data = {};
        workbook.SheetNames.forEach(name => {
          data[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name]);
        });
        break;
      }
      
      default:
        // Try parsing as JSON
        try {
          data = JSON.parse(text);
        } catch {
          data = { content: text };
        }
    }

    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  }

  private async convertToHTML(
    inputFormat: FileFormat,
    inputBlob: Blob,
    config: ConversionConfig,
    signal: AbortSignal
  ): Promise<Blob> {
    if (inputFormat === FileFormat.TXT) {
      const text = await inputBlob.text();
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Converted Document</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
    pre { white-space: pre-wrap; word-wrap: break-word; }
  </style>
</head>
<body>
  <pre>${this.escapeHtml(text)}</pre>
</body>
</html>`;
      return new Blob([html], { type: 'text/html' });
    }

    throw new Error(`Cannot convert ${inputFormat} to HTML`);
  }

  private async convertToImage(
    inputBlob: Blob,
    outputFormat: 'image/png' | 'image/jpeg' | 'image/webp',
    config: ConversionConfig
  ): Promise<Blob> {
    const imageData = await this.imageProcessor.loadImageFromBlob(inputBlob);
    return this.imageProcessor.imageDataToBlob(imageData, outputFormat, (config.quality || 92) / 100);
  }

  private isImageFormat(format: FileFormat): boolean {
    return [
      FileFormat.PNG,
      FileFormat.JPEG,
      FileFormat.TIFF,
      FileFormat.BMP,
      FileFormat.WEBP,
      FileFormat.GIF,
    ].includes(format);
  }

  private needsOCR(inputFormat: FileFormat, targetFormat: ConversionTarget): boolean {
    // Needs OCR if converting from image to text-based format
    return this.isImageFormat(inputFormat) && 
      [ConversionTarget.TXT, ConversionTarget.DOCX, ConversionTarget.JSON, ConversionTarget.HTML].includes(targetFormat);
  }

  private async handleConversionError(job: ConversionJob, error: Error): Promise<void> {
    const conversionError: ConversionError = {
      code: 'CONVERSION_ERROR',
      message: error.message,
      stack: error.stack,
      recoverable: false,
      retryCount: 0,
      maxRetries: 3,
    };

    job.status = ProcessingStatus.ERROR;
    job.error = conversionError;
    job.metrics.errors = job.metrics.errors || [];
    job.metrics.errors.push(error.message);
    
    this.updateProgress(job);
  }

  private updateProgress(job: ConversionJob): void {
    const callback = this.onProgressCallbacks.get(job.id);
    if (callback) {
      callback({ ...job });
    }
  }

  abortJob(jobId: string): void {
    const controller = this.abortControllers.get(jobId);
    if (controller) {
      controller.abort();
    }
  }

  getJob(jobId: string): ConversionJob | undefined {
    return this.activeJobs.get(jobId);
  }

  getAllJobs(): ConversionJob[] {
    return Array.from(this.activeJobs.values());
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
