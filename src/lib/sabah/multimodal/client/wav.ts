export const TARGET_SAMPLE_RATE = 16_000;
export const MAX_CHUNK_MS = 30_000;
export const MAX_OVERLAP_MS = 5_000;

export type PcmChunk = { readonly index: number; readonly startMs: number; readonly endMs: number; readonly overlapSamples: number; readonly samples: Float32Array };
export type ChunkOptions = { readonly sampleRate: number; readonly chunkMs?: number; readonly overlapMs?: number };

function assertRate(rate: number): void { if (!Number.isInteger(rate) || rate <= 0 || rate > 192_000) throw new Error("Invalid audio sample rate"); }
function clampSample(value: number): number { return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0)); }

export function resampleFloatPcm(input: Float32Array, sourceRate: number, targetRate = TARGET_SAMPLE_RATE): Float32Array {
  assertRate(sourceRate); assertRate(targetRate);
  if (input.length === 0 || sourceRate === targetRate) return new Float32Array(input);
  const outputLength = Math.max(1, Math.round((input.length - 1) * targetRate / sourceRate) + 1);
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * (input.length - 1) / Math.max(1, outputLength - 1);
    const left = Math.floor(position); const right = Math.min(input.length - 1, left + 1); const fraction = position - left;
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

export function chunkPcm(samples: Float32Array, options: ChunkOptions): PcmChunk[] {
  assertRate(options.sampleRate);
  const chunkMs = options.chunkMs ?? 10_000; const overlapMs = options.overlapMs ?? 500;
  if (!Number.isInteger(chunkMs) || chunkMs <= 0 || chunkMs > MAX_CHUNK_MS || !Number.isInteger(overlapMs) || overlapMs < 0 || overlapMs >= chunkMs || overlapMs > MAX_OVERLAP_MS) throw new Error("Invalid bounded audio chunk settings");
  const size = Math.max(1, Math.round(options.sampleRate * chunkMs / 1000)); const overlap = Math.round(options.sampleRate * overlapMs / 1000); const step = size - overlap;
  const result: PcmChunk[] = [];
  for (let start = 0, index = 0; start < samples.length; start += step, index += 1) {
    const end = Math.min(samples.length, start + size);
    result.push({ index, startMs: Math.round(start * 1000 / options.sampleRate), endMs: Math.round(end * 1000 / options.sampleRate), overlapSamples: index === 0 ? 0 : overlap, samples: samples.slice(start, end) });
  }
  return result;
}

function writeAscii(view: DataView, offset: number, value: string): void { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); }
export function encodeWavPcm16(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): ArrayBuffer {
  assertRate(sampleRate); const dataBytes = samples.length * 2; const buffer = new ArrayBuffer(44 + dataBytes); const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF"); view.setUint32(4, 36 + dataBytes, true); writeAscii(view, 8, "WAVE"); writeAscii(view, 12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeAscii(view, 36, "data"); view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i += 1) { const value = clampSample(samples[i]); view.setInt16(44 + i * 2, value < 0 ? Math.round(value * 32768) : Math.round(value * 32767), true); }
  return buffer;
}
