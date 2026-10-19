import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { expect, test, type Page } from "@playwright/test";
import { assertLocalDatabaseUrl } from "../scripts/assert-local-database";
import { PMO_IDS, PMO_PASSWORD, withPmoPrisma } from "./helpers/pmo";
import { loginAsEmail } from "./helpers/auth";
import { VIEW_TEMPLATES } from "../src/lib/view-templates";

const REPO_ROOT = process.cwd();
const EVIDENCE_ROOT = path.resolve(REPO_ROOT, ".superpowers/sdd/027-view-template-aggregate-contract/browser-evidence");
const FIXTURE_COUNT = 137;
const TEMPLATE_CASES = VIEW_TEMPLATES.map(({ id, name, blocks, cover }) => ({ id, name, blocks, cover }));

if (TEMPLATE_CASES.length !== 6) {
    throw new Error(`Expected 6 named view templates; found ${TEMPLATE_CASES.length}`);
}

mkdirSync(EVIDENCE_ROOT, { recursive: true });

type JsonRecord = Record<string, unknown>;
type TemplateCase = (typeof TEMPLATE_CASES)[number];
type FixtureMetadata = {
    runId: string;
    actorId: string;
    actorEmail: string;
    departmentId: string;
    projectId: string;
    taskIds: string[];
    count: number;
    rateLimitEntryIds: string[];
};
type RuntimeDiagnostics = {
    consoleErrors: string[];
    pageErrors: string[];
    requestFailures: string[];
    navigationRequestFailures: string[];
    nonNavigationRequestFailures: string[];
    preSteadyStateRequestFailures: string[];
    steadyStateRequestFailures: string[];
    steadyStateProbe?: JsonRecord;
};
type EvidenceRecord = {
    templateId: string;
    templateName: string;
    viewId?: string;
    viewName?: string;
    origin: string;
    actor: string;
    fixture: FixtureMetadata;
    screenshots: string[];
    layoutMetrics: JsonRecord[];
    renderedQueryUrls: string[];
    projectSelection?: JsonRecord;
    aggregateComparisons: JsonRecord[];
    taskComparisons: JsonRecord[];
    chipRequests: string[];
    injectedFlows: JsonRecord[];
    diagnostics?: RuntimeDiagnostics;
};

function writeEvidence(name: string, value: unknown): string {
    const target = path.join(EVIDENCE_ROOT, name);
    writeFileSync(target, JSON.stringify(value, null, 2), "utf8");
    return target;
}

function assertLocalAcceptanceDatabase(): void {
    assertLocalDatabaseUrl(process.env.DATABASE_URL ?? "", { requireDatabaseSuffix: "_test" });
}

function riyadhDateAtNoon(now = new Date()): Date {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Riyadh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(now);
    const values = Object.fromEntries(
        parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]),
    );
    return new Date(`${values.year}-${values.month}-${values.day}T12:00:00+03:00`);
}

function newFixtureMetadata(): FixtureMetadata {
    const runId = randomUUID();
    const namespace = `e2e-view-template-acceptance-${runId}`;
    return {
        runId,
        actorId: `${namespace}-actor`,
        actorEmail: `${namespace}@test.com`,
        departmentId: PMO_IDS.department,
        projectId: PMO_IDS.project,
        taskIds: Array.from({ length: FIXTURE_COUNT }, (_, index) => `${namespace}-task-${String(index + 1).padStart(3, "0")}`),
        count: FIXTURE_COUNT,
        rateLimitEntryIds: [],
    };
}

async function captureOwnedRateLimitEntries(fixture: FixtureMetadata): Promise<void> {
    await withPmoPrisma(async (prisma) => {
        const rows = await prisma.rateLimitEntry.findMany({
            where: { key: { startsWith: `login:${fixture.actorEmail}` } },
            select: { id: true },
        });
        fixture.rateLimitEntryIds = Array.from(new Set([
            ...fixture.rateLimitEntryIds,
            ...rows.map(({ id }) => id),
        ]));
    });
}

async function cleanupOwnedRateLimitEntries(fixture: FixtureMetadata): Promise<void> {
    const ids = Array.from(new Set(fixture.rateLimitEntryIds));
    if (ids.length === 0) return;
    await withPmoPrisma(async (prisma) => {
        await prisma.rateLimitEntry.deleteMany({ where: { id: { in: ids } } });
    });
}

async function preparePaginationFixture(): Promise<FixtureMetadata> {
    assertLocalAcceptanceDatabase();
    const fixture = newFixtureMetadata();
    try {
        await withPmoPrisma(async (prisma) => {
            const [existingTasks, actorById, actorByEmail, existingRateLimits] = await Promise.all([
                prisma.task.findMany({ where: { id: { in: fixture.taskIds } }, select: { id: true } }),
                prisma.user.findUnique({ where: { id: fixture.actorId }, select: { id: true } }),
                prisma.user.findUnique({ where: { email: fixture.actorEmail }, select: { id: true } }),
                prisma.rateLimitEntry.findMany({ where: { key: { startsWith: `login:${fixture.actorEmail}` } }, select: { id: true } }),
            ]);
            if (existingTasks.length > 0 || actorById || actorByEmail || existingRateLimits.length > 0) {
                throw new Error(`Refusing pagination fixture collision for run ${fixture.runId}`);
            }

            const password = await bcrypt.hash(PMO_PASSWORD, 10);
            await prisma.user.create({
                data: {
                    id: fixture.actorId,
                    email: fixture.actorEmail,
                    name: `E2E View Acceptance ${fixture.runId}`,
                    password,
                    emailVerified: new Date(),
                    role: "MEMBER",
                    isActive: true,
                },
            });
            await prisma.userDepartment.create({ data: { userId: fixture.actorId, departmentId: fixture.departmentId } });
            await prisma.projectMember.create({ data: { userId: fixture.actorId, projectId: fixture.projectId } });

            const dueAt = riyadhDateAtNoon();
            const tasks = fixture.taskIds.map((id, index) => {
                const isDone = index < 10;
                return {
                    id,
                    title: `${id} pagination proof`,
                    status: isDone ? ("DONE" as const) : ("TODO" as const),
                    priority: index % 17 === 0 ? ("HIGH" as const) : ("MEDIUM" as const),
                    dueAt,
                    doneAt: isDone ? new Date() : null,
                    isPrivate: false,
                    projectId: fixture.projectId,
                    createdById: fixture.actorId,
                };
            });
            await prisma.task.createMany({ data: tasks });
            await prisma.taskAssignment.createMany({
                data: tasks.map(({ id }) => ({ taskId: id, userId: fixture.actorId })),
            });
        });
        return fixture;
    } catch (error) {
        try {
            await cleanupPaginationFixture(fixture, []);
        } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], "Pagination fixture creation and exact cleanup both failed");
        }
        throw error;
    }
}

