// Explicit synthetic transport for local browser acceptance, never production.
// Keeps the real app routes, auth, database, and approval flow under test.
const { createHash } = require("node:crypto");

let db;
try {
  db = new URL(process.env.DATABASE_URL || "");
} catch {
  throw new Error("Provider fixture requires explicit loopback test database and fixture key");
}
if (
  process.env.E2E_PROVIDER_FIXTURE !== "1" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) ||
  !/(?:test|e2e)/i.test(db.pathname) ||
  process.env.GLM_API_KEY !== "e2e-provider-fixture-key"
) {
  throw new Error("Provider fixture requires explicit loopback test database and fixture key");
}

const originalFetch = globalThis.fetch;
const memo = [
  "صياغة: استخدم صياغة موجزة وواضحة.",
  "صياغة: ابدأ بالفعل ثم الأثر.",
  "صياغة: اجمع الأعمال المترابطة.",
  "صياغة: حافظ على نبرة مهنية.",
  "انتقاء: ركز على الأثر.",
  "انتقاء: اذكر العمل المكتمل.",
  "انتقاء: تجنب التفاصيل الروتينية.",
  "انتقاء: افصل الإنجاز عن العمل الجاري.",
].join("\n");

function fingerprint(value) {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, typeof item === "string" ? item.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US") : item])));
  return createHash("sha256").update(canonical).digest("hex");
}

const source = {
  entityType: "PROJECT",
  entityId: "e2e-pmo-project",
  label: "E2E PMO Project",
  href: "/projects/e2e-pmo-project",
  sourceUpdatedAt: "2026-08-20T00:00:00.000Z",
  checksum: fingerprint({ entityType: "PROJECT", entityId: "e2e-pmo-project", label: "E2E PMO Project" }),
};

// Deterministic display-only Markdown for the local browser acceptance. This
// never represents a real provider response or production content.
const ARABIC_MARKDOWN_RESPONSE = [
  "## تقرير المتابعة",
  "",
  "يوضح الجدول التالي ملخصاً اصطناعياً للاختبار:",
  "",
  "| الأولوية | العدد |",
  "| --- | ---: |",
  "| عالية | 2 |",
  "| متوسطة | 1 |",
  "",
  "[فتح المهمة](/tasks/e2e-sabah-verified-link)",
  "",
  "[رابط خارجي غير آمن](//evil.example/blocked)",
].join("\n");

// These are deliberately synthetic, stable, and distinct from production data.
// The browser regression asserts the same literal titles after the authenticated
// task API read-back.
const CREATE6_TASK_TITLES = Object.freeze([
  "e2e-pmo-chat-create6-Prepare daily stand-up notes",
  "e2e-pmo-chat-create6-Review incoming requests",
  "e2e-pmo-chat-create6-Update the team action log",
  "e2e-pmo-chat-create6-Check today's delivery risks",
  "e2e-pmo-chat-create6-Draft the afternoon status update",
  "e2e-pmo-chat-create6-Close out today's follow-ups",
]);

