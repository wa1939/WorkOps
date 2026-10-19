export type AudioWorkletMessage = { readonly type: "pcm"; readonly samples: Float32Array } | { readonly type: "stop" };
export type AudioWorkletPortLike = { postMessage: (message: AudioWorkletMessage, transfer?: Transferable[]) => void };

/** Safe protocol helper; it never opens a microphone or auto-sends audio. */
export function postPcm(port: AudioWorkletPortLike, samples: Float32Array): void {
  if (!(samples instanceof Float32Array) || samples.length === 0) return;
  const copy = new Float32Array(samples);
  port.postMessage({ type: "pcm", samples: copy }, [copy.buffer]);
}

export class BoundedPcmProcessor {
  public readonly port: AudioWorkletPortLike;
  public constructor(port: AudioWorkletPortLike) { this.port = port; }
  public process(input: Float32Array): boolean { postPcm(this.port, input); return true; }
  public stop(): void { this.port.postMessage({ type: "stop" }); }
}

export const SAFE_CAPTURE_PROCESSOR_NAME = "sabah-safe-capture";
