# ASR engine decision (Plan 7 Task 5)

## Decision

The intended primary engine contract remains **whisper.cpp** running locally in a worker with verified WASM and multilingual model assets. This change implements only the bounded, schema-independent boundary: explicit microphone ownership, deterministic 16 kHz mono PCM conversion, bounded overlapping chunks, typed worker messages, timestamped segments, cancellation/disposal, and vocabulary-correction provenance.

No engine binary, model URL, checksum, license record, or benchmark result is included. The existing fail-closed model manifest remains authoritative. Missing entries produce `MODEL_MANIFEST_UNAVAILABLE`; an injected or runtime engine failure produces `ASR_ENGINE_UNAVAILABLE`. There is no automatic cloud fallback and no automatic send.

## Vosk comparison

**NOT RUN.** An approved Arabic corpus, controlled device matrix, and approved whisper.cpp/Vosk assets are not present. It would be misleading to report cold-load, steady-state, memory, WER, or names-accuracy numbers without those inputs.

The fixed future decision rule is: keep whisper.cpp primary; enable Vosk only if the same approved corpus/device matrix shows noisy WER at or below the Plan threshold, names/aliases accuracy at or above the Plan threshold, and compliance with its declared memory budget. The Plan thresholds are the acceptance criteria; this document does not invent measurements.

## Exact inputs required for the future spike

- versioned, non-sensitive approved Arabic corpus with quiet and noisy subsets;
- fixed transcript normalization and WER/names-alias scoring scripts;
- identical device/browser matrix and capture settings;
- pinned whisper.cpp WASM/runtime and multilingual model assets with URL, byte count, SHA-256, version, and license;
- pinned Vosk runtime and Arabic model with the same manifest fields;
- declared memory budget and reproducible cold-load, steady-state, and peak-memory harness;
- recorded engine versions, browser versions, OS versions, and raw run artifacts.

Until those inputs are approved and measured, this repository intentionally exposes contracts and test fixtures only; it does not claim production transcription capability.
