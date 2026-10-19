import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function streamEvents(body: string): JsonRecord[] {
    return body.split(/\r?\n\r?\n/).flatMap((chunk) => {
        const line = chunk.split(/\r?\n/).find((candidate) => candidate.startsWith("data: "));
        if (!line) return [];
        try {
            const value: unknown = JSON.parse(line.slice(6));
            return isRecord(value) ? [value] : [];
        } catch {
            return [];
        }
    });
}

function toolResultData(body: string, toolName: string): JsonRecord {
    const event = streamEvents(body).find((candidate) => candidate.type === "tool_result" && candidate.name === toolName);
    const result = event?.result;
    if (!isRecord(result) || result.ok !== true || !isRecord(result.data)) return {};
    return result.data;
}

function messageIds(body: unknown): string[] {
    if (!isRecord(body) || !Array.isArray(body.items)) return [];
    return body.items.flatMap((item) => isRecord(item) && typeof item.messageId === "string" ? [item.messageId] : []);
}

function conversationMessageIds(body: unknown): string[] {
    if (!isRecord(body) || !Array.isArray(body.messages)) return [];
    return body.messages.flatMap((item) => isRecord(item) && typeof item.id === "string" ? [item.id] : []);
}

/**
 * Chat intentionally exposes `proposeMemoryOrPlaybookUpdate` as a forward-only
 * proposal tool. It never persists or decides learning records. Persistence and
 * human approval therefore use the authenticated memory/playbook routes below;
 * this keeps the acceptance intent while testing the actual API contract.
 */
