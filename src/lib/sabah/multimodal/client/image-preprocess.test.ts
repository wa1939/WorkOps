import { describe, expect, it } from "vitest";
import { preprocessImage, IMAGE_MAX_MEGAPIXELS, IMAGE_MAX_DIMENSION } from "./image-preprocess";

type FakeImageData = {
  readonly data: Uint8ClampedArray<ArrayBufferLike>;
  readonly width: number;
  readonly height: number;
};

type FakeContext = {
  drawImage: (...args: unknown[]) => void;
  setTransform: (...args: number[]) => void;
  filter: string;
  getImageData: (x: number, y: number, width: number, height: number) => FakeImageData;
  putImageData: (imageData: FakeImageData, x: number, y: number) => void;
};

function fakeCanvas(pixelValues: number[] = []) {
  const calls: string[] = [];
  const drawImageCalls: unknown[][] = [];
  let pixels: Uint8ClampedArray<ArrayBufferLike> = new Uint8ClampedArray(pixelValues);
  const context: FakeContext = {
    drawImage: (...args) => { drawImageCalls.push(args); calls.push("draw"); },
    setTransform: (...args) => { calls.push(`transform:${args.join(",")}`); },
    filter: "none",
    getImageData: (_x, _y, width, height) => ({ data: pixels, width, height }),
    putImageData: (imageData) => { pixels = imageData.data; calls.push("put-pixels"); },
  };
  return {
    calls,
    drawImageCalls,
    get pixels() { return pixels; },
    factory: { create: () => ({ width: 0, height: 0, context }) },
  };
}

describe("preprocessImage", () => {
  it("applies EXIF orientation without mutating source and bounds megapixels", () => {
    const source = { width: 10_000, height: 5_000 };
    const before = { ...source };
    const fake = fakeCanvas();
    const result = preprocessImage(source, { orientation: 6, grayscale: true }, fake.factory);

    expect(source).toEqual(before);
    expect(result.width).toBeLessThanOrEqual(IMAGE_MAX_DIMENSION);
    expect(result.height).toBeLessThanOrEqual(IMAGE_MAX_DIMENSION);
    expect(result.width * result.height).toBeLessThanOrEqual(IMAGE_MAX_MEGAPIXELS * 1_000_000);
    expect(result.orientation).toBe(6);
    expect(fake.calls).toContain(`transform:0,1,-1,0,${result.width},0`);
  });

  it("draws a swapped source rectangle fully into the rotated destination", () => {
    const fake = fakeCanvas();

    preprocessImage({ width: 4, height: 3 }, { orientation: 6 }, fake.factory);

    expect(fake.drawImageCalls).toEqual([[{ width: 4, height: 3 }, 0, 0, 4, 3]]);
  });

  it.each([
    [1, "1,0,0,1,0,0"],
    [2, "-1,0,0,1,4,0"],
    [3, "-1,0,0,-1,4,3"],
    [4, "1,0,0,-1,0,3"],
    [5, "0,1,1,0,0,0"],
    [6, "0,1,-1,0,3,0"],
    [7, "0,-1,-1,0,3,4"],
    [8, "0,-1,1,0,0,4"],
  ])("maps EXIF orientation %i onto canvas coordinates", (orientation, transform) => {
    const fake = fakeCanvas();
    preprocessImage({ width: 4, height: 3 }, { orientation }, fake.factory);

    expect(fake.calls).toContain(`transform:${transform}`);
  });

  it("performs adaptive thresholding on pixels rather than only reporting metadata", () => {
    const fake = fakeCanvas([
      20, 20, 20, 255, 20, 20, 20, 255, 20, 20, 20, 255,
      20, 20, 20, 255, 240, 240, 240, 255, 20, 20, 20, 255,
      20, 20, 20, 255, 20, 20, 20, 255, 20, 20, 20, 255,
    ]);
    const before = Array.from(fake.pixels);
    const result = preprocessImage({ width: 3, height: 3 }, { adaptiveThreshold: true }, fake.factory);

    expect(result.filters.adaptiveThreshold).toBe(true);
    expect(fake.calls).toContain("put-pixels");
    expect(Array.from(fake.pixels)).not.toEqual(before);
    expect(fake.pixels[3]).toBe(255);
  });

  it("fails closed when adaptive threshold pixel APIs are unavailable", () => {
    const context = {
      drawImage: () => undefined,
      setTransform: () => undefined,
      filter: "none",
    };
    const factory = { create: () => ({ width: 0, height: 0, context }) };

    expect(() => preprocessImage({ width: 3, height: 3 }, { adaptiveThreshold: true }, factory)).toThrow(/pixel/i);
  });

  it("keeps threshold and deskew bounded and reports applied filters", () => {
    const fake = fakeCanvas();
    const result = preprocessImage({ width: 800, height: 600 }, {
      contrast: 1.5,
      adaptiveThreshold: false,
      deskewDegrees: 3,
    }, fake.factory);

    expect(result.filters).toEqual({ grayscale: false, contrast: 1.5, adaptiveThreshold: false, deskewDegrees: 3 });
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it("rejects unsafe dimensions and unsupported orientation metadata", () => {
    const fake = fakeCanvas();
    expect(() => preprocessImage({ width: 0, height: 10 }, {}, fake.factory)).toThrow(/dimensions/i);
    expect(() => preprocessImage({ width: 10, height: 10 }, { orientation: 9 }, fake.factory)).toThrow(/orientation/i);
  });
});
