import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

type DmmfModel = (typeof Prisma.dmmf)["datamodel"]["models"][number];
type DmmfEnum = (typeof Prisma.dmmf)["datamodel"]["enums"][number];

const models = (): readonly DmmfModel[] => Prisma.dmmf.datamodel.models;
const enums = (): readonly DmmfEnum[] => Prisma.dmmf.datamodel.enums;

function modelByName(name: string): DmmfModel {
  const model = models().find((candidate) => candidate.name === name);
  expect(model, `expected Prisma model ${name}`).toBeDefined();
  return model!;
}

function enumByName(name: string): DmmfEnum {
  const value = enums().find((candidate) => candidate.name === name);
  expect(value, `expected Prisma enum ${name}`).toBeDefined();
  return value!;
}

function fieldByName(model: DmmfModel, name: string) {
  const field = model.fields.find((candidate) => candidate.name === name);
  expect(field, `expected ${model.name}.${name}`).toBeDefined();
  return field!;
}

function expectFields(
  model: DmmfModel,
  expected: readonly [name: string, type: string, kind?: "scalar" | "enum" | "object"][],
) {
  for (const [name, type, kind] of expected) {
    const field = fieldByName(model, name);
    expect(field.type, `${model.name}.${name} type`).toBe(type);
    if (kind) expect(field.kind, `${model.name}.${name} kind`).toBe(kind);
  }
}

function expectEnumValues(name: string, expected: readonly string[]) {
  const value = enumByName(name);
  expect(value.values.map((entry) => entry.name)).toEqual(expect.arrayContaining([...expected]));
}

describe("governed learning and continuity Prisma schema contract", () => {
  it("defines explicit memory governance enums and fields", () => {
    expectEnumValues("AiMemoryState", ["PROPOSED", "APPROVED", "REJECTED", "ARCHIVED", "SUPERSEDED"]);
    expectEnumValues("AiMemoryScope", ["USER", "TEAM", "DEPARTMENT", "WORKSPACE"]);
    expectEnumValues("AiMemoryKind", ["PREFERENCE", "FACT", "DECISION", "TERMINOLOGY", "RELATIONSHIP", "LESSON"]);
    expectEnumValues("AiMemoryProvenance", ["GENERATED", "USER_PROVIDED", "IMPORTED", "SYSTEM"]);
    expectEnumValues("AiMemoryFreshness", ["FRESH", "AGING", "STALE", "UNKNOWN"]);

    const memory = modelByName("AiMemory");
    expectFields(memory, [
      ["scope", "AiMemoryScope", "enum"],
      ["kind", "AiMemoryKind", "enum"],
      ["state", "AiMemoryState", "enum"],
      ["content", "String", "scalar"],
      ["provenance", "AiMemoryProvenance", "enum"],
      ["confidence", "Float", "scalar"],
      ["freshness", "AiMemoryFreshness", "enum"],
      ["expiresAt", "DateTime", "scalar"],
      ["supersededById", "String", "scalar"],
      ["sources", "AiMemorySource", "object"],
    ]);

    const replacement = fieldByName(memory, "supersededBy");
    expect(replacement.kind, "AiMemory.supersededBy relation").toBe("object");
    expect(replacement.type, "AiMemory.supersededBy relation target").toBe("AiMemory");
  });

  it("defines immutable playbook, version, and evaluation structure", () => {
    expectEnumValues("AiPlaybookState", ["DRAFT", "IN_REVIEW", "APPROVED", "ARCHIVED"]);

    const playbook = modelByName("AiPlaybook");
    expectFields(playbook, [
      ["ownerId", "String", "scalar"],
      ["scope", "AiMemoryScope", "enum"],
      ["state", "AiPlaybookState", "enum"],
      ["versions", "AiPlaybookVersion", "object"],
    ]);

    const version = modelByName("AiPlaybookVersion");
    expectFields(version, [
      ["playbookId", "String", "scalar"],
      ["version", "Int", "scalar"],
      ["normalizedInstructions", "String", "scalar"],
      ["triggerRulesJson", "String", "scalar"],
      ["contextRequirementsJson", "String", "scalar"],
      ["capabilityAllowlistJson", "String", "scalar"],
      ["approvalOverridesJson", "String", "scalar"],
      ["checksum", "String", "scalar"],
      ["evaluations", "AiPlaybookEvaluation", "object"],
    ]);
    expect(version.uniqueFields).toEqual(expect.arrayContaining([["playbookId", "version"]]));

    const evaluation = modelByName("AiPlaybookEvaluation");
    expectFields(evaluation, [
      ["playbookVersionId", "String", "scalar"],
      ["status", "String", "scalar"],
      ["resultJson", "String", "scalar"],
    ]);
  });

  it("records governed feedback without duplicating approval or message models", () => {
    expectEnumValues("AiFeedbackOutcome", ["ACCEPTED", "EDITED", "REJECTED", "IGNORED", "UNDONE", "CORRECTED"]);

    const feedback = modelByName("AiFeedback");
    expectFields(feedback, [
      ["outcome", "AiFeedbackOutcome", "enum"],
      ["contextJson", "String", "scalar"],
      ["proposedDiffHash", "String", "scalar"],
      ["finalDiffHash", "String", "scalar"],
      ["workflowId", "String", "scalar"],
      ["approvalId", "String", "scalar"],
      ["conversationId", "String", "scalar"],
      ["messageId", "String", "scalar"],
    ]);
    expect(fieldByName(feedback, "approval")).toMatchObject({ kind: "object", type: "AiApproval" });
    expect(fieldByName(feedback, "conversation")).toMatchObject({ kind: "object", type: "AiConversation" });
    expect(fieldByName(feedback, "message")).toMatchObject({ kind: "object", type: "AiMessage" });
  });

  it("defines versioned summaries with message boundaries, protected state, and source pointers", () => {
    const summary = modelByName("AiConversationSummary");
    expectFields(summary, [
      ["conversationId", "String", "scalar"],
      ["version", "Int", "scalar"],
      ["startMessageId", "String", "scalar"],
      ["endMessageId", "String", "scalar"],
      ["protectedStateJson", "String", "scalar"],
      ["sourceMessageIdsJson", "String", "scalar"],
      ["supersededById", "String", "scalar"],
    ]);
    expect(summary.uniqueFields).toEqual(expect.arrayContaining([["conversationId", "version"]]));
    expect(fieldByName(summary, "conversation")).toMatchObject({ kind: "object", type: "AiConversation" });
    expect(fieldByName(summary, "startMessage")).toMatchObject({ kind: "object", type: "AiMessage" });
    expect(fieldByName(summary, "endMessage")).toMatchObject({ kind: "object", type: "AiMessage" });
    expect(fieldByName(summary, "supersededBy")).toMatchObject({ kind: "object", type: "AiConversationSummary" });
  });
});