test.describe("Sabah learning and continuity", () => {
    test.skip(!process.env.SABAH_CONTINUITY_E2E, "Set SABAH_CONTINUITY_E2E=1 with a provisioned local E2E profile");

    test("gates proposals, human decisions, compression, search, and jump", async ({ page }) => {
        await loginAs(page, "admin");
        await page.goto("/dashboard");
        const exact = "Synthetic continuity anchor message";
        const preference = await page.request.post("/api/ai/chat", {
            data: {
                message: `Synthetic preference: use concise wording. ${exact} Propose it for approval.`,
                history: [],
            },
        });
        expect(preference.ok()).toBeTruthy();
        const preferenceStream = await preference.text();
        expect(preferenceStream).toContain('"type":"conversation"');
        expect(preferenceStream).toContain("proposeMemoryOrPlaybookUpdate");
        const forwardedMemory = toolResultData(preferenceStream, "proposeMemoryOrPlaybookUpdate");
        expect(forwardedMemory.requiresHumanApproval).toBe(true);
        const memoryProposal = forwardedMemory.proposal;
        expect(isRecord(memoryProposal)).toBeTruthy();
        if (!isRecord(memoryProposal)) throw new Error("Synthetic memory proposal was not returned");
        expect(memoryProposal.kind).toBe("PREFERENCE");
        expect(memoryProposal.provenance).toBe("GENERATED");

        const conversationIdMatch = preferenceStream.match(/"type":"conversation","id":"([^"]+)"/);
        expect(conversationIdMatch?.[1]).toBeTruthy();
        const conversationId = conversationIdMatch?.[1] ?? "";
        const memoryCreate = await page.request.post("/api/ai/memory", { data: memoryProposal });
        expect(memoryCreate.status()).toBe(201);
        const memoryCreateBody: unknown = await memoryCreate.json();
        const memoryId = isRecord(memoryCreateBody) && typeof memoryCreateBody.id === "string" ? memoryCreateBody.id : "";
        expect(memoryId).toBeTruthy();
        expect(isRecord(memoryCreateBody) && memoryCreateBody.state).toBe("PROPOSED");

        const personalDecision = await page.request.post(`/api/ai/memory/${encodeURIComponent(memoryId)}/decision`, {
            data: { decision: "APPROVED", reason: "Synthetic human approval" },
        });
        expect(personalDecision.status()).toBe(200);
        expect(await personalDecision.json()).toMatchObject({ id: memoryId, state: "APPROVED" });

        const approvedMemorySearch = await page.request.get("/api/ai/memory?query=concise%20wording");
        expect(approvedMemorySearch.ok()).toBeTruthy();
        const approvedMemoryBody: unknown = await approvedMemorySearch.json();
        expect(isRecord(approvedMemoryBody) && Array.isArray(approvedMemoryBody.items) && approvedMemoryBody.items.some((item) => isRecord(item) && item.id === memoryId)).toBe(true);

        const shared = await page.request.post("/api/ai/chat", {
            data: {
                message: "Synthetic shared playbook proposal for the team; approval is required.",
                history: [],
                conversationId,
            },
        });
        expect(shared.ok()).toBeTruthy();
        const sharedStream = await shared.text();
        expect(sharedStream).toContain("proposeMemoryOrPlaybookUpdate");
        const forwardedPlaybook = toolResultData(sharedStream, "proposeMemoryOrPlaybookUpdate");
        expect(forwardedPlaybook.requiresHumanApproval).toBe(true);
        const playbookProposal = forwardedPlaybook.proposal;
        expect(isRecord(playbookProposal)).toBeTruthy();
        if (!isRecord(playbookProposal)) throw new Error("Synthetic playbook proposal was not returned");
        expect(playbookProposal.kind).toBeUndefined();
        expect(playbookProposal.scope).toBe("TEAM");

        const playbookCreate = await page.request.post("/api/ai/playbooks", { data: playbookProposal });
        expect(playbookCreate.status()).toBe(201);
        const playbookCreateBody: unknown = await playbookCreate.json();
        const playbookVersionId = isRecord(playbookCreateBody) && typeof playbookCreateBody.id === "string" ? playbookCreateBody.id : "";
        const playbookId = isRecord(playbookCreateBody) && typeof playbookCreateBody.playbookId === "string" ? playbookCreateBody.playbookId : "";
        expect(playbookVersionId).toBeTruthy();
        expect(playbookId).toBe("e2e-continuity-playbook");
        expect(isRecord(playbookCreateBody) && playbookCreateBody.state).toBe("DRAFT");

        const review = await page.request.post(`/api/ai/playbooks/${encodeURIComponent(playbookVersionId)}/review`);
        expect(review.status()).toBe(200);
        expect(await review.json()).toMatchObject({ id: playbookVersionId, state: "IN_REVIEW" });

        const currentUser = await page.request.get("/api/users/me");
        expect(currentUser.ok()).toBeTruthy();
        const currentUserBody: unknown = await currentUser.json();
        const currentRole = isRecord(currentUserBody) && typeof currentUserBody.role === "string" ? currentUserBody.role : "";
        const sharedDecision = await page.request.post(`/api/ai/playbooks/${encodeURIComponent(playbookVersionId)}/decision`, {
            data: { decision: "APPROVED", reason: "Synthetic human approval" },
        });
        if (currentRole === "ADMIN" || currentRole === "LEAD") {
            expect(sharedDecision.status()).toBe(200);
            expect(await sharedDecision.json()).toMatchObject({ id: playbookVersionId, state: "APPROVED" });
        } else {
            expect(sharedDecision.status()).toBe(403);
        }

        const playbookVersions = await page.request.get(`/api/ai/playbooks/${encodeURIComponent(playbookId)}/versions`);
        expect(playbookVersions.ok()).toBeTruthy();
        const playbookVersionsBody: unknown = await playbookVersions.json();
        expect(isRecord(playbookVersionsBody) && Array.isArray(playbookVersionsBody.versions) && playbookVersionsBody.versions.some((item) => isRecord(item) && item.id === playbookVersionId && item.state === "APPROVED")).toBe(true);

        for (let index = 0; index < 10; index += 1) {
            const filler = await page.request.post("/api/ai/chat", {
                data: { message: `Synthetic continuity filler ${index + 1}`, history: [], conversationId },
            });
            expect(filler.ok()).toBeTruthy();
            await filler.text();
        }

        const searchBefore = await page.request.post("/api/ai/conversations/search", { data: { query: exact, conversationId, limit: 10 } });
        expect(searchBefore.ok()).toBeTruthy();
        const originalIds = messageIds(await searchBefore.json());
        expect(originalIds.length).toBeGreaterThan(0);

        const searchSection = page.locator('section[aria-label="Conversation history search"]');
        await page.getByRole("button", { name: "Open Sabah" }).click();
        await searchSection.getByRole("searchbox", { name: "Search conversation history" }).fill(exact);
        await searchSection.getByRole("button", { name: "Search" }).click();
        const resultButtons = searchSection.locator("ul button");
        await expect(resultButtons.first()).toBeVisible();
        await resultButtons.first().click();
        await expect(page.getByLabel("Jumped-to message")).toBeVisible();

        const compressed = await page.request.post(`/api/ai/conversations/${conversationId}/compress`, { data: { maxMessages: 500 } });
        expect(compressed.ok()).toBeTruthy();
        const compressedBody: unknown = await compressed.json();
        expect(isRecord(compressedBody) && compressedBody.status).toBe("compressed");

        const searchAfter = await page.request.post("/api/ai/conversations/search", { data: { query: exact, conversationId, limit: 10 } });
        expect(searchAfter.ok()).toBeTruthy();
        expect(messageIds(await searchAfter.json())).toEqual(expect.arrayContaining(originalIds));

        const conversation = await page.request.get(`/api/ai/conversations/${conversationId}`);
        expect(conversation.ok()).toBeTruthy();
        expect(conversationMessageIds(await conversation.json())).toEqual(expect.arrayContaining(originalIds));
    });
});