async function cleanupPaginationFixture(fixture: FixtureMetadata, viewIds: readonly string[]): Promise<void> {
    assertLocalAcceptanceDatabase();
    await withPmoPrisma(async (prisma) => {
        const taskIds = fixture.taskIds;
        if (taskIds.length > 0) {
            await prisma.notification.deleteMany({ where: { linkUrl: { in: taskIds.map((id) => `/tasks/${id}#follow-up`) } } });
            await prisma.auditLog.deleteMany({ where: { taskId: { in: taskIds } } });
            await prisma.taskAssignment.deleteMany({ where: { taskId: { in: taskIds } } });
            await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
        }
        if (viewIds.length > 0) {
            await prisma.auditLog.deleteMany({ where: { entityType: "saved_view", entityId: { in: [...viewIds] }, actorId: fixture.actorId } });
        }
        const rateLimitIds = Array.from(new Set(fixture.rateLimitEntryIds));
        if (rateLimitIds.length > 0) {
            await prisma.rateLimitEntry.deleteMany({ where: { id: { in: rateLimitIds } } });
        }
        await prisma.projectMember.deleteMany({ where: { projectId: fixture.projectId, userId: fixture.actorId } });
        await prisma.userDepartment.deleteMany({ where: { departmentId: fixture.departmentId, userId: fixture.actorId } });
        await prisma.user.deleteMany({ where: { id: fixture.actorId } });
    });
}

function decodeBlocks(raw: string): { cover: string | null; blocks: JsonRecord[] } {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return { cover: null, blocks: parsed as JsonRecord[] };
    if (parsed && typeof parsed === "object" && "blocks" in parsed) {
        const record = parsed as JsonRecord;
        return {
            cover: record.__meta && typeof record.__meta === "object"
                ? ((record.__meta as JsonRecord).cover as string | null | undefined) ?? null
                : null,
            blocks: Array.isArray(record.blocks) ? record.blocks as JsonRecord[] : [],
        };
    }
    throw new Error("Saved view blocksJson did not contain a block array");
}

function normalizeBlockForComparison(block: unknown): JsonRecord {
    return JSON.parse(JSON.stringify(block)) as JsonRecord;
}

function normalizeBlocksForComparison(blocks: readonly unknown[]): JsonRecord[] {
    return blocks.map((block, index) => {
        const normalized = normalizeBlockForComparison(block);
        // VIEW_TEMPLATES is evaluated in the Playwright and Next processes
        // separately, so its generated IDs cannot be compared across them.
        if (typeof normalized.id === "string") normalized.id = `block-${index}`;
        return normalized;
    });
}

async function readView(page: Page, viewId: string): Promise<{ view: JsonRecord; blocks: JsonRecord[]; cover: string | null }> {
    const response = await page.request.get(`/api/saved-views/${viewId}`);
    expect(response.status()).toBe(200);
    const view = await response.json() as JsonRecord;
    expect(typeof view.blocksJson).toBe("string");
    const decoded = decodeBlocks(view.blocksJson as string);
    expect(decoded.blocks.length).toBeGreaterThan(0);
    expect(new Set(decoded.blocks.map((block) => block.id)).size).toBe(decoded.blocks.length);
    return { view, blocks: decoded.blocks, cover: decoded.cover };
}

async function cleanupOwnedView(page: Page, viewId: string): Promise<void> {
    const deleted = await page.request.delete(`/api/saved-views/${viewId}`);
    expect(deleted.status()).toBe(200);
    const readBack = await page.request.get(`/api/saved-views/${viewId}`);
    expect(readBack.status()).toBe(404);
}

async function cleanupOwnedViewsInDatabase(viewIds: readonly string[], actorId: string): Promise<void> {
    const ids = Array.from(new Set(viewIds));
    if (ids.length === 0) return;
    await withPmoPrisma(async (prisma) => {
        await prisma.savedViewVote.deleteMany({ where: { viewId: { in: ids } } });
        await prisma.auditLog.deleteMany({ where: { entityType: "saved_view", entityId: { in: ids }, actorId } });
        await prisma.savedView.deleteMany({ where: { id: { in: ids }, ownerId: actorId } });
    });
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForViewReady(page: Page, viewName: string): Promise<void> {
    await expect(page.getByRole("heading", { name: viewName, exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText("Loading tasks…", { exact: true })).toHaveCount(0, { timeout: 30_000 });
}

async function chooseTheme(page: Page, theme: "light" | "dark"): Promise<void> {
    await page.getByRole("button", { name: "Change theme" }).click();
    await page.getByRole("menuitem", { name: new RegExp(`^${theme}`, "i") }).click();
    await expect.poll(async () => page.evaluate(() => document.documentElement.className)).toContain(theme);
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("theme"))).toBe(theme);
}

async function scrollPageToTop(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.scrollTo(0, 0);
        document.querySelector<HTMLElement>("main")?.scrollTo(0, 0);
    });
}

async function readLayoutMetrics(page: Page): Promise<JsonRecord> {
    return page.evaluate(() => {
        const describe = (element: HTMLElement) => {
            const style = window.getComputedStyle(element);
            return {
                tag: element.tagName.toLowerCase(),
                id: element.id || null,
                ariaLabel: element.getAttribute("aria-label"),
                className: typeof element.className === "string" ? element.className : "",
                scrollTop: element.scrollTop,
                scrollHeight: element.scrollHeight,
                clientHeight: element.clientHeight,
                scrollWidth: element.scrollWidth,
                clientWidth: element.clientWidth,
                overflowY: style.overflowY,
                overflowX: style.overflowX,
            };
        };
        const internalScrollables = Array.from(document.querySelectorAll<HTMLElement>("*"))
            .filter((element) => element !== document.documentElement && element !== document.body)
            .filter((element) => {
                const style = window.getComputedStyle(element);
                return element.scrollHeight > element.clientHeight + 4 && ["auto", "scroll"].includes(style.overflowY);
            })
            .slice(0, 25)
            .map(describe);
        return {
            viewport: { width: window.innerWidth, height: window.innerHeight, scrollY: window.scrollY },
            root: describe(document.documentElement),
            body: describe(document.body),
            internalScrollables,
        };
    });
}

