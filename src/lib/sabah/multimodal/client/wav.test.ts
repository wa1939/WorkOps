import { describe, expect, it } from "vitest";
import { chunkPcm, encodeWavPcm16, resampleFloatPcm } from "./wav";

describe("bounded PCM/WAV contracts", () => {
  it("resamples deterministically to mono 16 kHz with endpoint preservation", () => {
    const output = resampleFloatPcm(new Float32Array([0, 1, 0]), 8, 16);
    expect(Array.from(output)).toEqual([0, 0.5, 1, 0.5, 0]);
  });

  it("chunks PCM with explicit bounded overlap and timestamps", () => {
    const chunks = chunkPcm(new Float32Array(16_000), { sampleRate: 16_000, chunkMs: 500, overlapMs: 100 });
    expect(chunks.map((chunk) => [chunk.startMs, chunk.endMs, chunk.overlapSamples])).toEqual([[0, 500, 0], [400, 900, 1600], [800, 1000, 1600]]);
    expect(chunks.every((chunk) => chunk.samples.length <= 8_000)).toBe(true);
  });

  it("writes a valid PCM16 RIFF/WAV header and exact data sizes", () => {
    const wav = new Uint8Array(encodeWavPcm16(new Float32Array([-1, 0, 1]), 16_000));
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(new DataView(wav.buffer).getUint32(4, true)).toBe(wav.byteLength - 8);
    expect(new DataView(wav.buffer).getUint32(40, true)).toBe(6);
    expect(Array.from(new Int16Array(wav.buffer, 44))).toEqual([-32768, 0, 32767]);
  });
});
