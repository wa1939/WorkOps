export const INSPECTION_CODES = [
  "MIME_MISMATCH", "UNSUPPORTED_TYPE", "EXECUTABLE", "POLYGLOT", "OVERSIZE",
  "DIMENSIONS_EXCEEDED", "PAGES_EXCEEDED", "AUDIO_DURATION_EXCEEDED", "MACRO_FORMAT",
  "DANGEROUS_PDF", "FORMULA_PRESENT", "METADATA_REQUIRED", "CONTENT_UNVERIFIABLE", "INVALID_FILE",
] as const;
export type InspectionCode = (typeof INSPECTION_CODES)[number];
export type InspectionLimits = {
  maxBytes?: number; maxWidth?: number; maxHeight?: number; maxPages?: number; maxAudioDurationMs?: number;
};
export type AssetInspectionInput = { bytes: Uint8Array; filename: string; mimeType: string; width?: number; height?: number; pageCount?: number; audioDurationMs?: number };
export type AssetKind = "pdf" | "png" | "jpeg" | "gif" | "webp" | "wav" | "mp3" | "ogg" | "docx" | "xlsx" | "pptx";
export type AssetInspection = { ok: true; kind: AssetKind; byteCount: number } | { ok: false; code: InspectionCode };

const defaults: Required<InspectionLimits> = { maxBytes: 50_000_000, maxWidth: 20_000, maxHeight: 20_000, maxPages: 1_000, maxAudioDurationMs: 3_600_000 };
const types: Record<string, { kind: AssetKind; extensions: string[]; magic: (b: Uint8Array) => boolean }> = {
  "application/pdf": { kind: "pdf", extensions: ["pdf"], magic: b => text(b).startsWith("%PDF-") },
  "image/png": { kind: "png", extensions: ["png"], magic: b => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  "image/jpeg": { kind: "jpeg", extensions: ["jpg", "jpeg"], magic: b => starts(b, [0xff, 0xd8, 0xff]) },
  "image/gif": { kind: "gif", extensions: ["gif"], magic: b => text(b.slice(0, 6)) === "GIF87a" || text(b.slice(0, 6)) === "GIF89a" },
  "image/webp": { kind: "webp", extensions: ["webp"], magic: b => text(b.slice(0, 4)) === "RIFF" && text(b.slice(8, 12)) === "WEBP" },
  "audio/wav": { kind: "wav", extensions: ["wav"], magic: b => text(b.slice(0, 4)) === "RIFF" && text(b.slice(8, 12)) === "WAVE" },
  "audio/mpeg": { kind: "mp3", extensions: ["mp3"], magic: b => text(b.slice(0, 3)) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  "audio/ogg": { kind: "ogg", extensions: ["ogg"], magic: b => text(b.slice(0, 4)) === "OggS" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { kind: "docx", extensions: ["docx"], magic: zipMagic },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { kind: "xlsx", extensions: ["xlsx"], magic: zipMagic },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { kind: "pptx", extensions: ["pptx"], magic: zipMagic },
};
function text(b: Uint8Array): string { return new TextDecoder().decode(b); }
function starts(b: Uint8Array, sig: number[]): boolean { return sig.every((v, i) => b[i] === v); }
function zipMagic(b: Uint8Array): boolean { return starts(b, [0x50, 0x4b, 0x03, 0x04]); }
function ext(filename: string): string { return filename.toLowerCase().split(".").pop() ?? ""; }
function rejected(code: InspectionCode): AssetInspection { return { ok: false, code }; }
function formulaPresent(content: string, officeZip: boolean): boolean {
  return /(?:^|[,;\t\r\n])\s*=[^\r\n]*/m.test(content)
    || (officeZip && /<(?:[a-zA-Z0-9_.-]+:)?f(?:\s[^>]*)?>/i.test(content));
}
function officeZipUnverifiable(bytes: Uint8Array): boolean {
  let offset = 0;
  let entries = 0;
  while (offset + 4 <= bytes.length && bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x03 && bytes[offset + 3] === 0x04) {
    if (offset + 30 > bytes.length) return true;
    const flags = bytes[offset + 6] | (bytes[offset + 7] << 8);
    if ((flags & 0x08) !== 0) return true;
    const method = bytes[offset + 8] | (bytes[offset + 9] << 8);
    if (method !== 0) return true;
    const nameLength = bytes[offset + 26] | (bytes[offset + 27] << 8);
    const extraLength = bytes[offset + 28] | (bytes[offset + 29] << 8);
    const compressedSize = bytes[offset + 18] | (bytes[offset + 19] << 8) | (bytes[offset + 20] << 16) | (bytes[offset + 21] << 24);
    const next = offset + 30 + nameLength + extraLength + compressedSize;
    if (next > bytes.length || next <= offset) return true;
    offset = next;
    entries += 1;
  }
  const eocdSignature = [0x50, 0x4b, 0x05, 0x06];
  let eocdOffset = -1;
  for (let i = offset; i + 22 <= bytes.length; i += 1) {
    if (eocdSignature.every((value, index) => bytes[i + index] === value)) {
      eocdOffset = i;
      break;
    }
  }
  const readUint32 = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24);
  const directoryOffset = eocdOffset >= 0 ? readUint32(eocdOffset + 16) : -1;
  const directoryLength = eocdOffset >= 0 ? readUint32(eocdOffset + 12) : -1;
  const commentLength = eocdOffset >= 0 ? bytes[eocdOffset + 20] | (bytes[eocdOffset + 21] << 8) : -1;
  const hasZipDirectory = eocdOffset >= offset
    && directoryOffset >= offset
    && directoryLength >= 0
    && directoryOffset + directoryLength <= eocdOffset
    && eocdOffset + 22 + commentLength <= bytes.length;
  return entries === 0 || !hasZipDirectory;
}

export function inspectAsset(input: AssetInspectionInput, suppliedLimits: InspectionLimits = {}): AssetInspection {
  const limits = { ...defaults, ...suppliedLimits };
  const bytes = input.bytes;
  if (bytes.byteLength > limits.maxBytes) return rejected("OVERSIZE");
  const lower = text(bytes).toLowerCase();
  if (starts(bytes, [0x4d, 0x5a]) || starts(bytes, [0x7f, 0x45, 0x4c, 0x46]) || starts(bytes, [0xca, 0xfe, 0xba, 0xbe]) || lower.startsWith("#!")) return rejected("EXECUTABLE");
  for (let i = 1; i + 1 < bytes.length; i += 1) {
    if (bytes[i] === 0x4d && bytes[i + 1] === 0x5a) return rejected("POLYGLOT");
  }
  if (input.mimeType === "application/vnd.ms-excel" || input.mimeType === "application/msword" || input.mimeType === "application/vnd.ms-powerpoint") return rejected("MACRO_FORMAT");
  const descriptor = types[input.mimeType];
  if (formulaPresent(lower, input.mimeType.includes("openxmlformats-officedocument"))) return rejected("FORMULA_PRESENT");
  if (!descriptor) return rejected("UNSUPPORTED_TYPE");
  if (input.mimeType.includes("spreadsheet") && /(?:vbaProject|macros|xl\/vba)/i.test(text(bytes))) return rejected("MACRO_FORMAT");
  if (descriptor.kind === "docx" || descriptor.kind === "xlsx" || descriptor.kind === "pptx") {
    if (officeZipUnverifiable(bytes)) return rejected("CONTENT_UNVERIFIABLE");
  }
  if (!descriptor.magic(bytes) || !descriptor.extensions.includes(ext(input.filename))) return rejected("MIME_MISMATCH");
  if (input.mimeType === "application/pdf") {
    if (/(?:\/javascript|\/js\b|\/openaction|\/aa\b|\/launch|\/embeddedfile|\/richmedia)/i.test(text(bytes))) return rejected("DANGEROUS_PDF");
    const derivedPages = text(bytes).match(/\/type\s*\/page\b/gi)?.length ?? 0;
    const pageCount = input.pageCount ?? derivedPages;
    if (!Number.isFinite(pageCount)) return rejected("METADATA_REQUIRED");
    if (pageCount > limits.maxPages) return rejected("PAGES_EXCEEDED");
    if (pageCount < 1) return rejected("METADATA_REQUIRED");
    if (text(bytes).includes("MZ\u0000") || text(bytes).includes("PK\u0003\u0004")) return rejected("POLYGLOT");
  }
  if (input.mimeType.includes("spreadsheet") && /(?:vbaProject|macros|xl\/vba)/i.test(text(bytes))) return rejected("MACRO_FORMAT");
  let width = input.width;
  let height = input.height;
  if (input.mimeType === "image/png" && bytes.byteLength >= 24) {
    width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
    height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
  }
  if (descriptor.kind === "png" || descriptor.kind === "jpeg" || descriptor.kind === "gif" || descriptor.kind === "webp") {
    if (width === undefined || height === undefined) return rejected("METADATA_REQUIRED");
    if (width > limits.maxWidth || height > limits.maxHeight) return rejected("DIMENSIONS_EXCEEDED");
  }
  if (descriptor.kind === "wav" || descriptor.kind === "mp3" || descriptor.kind === "ogg") {
    if (input.audioDurationMs === undefined) return rejected("METADATA_REQUIRED");
    if (input.audioDurationMs > limits.maxAudioDurationMs) return rejected("AUDIO_DURATION_EXCEEDED");
  }
  return { ok: true, kind: descriptor.kind, byteCount: bytes.byteLength };
}