async function captureBoundedScrollEvidence(
    page: Page,
    viewName: string,
    templateId: string,
    lowerKind: "task" | "chart" | "sabah",
    evidence: EvidenceRecord,
): Promise<void> {
    for (const viewport of [
        { label: "desktop", width: 1440, height: 1000 },
        { label: "mobile", width: 390, height: 844 },
    ]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        for (const theme of ["light", "dark"] as const) {
            await chooseTheme(page, theme);
            await waitForViewReady(page, viewName);
            await scrollPageToTop(page);
            await page.waitForTimeout(50);
            await assertNoPageOverflow(page);

            if (templateId === "sabah-workspace") {
                await expect(page.locator('[data-testid^="sabah-workspace-"]').first()).toBeVisible();
                await expect(page.getByText("Live work context", { exact: true })).toBeVisible();
            } else if (templateId === "project-war-room") {
                await expect(page.getByText("Active projects", { exact: true })).toBeVisible();
                await expect(page.getByText("Overdue", { exact: true }).first()).toBeVisible();
                await expect(page.getByText("Done this week", { exact: true })).toBeVisible();
            } else if (templateId === "daily-standup") {
                await expect(page.getByText("My open tasks", { exact: true })).toBeVisible();
                await expect(page.getByText("Due today", { exact: true })).toBeVisible();
            } else if (templateId === "team-okrs") {
                await expect(page.getByText("On-track KPIs", { exact: true })).toBeVisible();
                await expect(page.getByText("Need attention", { exact: true })).toBeVisible();
            } else if (templateId === "weekly-report") {
                await expect(page.getByRole("heading", { name: "Completion trend", exact: true })).toBeVisible();
                await expect(page.getByRole("heading", { name: "By project", exact: true })).toBeVisible();
            } else {
                await expect(page.getByText("Done this week", { exact: true })).toBeVisible();
                await expect(page.getByText("Team overdue", { exact: true })).toBeVisible();
            }

            const topMetrics = await readLayoutMetrics(page);
            const topPath = path.join(EVIDENCE_ROOT, `${templateId}-bounded-${viewport.label}-${theme}-top.png`);
            await page.screenshot({ path: topPath, fullPage: false });
            evidence.screenshots.push(topPath);
            evidence.layoutMetrics.push({ templateId, viewport: viewport.label, theme, capture: "top", metrics: topMetrics });

            let lowerMetrics: JsonRecord;
            if (lowerKind === "sabah") {
                await expect(page.locator('[data-testid^="sabah-workspace-"]').first()).toBeVisible();
                await expect(page.locator('[data-testid^="sabah-live-context-"]').first()).toBeVisible();
            } else if (lowerKind === "task") {
                const taskSections = page.locator('section[aria-label="Task view"]');
                const section = templateId === "project-war-room" ? taskSections.first() : taskSections.last();
                await expect(section).toBeVisible();
                const loadedLabel = section.getByText(/\d+ loaded of \d+ matching tasks/).first();
                await expect(loadedLabel).toBeVisible();
                const firstTask = section.getByRole("link").first();
                await expect(firstTask).toBeVisible();
                await firstTask.evaluate((element) => element.scrollIntoView({ block: "start", inline: "nearest" }));
                await expect(firstTask).toBeVisible();
            } else {
                const chartHeading = page.getByRole("heading", { name: "Completion trend — last 14 days", exact: true }).first();
                await expect(chartHeading).toBeVisible();
                await chartHeading.evaluate((element) => element.scrollIntoView({ block: "start", inline: "nearest" }));
                await expect(chartHeading).toBeVisible();
            }
            lowerMetrics = await readLayoutMetrics(page);
            const lowerPath = path.join(EVIDENCE_ROOT, `${templateId}-bounded-${viewport.label}-${theme}-lower.png`);
            await page.screenshot({ path: lowerPath, fullPage: false });
            evidence.screenshots.push(lowerPath);
            evidence.layoutMetrics.push({ templateId, viewport: viewport.label, theme, capture: "lower", lowerKind, metrics: lowerMetrics });
        }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await chooseTheme(page, "light");
    await scrollPageToTop(page);
    await expect(page.getByRole("heading", { name: viewName, exact: true })).toBeVisible();
    await assertNoPageOverflow(page);
}

function rawBlockValue(block: JsonRecord, key: string): unknown {
    const filters = block.filters;
    const legacy = filters && typeof filters === "object" ? filters as JsonRecord : undefined;
    return block[key] ?? legacy?.[key];
}

function valuesFor(block: JsonRecord, key: string): string[] {
    const value = rawBlockValue(block, key);
    const flatten = (item: unknown): string[] => {
        if (Array.isArray(item)) return item.flatMap(flatten);
        if (typeof item === "string") return item.split(",").map((part) => part.trim()).filter(Boolean);
        return [];
    };
    return Array.from(new Set(flatten(value)));
}

function scalarFor(block: JsonRecord, key: string): string | undefined {
    const value = rawBlockValue(block, key);
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function configuredProjectId(block: JsonRecord): string | undefined {
    const projectId = scalarFor(block, "projectId");
    if (projectId) return projectId;
    const projectIds = valuesFor(block, "projectIds");
    return projectIds.length === 1 ? projectIds[0] : undefined;
}

const TASK_AGGREGATE_KEYS = [
    "assigneeIds",
    "priority",
    "dueRange",
    "dueAfter",
    "dueBefore",
    "status",
    "tagIds",
    "projectId",
    "projectIds",
    "workspaceId",
    "search",
    "includeArchived",
] as const;

function aggregateUrl(block: JsonRecord): string {
    const params = new URLSearchParams();
    const metric = scalarFor(block, "metric");
    const chartKind = scalarFor(block, "chartKind");
    if (metric) params.set("metric", metric);
    else if (chartKind) params.set("chartKind", chartKind);
    else throw new Error("Aggregate block has neither metric nor chartKind");

    const selector = metric ?? chartKind ?? "";
    const taskScoped = selector.startsWith("my-") || selector.startsWith("team-") || selector.startsWith("task-");
    if (taskScoped) {
        for (const key of TASK_AGGREGATE_KEYS) {
            const values = valuesFor(block, key);
            for (const value of values) params.append(key, value);
        }
    }
    return `/api/views/aggregate?${params.toString()}`;
}

function taskViewUrl(block: JsonRecord, offset = 0): string {
    const params = new URLSearchParams();
    for (const key of ["status", "priority", "assigneeIds", "tagIds", "projectIds"] as const) {
        for (const value of valuesFor(block, key)) params.append(key, value);
    }
    for (const key of ["projectId", "workspaceId", "search", "dueRange", "dueAfter", "dueBefore", "sortBy", "groupBy"] as const) {
        const value = scalarFor(block, key);
        if (value) params.set(key, value);
    }
    const includeArchived = rawBlockValue(block, "includeArchived");
    if (typeof includeArchived === "boolean" || typeof includeArchived === "string") params.set("includeArchived", String(includeArchived));
    const sortDir = scalarFor(block, "sortDir") ?? scalarFor(block, "dir");
    if (sortDir) params.set("sortDir", sortDir);
    params.set("offset", String(offset));
    return `/api/tasks/view-data?${params.toString()}`;
}

function canonicalQueryUrl(rawUrl: string): string {
    const url = new URL(rawUrl, "http://localhost");
    const entries = Array.from(url.searchParams.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
    const query = new URLSearchParams(entries).toString();
    return `${url.pathname}${query ? `?${query}` : ""}`;
}

function expectedRenderedQueryUrls(blocks: JsonRecord[]): { aggregate: string[]; task: string[] } {
    const taskBlocks = renderedTaskBlocks(blocks);
    return {
        aggregate: blocks
            .filter((block) => block.type === "statTile" || block.type === "chart")
            .map((block) => canonicalQueryUrl(aggregateUrl(block))),
        task: taskBlocks
            .filter((block) => block.projectSelectionRequired !== true || Boolean(configuredProjectId(block)))
            .map((block) => canonicalQueryUrl(taskViewUrl(block))),
    };
}

function renderedTaskBlocks(blocks: JsonRecord[]): JsonRecord[] {
    const taskBlocks = blocks.filter((block) => block.type === "taskView");
    const assistant = blocks.find((block) => block.type === "assistantWorkspace" && block.assistantLayout !== "focused");
    if (assistant) {
        taskBlocks.push({
            id: "sabah-live-context",
            type: "taskView",
            viewType: "board",
            assigneeIds: ["@me"],
            dueRange: "this-week",
            groupBy: "priority",
            sortBy: "priority",
            sortDir: "desc",
        });
    }
    return taskBlocks;
}

async function captureRenderedQueryUrls(
    page: Page,
    viewName: string,
    blocks: JsonRecord[],
    evidence: EvidenceRecord,
): Promise<string[]> {
    const expected = expectedRenderedQueryUrls(blocks);
    const expectedAll = [...expected.aggregate, ...expected.task];
    const requests: string[] = [];
    const listener = (request: import("@playwright/test").Request) => {
        const url = new URL(request.url());
        if (url.pathname === "/api/tasks/view-data" || url.pathname === "/api/views/aggregate") requests.push(request.url());
    };
    page.on("request", listener);
    try {
        await page.reload();
        await waitForViewReady(page, viewName);
        if (expectedAll.length > 0) {
            await expect.poll(() => requests.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(expectedAll.length);
        }
    } finally {
        page.off("request", listener);
    }

    const actual = requests.map(canonicalQueryUrl);
    const remaining = [...actual];
    for (const expectedUrl of expectedAll) {
        const index = remaining.indexOf(expectedUrl);
        expect(index, `Rendered query was not observed: ${expectedUrl}`).toBeGreaterThanOrEqual(0);
        if (index >= 0) remaining.splice(index, 1);
    }
    evidence.renderedQueryUrls.push(...actual);
    return actual;
}

async function compareAggregates(page: Page, blocks: JsonRecord[], evidence: EvidenceRecord): Promise<void> {
    for (const block of blocks.filter((candidate) => candidate.type === "statTile" || candidate.type === "chart")) {
        const url = aggregateUrl(block);
        const response = await page.request.get(url);
        expect(response.status(), `${block.type} ${url}`).toBe(200);
        const payload = await response.json() as JsonRecord;
        expect(payload.timeZone).toBe("Asia/Riyadh");
        expect(Number.isInteger(payload.totalCount)).toBe(true);

        if (block.type === "statTile") {
            const label = String(block.label ?? block.metric ?? "Metric");
            const tile = page.locator("div.rounded-xl.border.bg-gradient-to-br").filter({ hasText: label }).first();
            await expect(tile.getByRole("status").first()).toHaveText(String(payload.value));
            evidence.aggregateComparisons.push({ type: "metric", label, url, api: payload, displayed: String(payload.value) });
        } else {
            const title = String(block.title ?? "Chart");
            const chart = page.getByRole("heading", { name: title, exact: true }).first().locator("..");
            const rows = await chart.locator("table tbody tr").evaluateAll((elements) => elements.map((row) => {
                const cells = Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim() ?? "");
                return { label: cells[0], value: Number(cells[1]) };
            }));
            const points = Array.isArray(payload.points) ? payload.points as JsonRecord[] : [];
            expect(rows).toEqual(points.map((point) => ({ label: point.label, value: point.value })));
            await expect(chart.getByText(String(payload.totalCount), { exact: true }).first()).toBeVisible();
            evidence.aggregateComparisons.push({ type: "chart", title, url, api: payload, table: rows });
        }
    }
}

async function compareTaskViews(page: Page, blocks: JsonRecord[], evidence: EvidenceRecord): Promise<void> {
    const taskBlocks = renderedTaskBlocks(blocks).filter((block) => block.projectSelectionRequired !== true || Boolean(configuredProjectId(block)));
    const sections = page.locator('section[aria-label="Task view"]');
    expect(await sections.count()).toBe(taskBlocks.length);

    for (let index = 0; index < taskBlocks.length; index += 1) {
        const block = taskBlocks[index];
        const url = taskViewUrl(block);
        const response = await page.request.get(url);
        expect(response.status(), url).toBe(200);
        const payload = await response.json() as JsonRecord;
        const rows = Array.isArray(payload.rows) ? payload.rows as JsonRecord[] : [];
        const section = sections.nth(index);
        const loadedText = await section.getByText(/\d+ loaded of \d+ matching tasks/).first().textContent();
        const match = loadedText?.match(/(\d+) loaded of (\d+) matching tasks/);
        expect(match, `missing loaded count for ${url}`).not.toBeNull();
        expect(Number(match?.[1])).toBe(rows.length);
        expect(Number(match?.[2])).toBe(payload.totalCount);
        const projectId = configuredProjectId(block);
        if (projectId) {
            expect(rows.length, `configured project query returned no visible rows: ${url}`).toBeGreaterThan(0);
            expect(rows.every((row) => {
                const project = row.project;
                return project && typeof project === "object" && (project as JsonRecord).id === projectId;
            })).toBe(true);
        }
        if (rows[0]?.title) await expect(section.getByRole("link", { name: String(rows[0].title) }).first()).toBeVisible();
        const nextOffset = payload.nextOffset;
        if (nextOffset === null) {
            await expect(section.getByRole("button", { name: "Load more" })).toHaveCount(0);
        } else {
            await expect(section.getByRole("button", { name: "Load more" })).toBeVisible();
        }
        evidence.taskComparisons.push({
            url,
            api: { totalCount: payload.totalCount, rowCount: rows.length, nextOffset },
            displayed: loadedText,
            ...(projectId ? { projectFilter: projectId, returnedProjectIds: Array.from(new Set(rows.map((row) => ((row.project as JsonRecord | null)?.id ?? null)))) } : {}),
        });
    }
}

async function createTemplateView(
    page: Page,
    template: TemplateCase,
    ownedViewIds: Set<string>,
): Promise<{ id: string; name: string; initial: { view: JsonRecord; blocks: JsonRecord[]; cover: string | null } }> {
    await page.goto("/views/new");
    await expect(page.getByRole("heading", { name: "Create a view", exact: true })).toBeVisible();
    const card = page.getByRole("button", { name: new RegExp(escapeRegExp(template.name)) }).first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const name = `${template.name} — acceptance ${Date.now()}`;
    await page.getByLabel("Name").fill(name);
    const createResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === "POST" && url.pathname === "/api/saved-views";
    });
    await page.getByRole("button", { name: "Create view", exact: true }).click();
    const createResponse = await createResponsePromise;
    let createdPayload: JsonRecord | null = null;
    try {
        createdPayload = await createResponse.json() as JsonRecord;
    } catch {
        createdPayload = null;
    }
    const responseId = typeof createdPayload?.id === "string" ? createdPayload.id : null;
    if (responseId) ownedViewIds.add(responseId);
    expect(createResponse.status()).toBe(201);
    expect(responseId).toBeTruthy();
    await page.waitForURL(/\/views\/[^/]+\/edit$/, { timeout: 30_000 });
    const id = responseId as string;
    expect(new URL(page.url()).pathname.split("/")[2]).toBe(id);
    const initial = await readView(page, id);
    return { id, name, initial };
}

async function exerciseSaveReload(
    page: Page,
    viewId: string,
    viewName: string,
    template: TemplateCase,
    initialBlocks: JsonRecord[],
    selectedProjectId?: string,
): Promise<{ savedBlocks: JsonRecord[]; editedHeader: string }> {
    await page.getByRole("link", { name: "Preview", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(new RegExp(`/views/${escapeRegExp(viewId)}$`), { timeout: 30_000 });
    await waitForViewReady(page, viewName);

    const edit = page.getByRole("link", { name: "Edit", exact: true }).last();
    await edit.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(new RegExp(`/views/${escapeRegExp(viewId)}/edit$`), { timeout: 30_000 });

    const editedHeader = `${template.name} — saved browser acceptance`;
    const headerInput = page.locator('input[placeholder="Section title..."]').first();
    const hasHeader = await headerInput.count() > 0;
    if (hasHeader) {
        await expect(headerInput).toBeVisible();
        await headerInput.fill(editedHeader);
    }

    if (selectedProjectId) {
        const projectFilter = page.getByLabel("Project filter", { exact: true });
        await expect(projectFilter).toHaveCount(1);
        const projectOption = projectFilter.locator(`option[value="${selectedProjectId}"]`);
        await expect(projectOption).toHaveCount(1, { timeout: 30_000 });
        await expect(projectOption).toHaveText("E2E PMO Project");
        await projectFilter.selectOption(selectedProjectId);
        await expect(projectFilter).toHaveValue(selectedProjectId);
        await expect(page.getByText("Setup required: choose a project before this block can show tasks.", { exact: true })).toHaveCount(0);
    }

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForURL(new RegExp(`/views/${escapeRegExp(viewId)}$`), { timeout: 30_000 });
    await waitForViewReady(page, viewName);

    const afterSave = await readView(page, viewId);
    const firstHeaderIndex = initialBlocks.findIndex((block) => block.type === "header");
    const expectedBlocks = initialBlocks.map((block, index) => {
        const expected = { ...block };
        if (hasHeader && index === firstHeaderIndex) expected.content = editedHeader;
        if (selectedProjectId && block.type === "taskView" && block.projectSelectionRequired === true) {
            expected.projectId = selectedProjectId;
            expected.filters = {};
        }
        return expected;
    });
    expect(afterSave.blocks).toEqual(expectedBlocks);
    if (hasHeader) expect(afterSave.blocks.find((block) => block.type === "header")?.content).toBe(editedHeader);
    if (selectedProjectId) {
        const projectBlock = afterSave.blocks.find((block) => block.type === "taskView" && block.projectSelectionRequired === true);
        expect(projectBlock).toBeTruthy();
        expect(configuredProjectId(projectBlock ?? {})).toBe(selectedProjectId);
        expect(valuesFor(projectBlock ?? {}, "projectIds")).toEqual([]);
    }

    await page.reload();
    await waitForViewReady(page, viewName);
    if (hasHeader) await expect(page.getByText(editedHeader, { exact: true })).toBeVisible();

    if (selectedProjectId) {
        const reloadedEdit = page.getByRole("link", { name: "Edit", exact: true }).last();
        await reloadedEdit.focus();
        await page.keyboard.press("Enter");
        await page.waitForURL(new RegExp(`/views/${escapeRegExp(viewId)}/edit$`), { timeout: 30_000 });
        const reloadedProjectFilter = page.getByLabel("Project filter", { exact: true });
        await expect(reloadedProjectFilter.locator(`option[value="${selectedProjectId}"]`)).toHaveCount(1, { timeout: 30_000 });
        await expect(reloadedProjectFilter).toHaveValue(selectedProjectId);
        await page.getByRole("link", { name: "Preview", exact: true }).focus();
        await page.keyboard.press("Enter");
        await page.waitForURL(new RegExp(`/views/${escapeRegExp(viewId)}$`), { timeout: 30_000 });
        await waitForViewReady(page, viewName);
    }

    return { savedBlocks: afterSave.blocks, editedHeader };
}

async function observeChipRequest(page: Page, label: string, predicate: (url: URL) => boolean, evidence: EvidenceRecord): Promise<string> {
    const requests: string[] = [];
    const listener = (request: import("@playwright/test").Request) => {
        const url = new URL(request.url());
        if (url.pathname === "/api/tasks/view-data" || url.pathname === "/api/views/aggregate") requests.push(request.url());
    };
    page.on("request", listener);
    try {
        const chip = page.getByRole("button", { name: label, exact: true });
        await chip.click();
        await expect.poll(() => requests.length, { timeout: 15_000 }).toBeGreaterThan(0);
    } finally {
        page.off("request", listener);
    }
    const matching = requests.map((raw) => new URL(raw)).find(predicate);
    expect(matching, `${label} did not produce the expected scoped request`).toBeTruthy();
    const raw = matching?.toString() ?? requests[0];
    evidence.chipRequests.push(raw);
    return raw;
}

async function exerciseChips(page: Page, viewId: string, viewName: string, evidence: EvidenceRecord): Promise<void> {
    const saved = await readView(page, viewId);
    const savedJson = saved.view.blocksJson;

    await page.reload();
    await waitForViewReady(page, viewName);
    const meUrl = await observeChipRequest(page, "Me", (url) => url.searchParams.getAll("assigneeIds").includes("@me"), evidence);
    expect(new URL(meUrl).searchParams.getAll("assigneeIds")).toContain("@me");
    expect((await readView(page, viewId)).view.blocksJson).toBe(savedJson);

    await page.reload();
    await waitForViewReady(page, viewName);
    const highUrl = await observeChipRequest(page, "High Priority", (url) => url.searchParams.getAll("priority").some((value) => value === "HIGH" || value === "URGENT"), evidence);
    expect(new URL(highUrl).searchParams.getAll("priority")).toEqual(expect.arrayContaining(["HIGH", "URGENT"]));
    expect((await readView(page, viewId)).view.blocksJson).toBe(savedJson);

    await page.reload();
    await waitForViewReady(page, viewName);
    const overdueUrl = await observeChipRequest(page, "Overdue", (url) => url.searchParams.get("dueRange") === "overdue" || url.searchParams.has("dueBefore"), evidence);
    expect(new URL(overdueUrl).searchParams.get("dueRange") === "overdue" || new URL(overdueUrl).searchParams.has("dueBefore")).toBe(true);
    expect((await readView(page, viewId)).view.blocksJson).toBe(savedJson);

    await page.reload();
    await waitForViewReady(page, viewName);
    const thisWeekUrl = await observeChipRequest(page, "This Week", (url) => url.searchParams.get("dueRange") === "this-week" || (url.searchParams.has("dueAfter") && url.searchParams.has("dueBefore")), evidence);
    expect(new URL(thisWeekUrl).searchParams.get("dueRange") === "this-week" || (new URL(thisWeekUrl).searchParams.has("dueAfter") && new URL(thisWeekUrl).searchParams.has("dueBefore"))).toBe(true);
    expect((await readView(page, viewId)).view.blocksJson).toBe(savedJson);

    await page.reload();
    await waitForViewReady(page, viewName);
    const overdue = page.getByRole("button", { name: "Overdue", exact: true });
    const thisWeek = page.getByRole("button", { name: "This Week", exact: true });
    await overdue.click();
    await expect(overdue).toHaveAttribute("aria-pressed", "true");
    await thisWeek.click();
    await expect(overdue).toHaveAttribute("aria-pressed", "false");
    await expect(thisWeek).toHaveAttribute("aria-pressed", "true");
    expect((await readView(page, viewId)).view.blocksJson).toBe(savedJson);

    await page.reload();
    await waitForViewReady(page, viewName);
    const keyboardMe = page.getByRole("button", { name: "Me", exact: true });
    await keyboardMe.focus();
    await page.keyboard.press("Enter");
    await expect(keyboardMe).toHaveAttribute("aria-pressed", "true");
    await keyboardMe.focus();
    await page.keyboard.press("Space");
    await expect(keyboardMe).toHaveAttribute("aria-pressed", "false");
    expect((await readView(page, viewId)).view.blocksJson).toBe(savedJson);
    evidence.chipRequests.push("keyboard:Me:Enter+Space");
}

async function exerciseInjectedErrorsAndZero(page: Page, viewId: string, viewName: string, evidence: EvidenceRecord): Promise<void> {
    let failDoneMode = true;
    let zeroMode = true;
    const aggregateRoute = "**/api/views/aggregate**";
    await page.route(aggregateRoute, async (route) => {
        const url = new URL(route.request().url());
        const metric = url.searchParams.get("metric");
        if (metric === "team-done-week" && failDoneMode) {
            await route.abort("failed");
            return;
        }
        if (metric === "team-overdue" && zeroMode) {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ kind: "metric", key: "team-overdue", scope: "task", value: 0, totalCount: 0, timeZone: "Asia/Riyadh" }),
            });
            return;
        }
        await route.continue();
    });

    await page.goto(`/views/${viewId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: viewName, exact: true })).toBeVisible({ timeout: 30_000 });
    const aggregateAlert = page.getByRole("alert").filter({ hasText: "Could not load Done this week" });
    await expect(aggregateAlert).toBeVisible({ timeout: 30_000 });
    const aggregateErrorScreenshot = path.join(EVIDENCE_ROOT, "executive-dashboard-injected-aggregate-error.png");
    await aggregateAlert.screenshot({ path: aggregateErrorScreenshot });
    evidence.screenshots.push(aggregateErrorScreenshot);
    const retry = aggregateAlert.getByRole("button", { name: "Retry" });
    failDoneMode = false;
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Done this week", { exact: true }).locator("..").getByRole("status")).toHaveText(/\d+/);

    const zeroTile = page.getByText("Team overdue", { exact: true }).locator("..");
    await expect(zeroTile.getByRole("status")).toHaveText("0");
    const zeroScreenshot = path.join(EVIDENCE_ROOT, "executive-dashboard-injected-zero.png");
    await zeroTile.screenshot({ path: zeroScreenshot });
    evidence.screenshots.push(zeroScreenshot);
    zeroMode = false;
    evidence.injectedFlows.push({ type: "aggregate-error-retry", injection: "page.route abort once for metric=team-done-week", recovered: true });
    evidence.injectedFlows.push({ type: "numeric-zero", injection: "page.route fulfills valid metric=team-overdue zero contract", displayed: "0" });
    await page.unroute(aggregateRoute);

    let failTaskOnce = true;
    const taskRoute = "**/api/tasks/view-data**";
    await page.route(taskRoute, async (route) => {
        if (failTaskOnce) {
            await route.abort("failed");
            return;
        }
        await route.continue();
    });
    await page.goto(`/views/${viewId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: viewName, exact: true })).toBeVisible({ timeout: 30_000 });
    const taskAlert = page.getByRole("alert").filter({ hasText: "Could not load tasks" }).first();
    await expect(taskAlert).toBeVisible({ timeout: 30_000 });
    const taskErrorScreenshot = path.join(EVIDENCE_ROOT, "executive-dashboard-injected-task-error.png");
    await taskAlert.screenshot({ path: taskErrorScreenshot });
    evidence.screenshots.push(taskErrorScreenshot);
    const taskRetry = taskAlert.getByRole("button", { name: "Retry" });
    failTaskOnce = false;
    await taskRetry.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(/\d+ loaded of \d+ matching tasks/).first()).toBeVisible({ timeout: 30_000 });
    evidence.injectedFlows.push({ type: "task-error-retry", injection: "page.route abort once for /api/tasks/view-data", recovered: true });
    await page.unroute(taskRoute);

    await page.goto(`/views/${viewId}`);
    await waitForViewReady(page, viewName);
}

