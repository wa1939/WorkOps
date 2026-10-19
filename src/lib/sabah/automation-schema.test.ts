import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

type DmmfModel = (typeof Prisma.dmmf)["datamodel"]["models"][number];
type DmmfEnum = (typeof Prisma.dmmf)["datamodel"]["enums"][number];

const modelByName = (name: string): DmmfModel => {
  const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === name);
  expect(model, `expected Prisma model ${name}`).toBeDefined();
  return model!;
};
const enumByName = (name: string): DmmfEnum => {
  const value = Prisma.dmmf.datamodel.enums.find((candidate) => candidate.name === name);
  expect(value, `expected Prisma enum ${name}`).toBeDefined();
  return value!;
};
const fieldByName = (model: DmmfModel, name: string) => {
  const field = model.fields.find((candidate) => candidate.name === name);
  expect(field, `expected ${model.name}.${name}`).toBeDefined();
  return field!;
};
const expectFields = (model: DmmfModel, fields: readonly [string, string, "scalar" | "enum" | "object"][]) => {
  for (const [name, type, kind] of fields) {
    const field = fieldByName(model, name);
    expect(field.type, `${model.name}.${name} type`).toBe(type);
    expect(field.kind, `${model.name}.${name} kind`).toBe(kind);
  }
};
const expectEnumValues = (name: string, values: readonly string[]) => {
  expect(enumByName(name).values.map((entry) => entry.name)).toEqual(expect.arrayContaining([...values]));
};
const expectUnique = (model: DmmfModel, fields: readonly string[]) => {
  const single = fields.length === 1 && fieldByName(model, fields[0]).isUnique;
  const composite = model.uniqueIndexes.some((index) => index.fields.join(",") === fields.join(","));
  expect(single || composite, `${model.name} unique ${fields.join(",")}`).toBe(true);
};

