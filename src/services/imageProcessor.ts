export interface PerspectiveTransform {
  a: number; b: number; c: number;
  d: number; e: number; f: number;
  g: number; h: number;
}

export interface DeskewMatrix {
  angle: number;        // in degrees
  rotationMatrix: DOMMatrix;
  shearX: number;
  shearY: number;
}

export interface BinarizationConfig {
  method: 'otsu' | 'adaptive-mean' | 'adaptive-gaussian';
  blockSize?: number;     // odd number, default 11
  C?: number;            // constant subtracted, default 2
  threshold?: number;    // 0-255 for global thresholding
  invertColors?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export class ImageProcessor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private worker: Worker | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { 
      willReadFrequently: true,
      alpha: true 
    })!;
  }

  /**
   * Calculate 3D perspective transformation matrix from 4 source points to 4 destination points
   * Uses Direct Linear Transform (DLT) algorithm
   */
  calculatePerspectiveTransform(
    srcPoints: [Point, Point, Point, Point],
    dstPoints: [Point, Point, Point, Point]
  ): PerspectiveTransform {
    const matrix = this.solveDLT(srcPoints, dstPoints);
    return {
      a: matrix[0], b: matrix[1], c: matrix[2],
      d: matrix[3], e: matrix[4], f: matrix[5],
      g: matrix[6], h: matrix[7],
    };
  }

  /**
   * Apply perspective transformation to image using calculated matrix
   */
  async applyPerspectiveTransform(
    imageSource: ImageData | HTMLImageElement,
    transform: PerspectiveTransform,
    outputWidth: number,
    outputHeight: number
  ): Promise<ImageData> {
    // Load image if HTMLImageElement provided
    let sourceData: ImageData;
    if (imageSource instanceof HTMLImageElement) {
      this.canvas.width = imageSource.width;
      this.canvas.height = imageSource.height;
      this.ctx.drawImage(imageSource, 0, 0);
      sourceData = this.ctx.getImageData(0, 0, imageSource.width, imageSource.height);
    } else {
      sourceData = imageSource;
    }

    // Create output canvas
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = outputWidth;
    outputCanvas.height = outputHeight;
    const outputCtx = outputCanvas.getContext('2d')!;

    // Apply transformation using inverse mapping
    const outputData = outputCtx.createImageData(outputWidth, outputHeight);
    const srcWidth = sourceData.width;
    const srcHeight = sourceData.height;

    for (let y = 0; y < outputHeight; y++) {
      for (let x = 0; x < outputWidth; x++) {
        // Calculate inverse perspective projection
        const denominator = transform.g * x + transform.h * y + 1;
        const srcX = (transform.a * x + transform.b * y + transform.c) / denominator;
        const srcY = (transform.d * x + transform.e * y + transform.f) / denominator;

        // Bilinear interpolation
        if (srcX >= 0 && srcX < srcWidth - 1 && srcY >= 0 && srcY < srcHeight - 1) {
          const pixel = this.bilinearInterpolate(sourceData, srcX, srcY, srcWidth);
          const index = (y * outputWidth + x) * 4;
          outputData.data[index] = pixel.r;
          outputData.data[index + 1] = pixel.g;
          outputData.data[index + 2] = pixel.b;
          outputData.data[index + 3] = pixel.a;
        }
      }
    }

    return outputData;
  }

  /**
   * Detect skew angle using Hough Transform or Projection Profile method
   */
  async detectSkew(imageData: ImageData, method: 'hough' | 'projection' = 'projection'): Promise<DeskewMatrix> {
    const grayImage = this.convertToGrayscale(imageData);
    
    let angle: number;
    if (method === 'projection') {
      angle = this.detectSkewByProjection(grayImage);
    } else {
      angle = await this.detectSkewByHough(grayImage);
    }

    return this.calculateDeskewMatrix(angle);
  }

  /**
   * Deskew image using calculated rotation matrix
   */
  async deskewImage(imageData: ImageData, deskewMatrix: DeskewMatrix): Promise<ImageData> {
    const { angle, rotationMatrix } = deskewMatrix;
    
    // Calculate new canvas dimensions to fit rotated image
    const radians = (angle * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const newWidth = Math.ceil(imageData.width * cos + imageData.height * sin);
    const newHeight = Math.ceil(imageData.width * sin + imageData.height * cos);

    // Create transformation matrix
    const matrix = new DOMMatrix()
      .translate(newWidth / 2, newHeight / 2)
      .rotate(angle)
      .translate(-imageData.width / 2, -imageData.height / 2);

    // Apply transformation
    this.canvas.width = newWidth;
    this.canvas.height = newHeight;
    this.ctx.clearRect(0, 0, newWidth, newHeight);
    
    // Draw rotated image
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = imageData.width;
    tempCanvas.height = imageData.height;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(imageData, 0, 0);

    this.ctx.setTransform(matrix);
    this.ctx.drawImage(tempCanvas, 0, 0);
    this.ctx.setTransform(new DOMMatrix()); // Reset transform

    return this.ctx.getImageData(0, 0, newWidth, newHeight);
  }

  /**
   * Apply binarization using multiple methods with shadow removal
   */
  async binarize(
    imageData: ImageData,
    config: BinarizationConfig
  ): Promise<ImageData> {
    const grayImage = this.convertToGrayscale(imageData);
    
    switch (config.method) {
      case 'otsu':
        return this.applyOtsuThreshold(grayImage);
      case 'adaptive-mean':
        return this.applyAdaptiveThreshold(
          grayImage,
          config.blockSize || 11,
          config.C || 2,
          'mean'
        );
      case 'adaptive-gaussian':
        return this.applyAdaptiveThreshold(
          grayImage,
          config.blockSize || 11,
          config.C || 2,
          'gaussian'
        );
      default:
        return this.applyOtsuThreshold(grayImage);
    }
  }

  /**
   * Remove shadows using morphological operations and background estimation
   */
  async removeShadows(imageData: ImageData): Promise<ImageData> {
    const grayImage = this.convertToGrayscale(imageData);
    const width = grayImage.width;
    const height = grayImage.height;
    const data = grayImage.data;

    // Step 1: Estimate background using large kernel median filter
    const backgroundKernel = Math.min(width, height) / 30;
    const background = this.medianFilter(grayImage, backgroundKernel);

    // Step 2: Calculate difference image
    const outputData = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
      const diff = background.data[i] - data[i] + 128;
      outputData[i] = outputData[i + 1] = outputData[i + 2] = Math.min(255, Math.max(0, diff));
      outputData[i + 3] = 255;
    }

    return new ImageData(outputData, width, height);
  }

  /**
   * Complete preprocessing pipeline for document enhancement
   */
  async preprocessDocument(
    imageData: ImageData,
    options: {
      removeShadows?: boolean;
      deskew?: boolean;
      binarize?: boolean;
      binarizationConfig?: BinarizationConfig;
      perspectivePoints?: {
        src: [Point, Point, Point, Point];
        dst: [Point, Point, Point, Point];
      };
    } = {}
  ): Promise<ImageData> {
    let processed = imageData;

    // Apply perspective correction if points provided
    if (options.perspectivePoints) {
      const transform = this.calculatePerspectiveTransform(
        options.perspectivePoints.src,
        options.perspectivePoints.dst
      );
      processed = await this.applyPerspectiveTransform(
        processed,
        transform,
        imageData.width,
        imageData.height
      );
    }

    // Remove shadows
    if (options.removeShadows) {
      processed = await this.removeShadows(processed);
    }

    // Deskew
    if (options.deskew) {
      const skewMatrix = await this.detectSkew(processed);
      processed = await this.deskewImage(processed, skewMatrix);
    }

    // Binarize
    if (options.binarize) {
      const binarizeConfig = options.binarizationConfig || {
        method: 'adaptive-gaussian',
        blockSize: 11,
        C: 2,
      };
      processed = await this.binarize(processed, binarizeConfig);
    }

    return processed;
  }

  // Private helper methods
  private solveDLT(
    src: [Point, Point, Point, Point],
    dst: [Point, Point, Point, Point]
  ): number[] {
    const A: number[][] = [];
    
    for (let i = 0; i < 4; i++) {
      const X = src[i].x;
      const Y = src[i].y;
      const x = dst[i].x;
      const y = dst[i].y;

      A.push([X, Y, 1, 0, 0, 0, -x * X, -x * Y, -x]);
      A.push([0, 0, 0, X, Y, 1, -y * X, -y * Y, -y]);
    }

    // SVD decomposition (simplified for 9x9 matrix)
    const solution = this.solveLinearSystem(A);
    return solution;
  }

  private solveLinearSystem(A: number[][]): number[] {
    // Gaussian elimination with partial pivoting
    const n = A.length;
    const augmented = A.map(row => [...row]);
    const m = augmented[0].length;

    for (let i = 0; i < n; i++) {
      // Find pivot
      let maxEl = Math.abs(augmented[i][i]);
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(augmented[k][i]) > maxEl) {
          maxEl = Math.abs(augmented[k][i]);
          maxRow = k;
        }
      }

      // Swap rows
      [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];

      // Eliminate below
      for (let k = i + 1; k < n; k++) {
        const c = -augmented[k][i] / augmented[i][i];
        for (let j = i; j < m; j++) {
          if (i === j) {
            augmented[k][j] = 0;
          } else {
            augmented[k][j] += c * augmented[i][j];
          }
        }
      }
    }

    // Back substitution
    const solution = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      solution[i] = augmented[i][m - 1] / augmented[i][i];
      for (let k = i - 1; k >= 0; k--) {
        augmented[k][m - 1] -= augmented[k][i] * solution[i];
      }
    }

    return solution;
  }

  private bilinearInterpolate(
    imageData: ImageData,
    x: number,
    y: number,
    width: number
  ): { r: number; g: number; b: number; a: number } {
    const x1 = Math.floor(x);
    const y1 = Math.floor(y);
    const x2 = Math.min(x1 + 1, width - 1);
    const y2 = Math.min(y1 + 1, imageData.height - 1);

    const fx = x - x1;
    const fy = y - y1;

    const p11 = this.getPixel(imageData, x1, y1, width);
    const p12 = this.getPixel(imageData, x1, y2, width);
    const p21 = this.getPixel(imageData, x2, y1, width);
    const p22 = this.getPixel(imageData, x2, y2, width);

    return {
      r: this.lerp(this.lerp(p11.r, p21.r, fx), this.lerp(p12.r, p22.r, fx), fy),
      g: this.lerp(this.lerp(p11.g, p21.g, fx), this.lerp(p12.g, p22.g, fx), fy),
      b: this.lerp(this.lerp(p11.b, p21.b, fx), this.lerp(p12.b, p22.b, fx), fy),
      a: this.lerp(this.lerp(p11.a, p21.a, fx), this.lerp(p12.a, p22.a, fx), fy),
    };
  }

  private getPixel(imageData: ImageData, x: number, y: number, width: number) {
    const index = (y * width + x) * 4;
    return {
      r: imageData.data[index],
      g: imageData.data[index + 1],
      b: imageData.data[index + 2],
      a: imageData.data[index + 3],
    };
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private detectSkewByProjection(grayImage: ImageData): number {
    const angles = Array.from({ length: 181 }, (_, i) => i - 90);
    let maxVariance = 0;
    let bestAngle = 0;

    for (const angle of angles) {
      const projection = this.calculateProjectionProfile(grayImage, angle);
      const variance = this.calculateVariance(projection);
      if (variance > maxVariance) {
        maxVariance = variance;
        bestAngle = angle;
      }
    }

    return bestAngle;
  }

  private calculateProjectionProfile(imageData: ImageData, angle: number): number[] {
    const radians = (angle * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const width = imageData.width;
    const height = imageData.height;
    
    const profile: number[] = [];
    const steps = Math.ceil(Math.sqrt(width * width + height * height));
    
    for (let i = 0; i < steps; i++) {
      let sum = 0;
      let count = 0;
      
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const projection = x * cos + y * sin;
          if (Math.abs(projection - i) < 0.5) {
            const index = (y * width + x) * 4;
            sum += imageData.data[index];
            count++;
          }
        }
      }
      
      profile.push(count > 0 ? sum / count : 0);
    }
    
    return profile;
  }

  private calculateVariance(array: number[]): number {
    const mean = array.reduce((a, b) => a + b, 0) / array.length;
    return array.reduce((acc, val) => acc + (val - mean) ** 2, 0) / array.length;
  }

  private async detectSkewByHough(imageData: ImageData): Promise<number> {
    // Simplified Hough transform implementation
    const edgeImage = this.detectEdges(imageData);
    const width = edgeImage.width;
    const height = edgeImage.height;
    const diagonal = Math.sqrt(width * width + height * height);
    
    const thetaSteps = 180;
    const rhoSteps = Math.ceil(diagonal * 2);
    const accumulator = new Array(thetaSteps * rhoSteps).fill(0);
    
    // Vote in accumulator
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        if (edgeImage.data[index] > 128) {
          for (let theta = 0; theta < thetaSteps; theta++) {
            const thetaRad = (theta * Math.PI) / 180;
            const rho = x * Math.cos(thetaRad) + y * Math.sin(thetaRad);
            const rhoIndex = Math.floor(rho + diagonal);
            if (rhoIndex >= 0 && rhoIndex < rhoSteps) {
              accumulator[theta * rhoSteps + rhoIndex]++;
            }
          }
        }
      }
    }
    
    // Find dominant angle
    let maxVotes = 0;
    let dominantTheta = 0;
    
    for (let theta = 0; theta < thetaSteps; theta++) {
      let totalVotes = 0;
      for (let rho = 0; rho < rhoSteps; rho++) {
        totalVotes += accumulator[theta * rhoSteps + rho];
      }
      if (totalVotes > maxVotes) {
        maxVotes = totalVotes;
        dominantTheta = theta;
      }
    }
    
    return 90 - dominantTheta; // Convert to skew angle
  }

  private detectEdges(imageData: ImageData): ImageData {
    const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    
    const width = imageData.width;
    const height = imageData.height;
    const output = new Uint8ClampedArray(imageData.data.length);
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let gx = 0, gy = 0;
        
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4;
            const gray = imageData.data[idx];
            gx += gray * sobelX[(ky + 1) * 3 + (kx + 1)];
            gy += gray * sobelY[(ky + 1) * 3 + (kx + 1)];
          }
        }
        
        const magnitude = Math.sqrt(gx * gx + gy * gy);
        const idx = (y * width + x) * 4;
        const val = Math.min(255, magnitude);
        output[idx] = output[idx + 1] = output[idx + 2] = val;
        output[idx + 3] = 255;
      }
    }
    
    return new ImageData(output, width, height);
  }

  private calculateDeskewMatrix(angle: number): DeskewMatrix {
    const radians = (angle * Math.PI) / 180;
    const rotationMatrix = new DOMMatrix()
      .rotate(0, 0, angle);

    return {
      angle,
      rotationMatrix,
      shearX: Math.tan(radians),
      shearY: 0,
    };
  }

  private convertToGrayscale(imageData: ImageData): ImageData {
    const data = imageData.data;
    const grayData = new Uint8ClampedArray(data.length);
    
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      grayData[i] = grayData[i + 1] = grayData[i + 2] = gray;
      grayData[i + 3] = data[i + 3];
    }
    
    return new ImageData(grayData, imageData.width, imageData.height);
  }

  private applyOtsuThreshold(grayImage: ImageData): ImageData {
    const histogram = new Array(256).fill(0);
    const data = grayImage.data;
    
    // Calculate histogram
    for (let i = 0; i < data.length; i += 4) {
      histogram[data[i]]++;
    }
    
    // Find optimal threshold
    const total = grayImage.width * grayImage.height;
    let sum = 0;
    for (let i = 0; i < 256; i++) {
      sum += i * histogram[i];
    }
    
    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let maxVariance = 0;
    let threshold = 0;
    
    for (let t = 0; t < 256; t++) {
      wB += histogram[t];
      if (wB === 0) continue;
      
      wF = total - wB;
      if (wF === 0) break;
      
      sumB += t * histogram[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      
      const variance = wB * wF * (mB - mF) ** 2;
      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = t;
      }
    }
    
    // Apply threshold
    const outputData = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
      const value = data[i] > threshold ? 255 : 0;
      outputData[i] = outputData[i + 1] = outputData[i + 2] = value;
      outputData[i + 3] = 255;
    }
    
    return new ImageData(outputData, grayImage.width, grayImage.height);
  }

  private applyAdaptiveThreshold(
    grayImage: ImageData,
    blockSize: number,
    C: number,
    method: 'mean' | 'gaussian'
  ): ImageData {
    const width = grayImage.width;
    const height = grayImage.height;
    const data = grayImage.data;
    const outputData = new Uint8ClampedArray(data.length);
    const halfBlock = Math.floor(blockSize / 2);
    
    // Generate Gaussian kernel if method is gaussian
    const kernel = method === 'gaussian' ? this.generateGaussianKernel(blockSize) : null;
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let threshold = 0;
        let totalWeight = 0;
        
        for (let ky = -halfBlock; ky <= halfBlock; ky++) {
          for (let kx = -halfBlock; kx <= halfBlock; kx++) {
            const ny = Math.min(Math.max(y + ky, 0), height - 1);
            const nx = Math.min(Math.max(x + kx, 0), width - 1);
            const idx = (ny * width + nx) * 4;
            
            const weight = kernel ? kernel[ky + halfBlock][kx + halfBlock] : 1;
            threshold += data[idx] * weight;
            totalWeight += weight;
          }
        }
        
        threshold /= totalWeight;
        const idx = (y * width + x) * 4;
        const value = data[idx] > threshold - C ? 255 : 0;
        outputData[idx] = outputData[idx + 1] = outputData[idx + 2] = value;
        outputData[idx + 3] = 255;
      }
    }
    
    return new ImageData(outputData, width, height);
  }

  private generateGaussianKernel(size: number): number[][] {
    const kernel: number[][] = [];
    const sigma = size / 6;
    const center = Math.floor(size / 2);
    
    for (let i = 0; i < size; i++) {
      kernel[i] = [];
      for (let j = 0; j < size; j++) {
        const x = i - center;
        const y = j - center;
        kernel[i][j] = Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
      }
    }
    
    return kernel;
  }

  private medianFilter(imageData: ImageData, kernelSize: number): ImageData {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const outputData = new Uint8ClampedArray(data.length);
    const halfKernel = Math.floor(kernelSize / 2);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const neighborhood: number[] = [];
        
        for (let ky = -halfKernel; ky <= halfKernel; ky++) {
          for (let kx = -halfKernel; kx <= halfKernel; kx++) {
            const ny = Math.min(Math.max(y + ky, 0), height - 1);
            const nx = Math.min(Math.max(x + kx, 0), width - 1);
            const idx = (ny * width + nx) * 4;
            neighborhood.push(data[idx]);
          }
        }
        
        neighborhood.sort((a, b) => a - b);
        const median = neighborhood[Math.floor(neighborhood.length / 2)];
        const idx = (y * width + x) * 4;
        outputData[idx] = outputData[idx + 1] = outputData[idx + 2] = median;
        outputData[idx + 3] = 255;
      }
    }
    
    return new ImageData(outputData, width, height);
  }

  async loadImageFromBlob(blob: Blob): Promise<ImageData> {
    const img = await this.loadImage(URL.createObjectURL(blob));
    this.canvas.width = img.width;
    this.canvas.height = img.height;
    this.ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(img.src);
    return this.ctx.getImageData(0, 0, img.width, img.height);
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  async imageDataToBlob(imageData: ImageData, format: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png', quality = 0.92): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(imageData, 0, 0);
    
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create blob'));
        },
        format,
        quality
      );
    });
  }
}