async function exercisePagination(page: Page, viewId: string, viewName: string, fixture: FixtureMetadata, evidence: EvidenceRecord): Promise<void> {
    const initialResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === "GET"
            && url.pathname === "/api/tasks/view-data"
            && Number(url.searchParams.get("offset") ?? "0") === 0;
    });
    await page.goto(`/views/${viewId}`);
    const initialResponse = await initialResponsePromise;
    expect(initialResponse.status()).toBe(200);
    const initialPayload = await initialResponse.json() as JsonRecord;
    await waitForViewReady(page, viewName);

    const section = page.locator('section[aria-label="Task view"]').last();
    const loadedLabel = section.getByText(/\d+ loaded of \d+ matching tasks/).first();
    await expect(loadedLabel).toBeVisible();
    const readRenderedTaskIds = async (): Promise<string[]> => section.getByRole("link").evaluateAll((links) => links.map((link) => {
        const href = link.getAttribute("href");
        if (!href) throw new Error("Rendered task link has no href");
        const pathname = new URL(href, window.location.origin).pathname;
        const match = pathname.match(/^\/tasks\/([^/]+)$/);
        if (!match) throw new Error(`Unexpected rendered task link: ${pathname}`);
        return decodeURIComponent(match[1]);
    }));
    const readPayloadRows = (payload: JsonRecord): string[] => {
        if (!Array.isArray(payload.rows)) throw new Error("Pagination response did not contain rows");
        return payload.rows.map((row) => {
            if (!row || typeof row !== "object" || typeof (row as JsonRecord).id !== "string") {
                throw new Error("Pagination response contained a row without an ID");
            }
            return (row as JsonRecord).id as string;
        });
    };

    const apiPages: Array<{ offset: number; payload: JsonRecord }> = [{ offset: 0, payload: initialPayload }];
    const renderedTaskIdsByPage: string[][] = [await readRenderedTaskIds()];
    const counts: string[] = [];
    let loadMoreClicks = 0;
    while (await section.getByRole("button", { name: "Load more" }).count() > 0) {
        const current = await loadedLabel.textContent();
        counts.push(current ?? "");
        const previous = apiPages[apiPages.length - 1].payload.nextOffset;
        expect(typeof previous).toBe("number");
        const nextOffset = previous as number;
        const responsePromise = page.waitForResponse((response) => {
            const url = new URL(response.url());
            return response.request().method() === "GET"
                && url.pathname === "/api/tasks/view-data"
                && Number(url.searchParams.get("offset") ?? "-1") === nextOffset;
        });
        await section.getByRole("button", { name: "Load more" }).click();
        loadMoreClicks += 1;
        const response = await responsePromise;
        expect(response.status()).toBe(200);
        const payload = await response.json() as JsonRecord;
        await expect.poll(async () => loadedLabel.textContent()).not.toBe(current);
        apiPages.push({ offset: nextOffset, payload });
        renderedTaskIdsByPage.push(await readRenderedTaskIds());
        if (loadMoreClicks > 3) throw new Error("Pagination did not exhaust within three pages");
    }

    const after = await loadedLabel.textContent();
    expect(after).toMatch(new RegExp(`${fixture.count} loaded of ${fixture.count} matching tasks`));
    await expect(section.getByRole("button", { name: "Load more" })).toHaveCount(0);
    const apiTaskIds = apiPages.flatMap(({ payload }) => readPayloadRows(payload));
    const renderedTaskIds = renderedTaskIdsByPage[renderedTaskIdsByPage.length - 1];
    expect(apiPages.every(({ payload }) => payload.totalCount === fixture.count)).toBe(true);
    expect(apiPages[apiPages.length - 1].payload.nextOffset).toBeNull();
    expect(new Set(apiTaskIds).size).toBe(fixture.count);
    expect([...apiTaskIds].sort()).toEqual([...fixture.taskIds].sort());
    expect(new Set(renderedTaskIds).size).toBe(fixture.count);
    expect(renderedTaskIds).toEqual(apiTaskIds);
    evidence.taskComparisons.push({
        type: "pagination",
        fixtureCount: fixture.count,
        pages: counts.concat(after ?? ""),
        loadMoreClicks,
        apiOffsets: apiPages.map(({ offset }) => offset),
        expectedServerTaskIds: apiTaskIds,
        renderedTaskIds,
        renderedUniqueCount: new Set(renderedTaskIds).size,
        renderedOrderMatchesServer: true,
    });
}

