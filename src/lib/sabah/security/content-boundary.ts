export const UNTRUSTED_SOURCES = [
  "document", "ocr", "screenshot", "note", "comment", "formula", "webhook", "playbook", "memory",
] as const;
export type UntrustedSource = (typeof UNTRUSTED_SOURCES)[number];
export const MAX_UNTRUSTED_CONTENT_CHARS = 4_000;

export type UntrustedContent = {
  readonly source: UntrustedSource;
  readonly content: string;
  readonly trusted: false;
  readonly instructionAuthority: "data";
  readonly fencing: "source-fenced";
};

function serialize(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? String(value) : encoded;
  } catch {
    return "[UNTRUSTED_CONTENT_UNSERIALIZABLE]";
  }
}

/** Converts external content into explicitly non-authoritative, source-fenced data. */
export function wrapUntrustedContent(value: unknown, source: UntrustedSource): UntrustedContent {
  if (!UNTRUSTED_SOURCES.includes(source)) throw new Error("Unsupported untrusted content source");
  const content = serialize(value);
  return Object.freeze({
    source,
    content: content.slice(0, MAX_UNTRUSTED_CONTENT_CHARS),
    trusted: false,
    instructionAuthority: "data",
    fencing: "source-fenced",
  });
}
