import { expect, test, type Page } from "@playwright/test";
import { loginAs, loginAsEmail } from "./helpers/auth";

const PRIVACY_EMAILS = {
    alice: "e2e-priv-alice@test.com",
    bob: "e2e-priv-bob@test.com",
} as const;
const PRIVATE_TASK_ID = "e2e-priv-task";
const PRIVATE_TASK_MARKER = "e2e-priv-search-marker";
const PRIVATE_NOTE_ID = "e2e-priv-note";
const PRIVATE_NOTE_MARKER = "e2e-priv-note-marker";
const PRIVATE_PROJECT_ID = "e2e-priv-project";
const PRIVATE_PROJECT_MARKER = "e2e-priv-project-marker";

type SearchHit = {
    type: "task" | "project" | "note" | "kpi";
    id: string;
    title: string;
};

type SearchPayload = {
    hits: SearchHit[];
};

async function search(page: Page, query: string) {
    const response = await page.request.get(`/api/search?q=${encodeURIComponent(query)}`);
    expect(response.status()).toBe(200);
    const text = await response.text();
    return { text, payload: JSON.parse(text) as SearchPayload };
}

async function loginAsPrivacyUser(page: Page, email: string): Promise<void> {
    await page.context().clearCookies();
    await loginAsEmail(page, email);
}

test("unrelated member cannot find private marker in search", async ({ page }) => {
    await loginAsPrivacyUser(page, PRIVACY_EMAILS.bob);
    const bobSearch = await search(page, PRIVATE_TASK_MARKER);
    expect(bobSearch.payload.hits.some((hit) => hit.id === PRIVATE_TASK_ID)).toBe(false);
    expect(bobSearch.text).not.toContain(PRIVATE_TASK_MARKER);
    expect(bobSearch.text).not.toContain(PRIVATE_TASK_ID);

    await loginAsPrivacyUser(page, PRIVACY_EMAILS.alice);
    const aliceSearch = await search(page, PRIVATE_TASK_MARKER);
    expect(aliceSearch.payload.hits).toEqual([
        expect.objectContaining({ type: "task", id: PRIVATE_TASK_ID, title: PRIVATE_TASK_MARKER }),
    ]);

    await page.context().clearCookies();
    await loginAs(page, "admin");
    const adminSearch = await search(page, PRIVATE_TASK_MARKER);
    expect(adminSearch.payload.hits).toEqual([
        expect.objectContaining({ type: "task", id: PRIVATE_TASK_ID, title: PRIVATE_TASK_MARKER }),
    ]);
});

test("note and project visibility hold in search", async ({ page }) => {
    await loginAsPrivacyUser(page, PRIVACY_EMAILS.bob);
    const bobNoteSearch = await search(page, PRIVATE_NOTE_MARKER);
    expect(bobNoteSearch.payload.hits.some((hit) => hit.id === PRIVATE_NOTE_ID)).toBe(false);
    expect(bobNoteSearch.text).not.toContain(PRIVATE_NOTE_MARKER);
    expect(bobNoteSearch.text).not.toContain(PRIVATE_NOTE_ID);

    const bobProjectSearch = await search(page, PRIVATE_PROJECT_MARKER);
    expect(bobProjectSearch.payload.hits.some((hit) => hit.id === PRIVATE_PROJECT_ID)).toBe(false);
    expect(bobProjectSearch.text).not.toContain(PRIVATE_PROJECT_MARKER);
    expect(bobProjectSearch.text).not.toContain(PRIVATE_PROJECT_ID);
    const bobProjectRead = await page.request.get(`/api/projects/${PRIVATE_PROJECT_ID}`);
    expect(bobProjectRead.status()).toBe(404);

    await loginAsPrivacyUser(page, PRIVACY_EMAILS.alice);
    const aliceNoteSearch = await search(page, PRIVATE_NOTE_MARKER);
    expect(aliceNoteSearch.payload.hits).toEqual([
        expect.objectContaining({ type: "note", id: PRIVATE_NOTE_ID, title: PRIVATE_NOTE_MARKER }),
    ]);

    const aliceProjectSearch = await search(page, PRIVATE_PROJECT_MARKER);
    expect(aliceProjectSearch.payload.hits).toEqual([
        expect.objectContaining({ type: "project", id: PRIVATE_PROJECT_ID, title: PRIVATE_PROJECT_MARKER }),
    ]);
    const aliceProjectRead = await page.request.get(`/api/projects/${PRIVATE_PROJECT_ID}`);
    expect(aliceProjectRead.status()).toBe(200);
    await expect(aliceProjectRead.json()).resolves.toMatchObject({
        id: PRIVATE_PROJECT_ID,
        name: PRIVATE_PROJECT_MARKER,
    });
});