function riyadhTodayEnd() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}T23:59:59+03:00`;
}

function messagesFrom(body) {
  return Array.isArray(body.messages) ? body.messages : [];
}

function latestUserMessage(messages) {
  return [...messages].reverse().find((message) => message && message.role === "user" && typeof message.content === "string")?.content || "";
}

function currentUserId(messages) {
  const system = messages.find((message) => message && message.role === "system" && typeof message.content === "string");
  // Project/team context also contains ids. Bind the fixture to the explicit
  // Current user line so tasks are proposed for the authenticated actor.
  const match = system?.content.match(/Current user:[^\n]*\bid:\s*([A-Za-z0-9][A-Za-z0-9._:-]{0,159})/i);
  return match?.[1] || "e2e-provider-owner";
}

function compressionSummary(messages) {
  const prompt = latestUserMessage(messages);
  try {
    const input = JSON.parse(prompt);
    if (!input || !Array.isArray(input.messages) || !input.messages.every((message) => message && typeof message.id === "string")) return null;
    const protectedState = input.protectedState && typeof input.protectedState === "object" ? input.protectedState : {};
    return JSON.stringify({
      factualSummary: "Synthetic continuity summary for isolated acceptance.",
      userCorrections: Array.isArray(protectedState.userCorrections) ? protectedState.userCorrections : [],
      decisions: Array.isArray(protectedState.decisions) ? protectedState.decisions : [],
      unresolvedActions: Array.isArray(protectedState.unresolvedActions) ? protectedState.unresolvedActions : [],
      approvals: Array.isArray(protectedState.approvals) ? protectedState.approvals : [],
      safetyBoundaries: Array.isArray(protectedState.safetyBoundaries) ? protectedState.safetyBoundaries : [],
      sourceMessageIds: input.messages.map((message) => message.id),
    });
  } catch {
    return null;
  }
}

function responseForProposal(messages, name, proposal, id) {
  const encoder = new TextEncoder();
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify({ kind: proposal.scope === "TEAM" ? "playbook" : "memory", proposal }) } }] } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
  const stream = new ReadableStream({
    start(controller) {
      if (messages.some((message) => message?.role === "tool")) {
        controller.close();
        return;
      }
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

function responseForWorkflowProposal(proposal, id) {
  const encoder = new TextEncoder();
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name: "proposeWorkflow", arguments: JSON.stringify(proposal) } }] } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

function create6WorkflowProposal(messages) {
  const actorId = currentUserId(messages);
  const tasks = CREATE6_TASK_TITLES.map((title) => ({
    title,
    description: "Synthetic browser acceptance task.",
    status: "TODO",
    priority: "MEDIUM",
    dueAt: riyadhTodayEnd(),
    assigneeIds: [actorId],
  }));
  return {
    goal: /another action/i.test(latestUserMessage(messages)) ? "Prepare another six-task action" : "Add six tasks for today",
    steps: [{
      clientStepId: "create-six-tasks",
      capability: "tasks.createMany",
      args: { tasks, allowPartial: false },
      dependsOn: [],
      confidence: 0.99,
      inferredFields: [],
      evidenceRefs: [],
    }],
  };
}

function responseForText(text, signal, delayed) {
  const encoder = new TextEncoder();
  let timer;
  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const finish = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", finish);
        try { controller.close(); } catch { /* consumer cancelled */ }
      };
      if (signal?.aborted) return finish();
      signal?.addEventListener("abort", finish, { once: true });
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      if (delayed) {
        timer = setTimeout(() => {
          if (closed) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: " late content" } }] })}\n\ndata: [DONE]\n\n`));
          finish();
        }, 5000);
      } else {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        finish();
      }
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

globalThis.fetch = async function fixtureFetch(input, init) {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.origin !== "https://api.z.ai" || !url.pathname.endsWith("/chat/completions")) {
    return originalFetch(input, init);
  }

  const body = JSON.parse(init?.body || "{}");
  const messages = messagesFrom(body);
  const latest = latestUserMessage(messages);
  if (!body.stream) {
    const summary = compressionSummary(messages);
    return Response.json({
      model: body.model,
      choices: [{ message: { role: "assistant", content: summary || memo }, finish_reason: "stop" }],
    });
  }

  if (messages.some((message) => message?.role === "tool")) return responseForText("Synthetic proposal forwarded for human approval.", init?.signal, false);
  if (/Stream and stop this response/i.test(latest)) return responseForText("Partial answer", init?.signal, true);
  if (/^A file was uploaded as intake [A-Za-z0-9_-]+ \(\d+ rows\)/m.test(latest)) return responseForText("Partial answer", init?.signal, false);
  if (/اكتب تقرير متابعة Markdown بالعربية/i.test(latest)) return responseForText(ARABIC_MARKDOWN_RESPONSE, init?.signal, false);
  if (/add six tasks for today/i.test(latest)) return responseForWorkflowProposal(create6WorkflowProposal(messages), /another action/i.test(latest) ? "e2e-create6-second-workflow-call" : "e2e-create6-workflow-call");
  if (/Synthetic shared playbook proposal/i.test(latest)) {
    return responseForProposal(messages, "proposeMemoryOrPlaybookUpdate", {
      playbookId: "e2e-continuity-playbook",
      version: 1,
      name: "Synthetic continuity playbook",
      description: "Synthetic shared flow",
      scope: "TEAM",
      ownerId: currentUserId(messages),
      departmentId: "e2e-pmo-department",
      triggers: { en: ["synthetic shared flow"], ar: ["تدفق مشترك اصطناعي"] },
      requiredContext: ["context"],
      allowedCapabilities: ["notes.search"],
      requiredApprovals: ["lead"],
      outputSchema: { result: "string" },
      evaluationCases: [{ input: "synthetic shared flow", expected: "ok" }],
    }, "e2e-playbook-call");
  }
  if (/Synthetic preference:.*Propose it for approval/i.test(latest)) {
    return responseForProposal(messages, "proposeMemoryOrPlaybookUpdate", {
      scope: "USER",
      kind: "PREFERENCE",
      content: "Use concise wording in responses.",
      provenance: "GENERATED",
      confidence: 0.86,
      sources: [source],
    }, "e2e-memory-call");
  }
  return responseForText("Synthetic answer.", init?.signal, false);
};