async function attachDiagnostics(page: Page): Promise<RuntimeDiagnostics> {
    const diagnostics: RuntimeDiagnostics = {
        consoleErrors: [],
        pageErrors: [],
        requestFailures: [],
        navigationRequestFailures: [],
        nonNavigationRequestFailures: [],
        preSteadyStateRequestFailures: [],
        steadyStateRequestFailures: [],
    };
    page.on("console", (message) => {
        if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
        const failure = `${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "unknown"}`;
        diagnostics.requestFailures.push(failure);
        if (request.isNavigationRequest()) diagnostics.navigationRequestFailures.push(failure);
        else diagnostics.nonNavigationRequestFailures.push(failure);
    });
    return diagnostics;
}

async function captureSteadyStateDiagnostics(page: Page, diagnostics: RuntimeDiagnostics): Promise<void> {
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    const beforeProbe = diagnostics.requestFailures.length;
    const startedAt = Date.now();
    const probe = await page.evaluate(async () => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 3_000);
        try {
            const response = await fetch("/api/views/aggregate?metric=active-projects", { cache: "no-store", signal: controller.signal });
            return { status: response.status, ok: response.ok };
        } catch (error: unknown) {
            return { status: 0, ok: false, error: error instanceof Error ? error.message : String(error) };
        } finally {
            window.clearTimeout(timer);
        }
    }) as JsonRecord;
    await page.waitForTimeout(750);
    diagnostics.preSteadyStateRequestFailures = diagnostics.requestFailures.slice(0, beforeProbe);
    diagnostics.steadyStateRequestFailures = diagnostics.requestFailures.slice(beforeProbe);
    diagnostics.steadyStateProbe = {
        endpoint: "/api/views/aggregate?metric=active-projects",
        maxRequestMs: 3_000,
        settleWindowMs: 750,
        elapsedMs: Date.now() - startedAt,
        response: probe,
        requestFailuresObserved: diagnostics.steadyStateRequestFailures.length,
    };
}

