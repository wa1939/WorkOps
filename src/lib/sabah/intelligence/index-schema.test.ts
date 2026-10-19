import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");

type DmmfModel = (typeof Prisma.dmmf)["datamodel"]["models"][number];

function readModels() {
  return Prisma.dmmf.datamodel.models;
}

function modelByName(models: readonly DmmfModel[], name: string) {
  const model = models.find((candidate) => candidate.name === name);
  expect(model, `expected Prisma model ${name}`).toBeDefined();
  return model!;
}

function modelSchemaBlock(name: string) {
  const start = schema.indexOf(`model ${name} {`);
  const end = schema.indexOf("\n}", start);
  expect(start, `expected Prisma schema block for ${name}`).toBeGreaterThanOrEqual(0);
  expect(end, `expected Prisma schema block for ${name}`).toBeGreaterThan(start);
  return schema.slice(start, end);
}

function declaredIndexes(modelName: string) {
  return modelSchemaBlock(modelName)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("@@index(["))
    .map((line) => line.slice("@@index([".length, line.indexOf("])")))
    .map((fields) => fields.split(",").map((field) => field.trim()));
}

describe("provider-neutral workspace index Prisma contract", () => {
  it("defines the additive index models with bounded, freshness-aware fields", async () => {
    const models = readModels();
    const chunk = modelByName(models, "AiKnowledgeChunk");
    const fingerprint = modelByName(models, "AiEntityFingerprint");
    const embedding = modelByName(models, "AiEmbeddingVector");

    expect(chunk.fields.map((field) => [field.name, field.type])).toEqual(
      expect.arrayContaining([
        ["id", "String"],
        ["entityType", "String"],
        ["entityId", "String"],
        ["chunkKind", "String"],
        ["text", "String"],
        ["normalizedText", "String"],
        ["checksum", "String"],
        ["sourceUpdatedAt", "DateTime"],
        ["visibilityClass", "String"],
        ["staleAt", "DateTime"],
        ["deletedAt", "DateTime"],
        ["createdAt", "DateTime"],
        ["updatedAt", "DateTime"],
      ]),
    );
    expect(chunk.uniqueFields).toEqual(expect.arrayContaining([["entityType", "entityId", "chunkKind"]]));
    expect(declaredIndexes("AiKnowledgeChunk")).toEqual(
      expect.arrayContaining([["entityType", "entityId"], ["sourceUpdatedAt"], ["visibilityClass", "staleAt", "deletedAt"]]),
    );
    expect(chunk.fields.find((field) => field.name === "embeddings")?.kind).toBe("object");
    expect(chunk.fields.find((field) => field.name === "embeddings")?.type).toBe("AiEmbeddingVector");

    expect(fingerprint.fields.map((field) => [field.name, field.type])).toEqual(
      expect.arrayContaining([
        ["id", "String"],
        ["entityType", "String"],
        ["entityId", "String"],
        ["kind", "String"],
        ["fingerprint", "String"],
        ["sourceUpdatedAt", "DateTime"],
        ["staleAt", "DateTime"],
        ["deletedAt", "DateTime"],
        ["createdAt", "DateTime"],
        ["updatedAt", "DateTime"],
      ]),
    );
    expect(fingerprint.uniqueFields).toEqual(expect.arrayContaining([["entityType", "entityId", "kind"]]));
    expect(declaredIndexes("AiEntityFingerprint")).toEqual(
      expect.arrayContaining([["fingerprint"], ["entityType", "entityId"], ["sourceUpdatedAt"], ["staleAt", "deletedAt"]]),
    );

    expect(embedding.fields.map((field) => [field.name, field.type])).toEqual(
      expect.arrayContaining([
        ["id", "String"],
        ["chunkId", "String"],
        ["providerKey", "String"],
        ["modelName", "String"],
        ["dimension", "Int"],
        ["vectorJson", "String"],
        ["createdAt", "DateTime"],
        ["updatedAt", "DateTime"],
      ]),
    );
    expect(embedding.uniqueFields).toEqual(expect.arrayContaining([["chunkId", "providerKey", "modelName"]]));
    expect(declaredIndexes("AiEmbeddingVector")).toEqual(
      expect.arrayContaining([["chunkId"], ["providerKey", "modelName"]]),
    );

    const chunkRelation = embedding.fields.find((field) => field.name === "chunk");
    expect(chunkRelation).toMatchObject({
      kind: "object",
      type: "AiKnowledgeChunk",
      relationName: "AiEmbeddingVectorToAiKnowledgeChunk",
      relationFromFields: ["chunkId"],
      relationToFields: ["id"],
      relationOnDelete: "Cascade",
    });
  });

  it("keeps index storage provider-neutral and excludes secrets and raw binaries", async () => {
    const models = readModels();
    const indexedModels = models.filter((model) => model.name.startsWith("Ai"));
    const fieldNames = indexedModels.flatMap((model) => model.fields.map((field) => field.name.toLowerCase()));

    expect(fieldNames).not.toEqual(expect.arrayContaining(["apikey", "api_key", "credential", "password", "rawcontent", "binarydata"]));
    expect(schema).not.toMatch(/Bytes|Unsupported\("vector"\)|pgvector/i);
    expect(modelSchemaBlock("AiEmbeddingVector")).toMatch(/vectorJson\s+String\s+@db\.VarChar\(12000\)/);
  });
});
