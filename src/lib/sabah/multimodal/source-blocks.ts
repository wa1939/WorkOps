import { z } from "zod";
import { sourceBlockSchema, type SourceBlock } from "./contracts";

/** JSON-safe persisted form: deliberately contains no binary payload or file object. */
export const sourceBlockJsonSchema = sourceBlockSchema;
export type SourceBlockJson = z.infer<typeof sourceBlockJsonSchema>;

export function serializeSourceBlock(block: SourceBlock): SourceBlockJson {
  const parsed = sourceBlockSchema.parse(block);
  return sourceBlockJsonSchema.parse({ ...parsed });
}

export function serializeSourceBlocks(blocks: readonly SourceBlock[]): SourceBlockJson[] {
  if (blocks.length > 100_000) throw new Error("source block batch exceeds bound");
  return blocks.map(serializeSourceBlock);
}