async function readCleanupState(fixture: FixtureMetadata, viewIds: readonly string[]): Promise<JsonRecord> {
    const ids = Array.from(new Set(viewIds));
    return withPmoPrisma(async (prisma) => {
        const [tasks, views, actor, projectMembers, departmentMembers, rateLimits] = await Promise.all([
            prisma.task.findMany({ where: { id: { in: fixture.taskIds } }, select: { id: true } }),
            prisma.savedView.findMany({ where: { id: { in: ids } }, select: { id: true } }),
            prisma.user.findUnique({ where: { id: fixture.actorId }, select: { id: true } }),
            prisma.projectMember.findMany({ where: { projectId: fixture.projectId, userId: fixture.actorId }, select: { id: true } }),
            prisma.userDepartment.findMany({ where: { departmentId: fixture.departmentId, userId: fixture.actorId }, select: { id: true } }),
            prisma.rateLimitEntry.findMany({ where: { key: { startsWith: `login:${fixture.actorEmail}` } }, select: { id: true } }),
        ]);
        return {
            runId: fixture.runId,
            fixtureTaskIds: fixture.taskIds,
            fixtureTasksRemaining: tasks.map(({ id }) => id),
            acceptanceViewIds: ids,
            acceptanceViewsRemaining: views.map(({ id }) => id),
            actorRemaining: Boolean(actor),
            projectMembershipsRemaining: projectMembers.length,
            departmentMembershipsRemaining: departmentMembers.length,
            rateLimitRowsRemaining: rateLimits.length,
        };
    });
}