describe("durable Sabah automation Prisma schema contract", () => {
  it("defines the required typed lifecycle enums", () => {
    expectEnumValues("AiJobStatus", ["QUEUED", "LEASED", "RUNNING", "WAITING_APPROVAL", "RETRY_WAIT", "SUCCEEDED", "FAILED", "CANCELED"]);
    expectEnumValues("AiJobType", ["WORKFLOW_STEP", "COMPRESSION", "INDEX_ENTITY", "MONITOR", "CONNECTOR_DELIVERY", "SPECIALIST_ANALYSIS", "EXTRACTION"]);
    expectEnumValues("AiJobAttemptStatus", ["LEASED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]);
    expectEnumValues("AiMonitorStatus", ["ACTIVE", "PAUSED", "ERROR"]);
    expectEnumValues("AiSuggestionState", ["OPEN", "SNOOZED", "DISMISSED", "ACCEPTED", "EXPIRED"]);
    expectEnumValues("AiSuggestionSeverity", ["INFO", "WARNING", "CRITICAL"]);
    expectEnumValues("AiConnectorDirection", ["INBOUND", "OUTBOUND", "BIDIRECTIONAL"]);
    expectEnumValues("AiWebhookDeliveryStatus", ["PENDING", "DELIVERED", "FAILED", "RETRY_WAIT", "CANCELED"]);
  });

  it("persists jobs, attempts, and workflow relations without duplicating workflow models", () => {
    const job = modelByName("AiJob");
    expectFields(job, [
      ["type", "AiJobType", "enum"], ["status", "AiJobStatus", "enum"], ["priority", "Priority", "enum"],
      ["idempotencyKey", "String", "scalar"], ["actorId", "String", "scalar"], ["workflowId", "String", "scalar"],
      ["stepId", "String", "scalar"], ["payloadJson", "String", "scalar"], ["checkpointJson", "String", "scalar"],
      ["leaseOwner", "String", "scalar"], ["leaseToken", "String", "scalar"], ["leaseUntil", "DateTime", "scalar"],
      ["heartbeatAt", "DateTime", "scalar"], ["retryCount", "Int", "scalar"], ["maxAttempts", "Int", "scalar"],
      ["nextAttemptAt", "DateTime", "scalar"], ["canceledAt", "DateTime", "scalar"], ["resultJson", "String", "scalar"],
      ["errorJson", "String", "scalar"], ["actor", "User", "object"], ["workflow", "AiWorkflow", "object"],
      ["step", "AiWorkflowStep", "object"], ["attempts", "AiJobAttempt", "object"],
    ]);
    expectUnique(job, ["idempotencyKey"]);
    const attempt = modelByName("AiJobAttempt");
    expectFields(attempt, [
      ["jobId", "String", "scalar"], ["attemptNumber", "Int", "scalar"], ["workerId", "String", "scalar"],
      ["leaseToken", "String", "scalar"], ["leasedAt", "DateTime", "scalar"], ["startedAt", "DateTime", "scalar"],
      ["finishedAt", "DateTime", "scalar"], ["status", "AiJobAttemptStatus", "enum"], ["checkpointJson", "String", "scalar"],
      ["resultJson", "String", "scalar"], ["errorJson", "String", "scalar"], ["job", "AiJob", "object"],
    ]);
    expectUnique(attempt, ["jobId", "attemptNumber"]);
  });

  it("persists monitors, state, and governed suggestions", () => {
    const monitor = modelByName("AiMonitor");
    expectFields(monitor, [
      ["key", "String", "scalar"], ["name", "String", "scalar"], ["enabled", "Boolean", "scalar"],
      ["schedule", "String", "scalar"], ["scope", "AiMemoryScope", "enum"], ["definitionJson", "String", "scalar"],
      ["createdById", "String", "scalar"], ["createdBy", "User", "object"], ["state", "AiMonitorState", "object"],
      ["suggestions", "AiSuggestion", "object"],
    ]);
    expectUnique(monitor, ["key"]);
    const state = modelByName("AiMonitorState");
    expectFields(state, [["monitorId", "String", "scalar"], ["lastRunAt", "DateTime", "scalar"], ["sourceFingerprint", "String", "scalar"], ["nextRunAt", "DateTime", "scalar"], ["lastError", "String", "scalar"], ["monitor", "AiMonitor", "object"]]);
    expectUnique(state, ["monitorId"]);
    const suggestion = modelByName("AiSuggestion");
    expectFields(suggestion, [
      ["monitorId", "String", "scalar"], ["fingerprint", "String", "scalar"], ["severity", "AiSuggestionSeverity", "enum"], ["title", "String", "scalar"], ["summary", "String", "scalar"], ["evidenceJson", "String", "scalar"], ["state", "AiSuggestionState", "enum"], ["snoozedUntil", "DateTime", "scalar"], ["dismissedAt", "DateTime", "scalar"], ["cooldownUntil", "DateTime", "scalar"], ["actorId", "String", "scalar"], ["scope", "AiMemoryScope", "enum"], ["monitor", "AiMonitor", "object"], ["actor", "User", "object"],
    ]);
  });

  it("keeps connector secrets separate and webhook delivery body-free", () => {
    const connector = modelByName("AiConnector");
    expectFields(connector, [["key", "String", "scalar"], ["version", "Int", "scalar"], ["kind", "String", "scalar"], ["direction", "AiConnectorDirection", "enum"], ["enabled", "Boolean", "scalar"], ["eventType", "String", "scalar"], ["capability", "String", "scalar"], ["dataPolicy", "String", "scalar"], ["configJson", "String", "scalar"], ["createdById", "String", "scalar"], ["createdBy", "User", "object"], ["credential", "AiConnectorCredential", "object"], ["deliveries", "AiWebhookDelivery", "object"]]);
    expectUnique(connector, ["key", "version"]);
    const credential = modelByName("AiConnectorCredential");
    expectFields(credential, [["connectorId", "String", "scalar"], ["encryptedValue", "String", "scalar"], ["iv", "String", "scalar"], ["authTag", "String", "scalar"], ["keyVersion", "Int", "scalar"], ["connector", "AiConnector", "object"]]);
    expectUnique(credential, ["connectorId"]);
    const delivery = modelByName("AiWebhookDelivery");
    expectFields(delivery, [["connectorId", "String", "scalar"], ["eventType", "String", "scalar"], ["replayKey", "String", "scalar"], ["correlationId", "String", "scalar"], ["payloadHash", "String", "scalar"], ["requestHash", "String", "scalar"], ["responseHash", "String", "scalar"], ["status", "AiWebhookDeliveryStatus", "enum"], ["attemptCount", "Int", "scalar"], ["nextAttemptAt", "DateTime", "scalar"], ["errorMessage", "String", "scalar"], ["connector", "AiConnector", "object"]]);
    expectUnique(delivery, ["connectorId", "replayKey"]);
    const forbidden = /password|secret|token|body|raw|binary|file/i;
    for (const modelName of ["AiConnectorCredential", "AiWebhookDelivery"]) {
      for (const field of modelByName(modelName).fields.filter((candidate) => candidate.kind === "scalar")) expect(field.name).not.toMatch(forbidden);
    }
  });
});
