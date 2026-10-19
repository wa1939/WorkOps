export const IMAGE_MAX_DIMENSION = 4096;
export const IMAGE_MAX_MEGAPIXELS = 16;
export const IMAGE_MAX_DESKEW_DEGREES = 8;

type ImageDataLike = {
  readonly data: Uint8ClampedArray<ArrayBufferLike>;
  readonly width: number;
  readonly height: number;
};

export type ImageSource = { readonly width: number; readonly height: number };
export type PreprocessOptions = {
  readonly orientation?: number;
  readonly grayscale?: boolean;
  readonly contrast?: number;
  readonly adaptiveThreshold?: boolean;
  readonly deskewDegrees?: number;
};
export type CanvasContext = {
  filter: string;
  drawImage: (...args: unknown[]) => void;
  setTransform: (...args: number[]) => void;
  getImageData?: (x: number, y: number, width: number, height: number) => ImageDataLike;
  putImageData?: (imageData: ImageDataLike, x: number, y: number) => void;
  translate?: (x: number, y: number) => void;
  rotate?: (radians: number) => void;
};
export type CanvasSurface = { width: number; height: number; context: CanvasContext };
export type CanvasFactory = { create: (width: number, height: number) => CanvasSurface };
export type PreprocessedImage = {
  readonly canvas: CanvasSurface;
  readonly width: number;
  readonly height: number;
  readonly orientation: number;
  readonly filters: {
    readonly grayscale: boolean;
    readonly contrast: number;
    readonly adaptiveThreshold: boolean;
    readonly deskewDegrees: number;
  };
};

const DEFAULT_FACTORY: CanvasFactory = {
  create: (width, height) => {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("2D canvas context unavailable");
      return { width, height, context: context as unknown as CanvasContext };
    }
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("2D canvas context unavailable");
      return { width, height, context: context as unknown as CanvasContext };
    }
    throw new Error("Canvas API unavailable");
  },
};

function boundedDimension(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) throw new Error("invalid image dimensions");
  return value;
}

function orientationTransform(orientation: number, width: number, height: number): number[] {
  switch (orientation) {
    case 1: return [1, 0, 0, 1, 0, 0];
    case 2: return [-1, 0, 0, 1, width, 0];
    case 3: return [-1, 0, 0, -1, width, height];
    case 4: return [1, 0, 0, -1, 0, height];
    case 5: return [0, 1, 1, 0, 0, 0];
    case 6: return [0, 1, -1, 0, width, 0];
    case 7: return [0, -1, -1, 0, width, height];
    case 8: return [0, -1, 1, 0, 0, height];
    default: throw new Error("unsupported EXIF orientation");
  }
}

function applyAdaptiveThreshold(context: CanvasContext, width: number, height: number): void {
  if (!context.getImageData || !context.putImageData) throw new Error("canvas pixel APIs unavailable for adaptive threshold");
  const imageData = context.getImageData(0, 0, width, height);
  const expectedLength = width * height * 4;
  if (imageData.width !== width || imageData.height !== height || imageData.data.length !== expectedLength) {
    throw new Error("invalid canvas pixel buffer");
  }
  const output = new Uint8ClampedArray(imageData.data);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      let count = 0;
      for (let sampleY = Math.max(0, y - 1); sampleY <= Math.min(height - 1, y + 1); sampleY += 1) {
        for (let sampleX = Math.max(0, x - 1); sampleX <= Math.min(width - 1, x + 1); sampleX += 1) {
          const sampleIndex = (sampleY * width + sampleX) * 4;
          total += (imageData.data[sampleIndex] * 299 + imageData.data[sampleIndex + 1] * 587 + imageData.data[sampleIndex + 2] * 114) / 1000;
          count += 1;
        }
      }
      const index = (y * width + x) * 4;
      const luminance = (imageData.data[index] * 299 + imageData.data[index + 1] * 587 + imageData.data[index + 2] * 114) / 1000;
      const thresholded = luminance >= total / count ? 255 : 0;
      output[index] = thresholded;
      output[index + 1] = thresholded;
      output[index + 2] = thresholded;
    }
  }
  context.putImageData({ data: output, width, height }, 0, 0);
}

export function preprocessImage(source: ImageSource, options: PreprocessOptions = {}, factory: CanvasFactory = DEFAULT_FACTORY): PreprocessedImage {
  const sourceWidth = boundedDimension(source.width);
  const sourceHeight = boundedDimension(source.height);
  const orientation = options.orientation ?? 1;
  if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8) throw new Error("unsupported EXIF orientation");
  const contrast = options.contrast ?? 1;
  const deskewDegrees = options.deskewDegrees ?? 0;
  if (!Number.isFinite(contrast) || contrast < 0.5 || contrast > 2) throw new Error("contrast is outside safe bounds");
  if (!Number.isFinite(deskewDegrees) || Math.abs(deskewDegrees) > IMAGE_MAX_DESKEW_DEGREES) throw new Error("deskew is outside safe bounds");

  const rotated = orientation >= 5 && orientation <= 8;
  const orientedWidth = rotated ? sourceHeight : sourceWidth;
  const orientedHeight = rotated ? sourceWidth : sourceHeight;
  const scale = Math.min(1, IMAGE_MAX_DIMENSION / orientedWidth, IMAGE_MAX_DIMENSION / orientedHeight, Math.sqrt((IMAGE_MAX_MEGAPIXELS * 1_000_000) / (orientedWidth * orientedHeight)));
  const width = Math.max(1, Math.floor(orientedWidth * scale));
  const height = Math.max(1, Math.floor(orientedHeight * scale));
  const canvas = factory.create(width, height);
  canvas.width = width;
  canvas.height = height;
  const { context } = canvas;
  context.filter = `grayscale(${options.grayscale ? 1 : 0}) contrast(${contrast})`;
  context.setTransform(...orientationTransform(orientation, width, height));
  if (context.translate && context.rotate && deskewDegrees !== 0) {
    context.translate(width / 2, height / 2);
    context.rotate(deskewDegrees * Math.PI / 180);
    context.translate(-width / 2, -height / 2);
  }
  const drawWidth = rotated ? height : width;
  const drawHeight = rotated ? width : height;
  context.drawImage(source, 0, 0, drawWidth, drawHeight);
  if (options.adaptiveThreshold) applyAdaptiveThreshold(context, width, height);
  return {
    canvas,
    width,
    height,
    orientation,
    filters: { grayscale: options.grayscale ?? false, contrast, adaptiveThreshold: options.adaptiveThreshold ?? false, deskewDegrees },
  };
}