test.describe.serial("View template browser acceptance", () => {
    test.setTimeout(120_000);
    let fixture: FixtureMetadata | undefined;
    const ownedViewIds = new Set<string>();
    const allRunViewIds = new Set<string>();

    test.beforeAll(async () => {
        fixture = await preparePaginationFixture();
        expect(fixture.count).toBe(FIXTURE_COUNT);
    });

    test.afterAll(async () => {
        if (!fixture) return;
        const activeFixture = fixture;
        const viewIds = Array.from(new Set([...Array.from(allRunViewIds), ...Array.from(ownedViewIds)]));
        const cleanupErrors: unknown[] = [];
        try {
            await cleanupOwnedViewsInDatabase(Array.from(ownedViewIds), activeFixture.actorId);
            ownedViewIds.clear();
        } catch (error) {
            cleanupErrors.push(error);
        }
        try {
            await cleanupPaginationFixture(activeFixture, viewIds);
        } catch (error) {
            cleanupErrors.push(error);
        }
        try {
            writeEvidence("cleanup-readback.json", await readCleanupState(activeFixture, viewIds));
        } catch (error) {
            cleanupErrors.push(error);
        }
        if (cleanupErrors.length > 0) {
            throw new AggregateError(cleanupErrors, "Acceptance cleanup did not complete cleanly");
        }
    });

    for (const template of TEMPLATE_CASES) {
        test(`${template.name}: creates, saves, reloads, filters, aggregates, and renders evidence`, async ({ page }) => {
            const activeFixture = fixture;
            if (!activeFixture) throw new Error("Pagination fixture was not prepared");
            const diagnostics = await attachDiagnostics(page);
            const evidence: EvidenceRecord = {
                templateId: template.id,
                templateName: template.name,
                origin: "",
                actor: activeFixture.actorEmail,
                fixture: activeFixture,
                screenshots: [],
                layoutMetrics: [],
                renderedQueryUrls: [],
                aggregateComparisons: [],
                taskComparisons: [],
                chipRequests: [],
                injectedFlows: [],
            };
            let cleanupError: unknown;
            try {
                await loginAsEmail(page, activeFixture.actorEmail);
                await captureOwnedRateLimitEntries(activeFixture);
                evidence.origin = new URL(page.url()).origin;

                const created = await createTemplateView(page, template, ownedViewIds);
                allRunViewIds.add(created.id);
                evidence.viewId = created.id;
                evidence.viewName = created.name;

                expect(normalizeBlocksForComparison(created.initial.blocks)).toEqual(normalizeBlocksForComparison(template.blocks));
                expect(created.initial.cover).toBe(template.cover || null);
                const taskBlocks = created.initial.blocks.filter((block) => block.type === "taskView");
                if (template.id === "daily-standup") {
                    expect(taskBlocks.some((block) => valuesFor(block, "assigneeIds").includes("@me"))).toBe(true);
                    expect(taskBlocks.some((block) => scalarFor(block, "dueRange") === "today")).toBe(true);
                    expect(taskBlocks.some((block) => scalarFor(block, "dueRange") === "this-week")).toBe(true);
                }
                if (template.id === "project-war-room") {
                    const projectBlock = taskBlocks.find((block) => block.projectSelectionRequired === true);
                    expect(projectBlock).toBeTruthy();
                    expect(rawBlockValue(projectBlock ?? {}, "projectId")).toBeUndefined();
                }

                const selectedProjectId = template.id === "project-war-room" ? PMO_IDS.project : undefined;
                const saved = await exerciseSaveReload(page, created.id, created.name, template, created.initial.blocks, selectedProjectId);
                if (selectedProjectId) {
                    const projectBlock = saved.savedBlocks.find((block) => block.type === "taskView" && block.projectSelectionRequired === true);
                    evidence.projectSelection = {
                        projectId: selectedProjectId,
                        projectName: "E2E PMO Project",
                        persistedBlock: projectBlock,
                        selectedThrough: "Task View editor Project filter",
                        editorReloadValueVerified: true,
                    };
                }
                evidence.origin = new URL(page.url()).origin;
                await waitForViewReady(page, created.name);
                await captureRenderedQueryUrls(page, created.name, saved.savedBlocks, evidence);
                await compareAggregates(page, saved.savedBlocks, evidence);
                await compareTaskViews(page, saved.savedBlocks, evidence);
                await captureBoundedScrollEvidence(
                    page,
                    created.name,
                    template.id,
                    template.id === "executive-dashboard" ? "chart" : template.id === "sabah-workspace" ? "sabah" : "task",
                    evidence,
                );
                await assertNoPageOverflow(page);

                if (template.id === "weekly-report") {
                    await exerciseChips(page, created.id, created.name, evidence);
                    await exercisePagination(page, created.id, created.name, activeFixture, evidence);
                }
                if (template.id === "executive-dashboard") {
                    await exerciseInjectedErrorsAndZero(page, created.id, created.name, evidence);
                }
                await captureSteadyStateDiagnostics(page, diagnostics);
                await writeEvidence(`${template.id}-evidence.json`, { ...evidence, diagnostics });
            } finally {
                try {
                    await cleanupOwnedViews(page, ownedViewIds);
                } catch (error) {
                    cleanupError = error;
                }
                try {
                    await captureOwnedRateLimitEntries(activeFixture);
                    await cleanupOwnedRateLimitEntries(activeFixture);
                } catch (error) {
                    cleanupError ??= error;
                }
                evidence.diagnostics = diagnostics;
                writeEvidence(`${template.id}-runtime.json`, diagnostics);
                if (cleanupError) throw cleanupError;
            }
        });
    }
});

async function cleanupOwnedViews(page: Page, ownedViewIds: Set<string>): Promise<void> {
    for (const viewId of Array.from(ownedViewIds)) {
        await cleanupOwnedView(page, viewId);
        ownedViewIds.delete(viewId);
    }
}

async function assertNoPageOverflow(page: Page): Promise<void> {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}
