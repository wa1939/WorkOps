import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { expect, test, type Page } from "@playwright/test";
import { assertLocalDatabaseUrl } from "../scripts/assert-local-database";
import { loginAsEmail } from "./helpers/auth";
import { PMO_IDS, PMO_PASSWORD, withPmoPrisma } from "./helpers/pmo";

const BASE_URL = "http://localhost:3015";
const EVIDENCE_ROOT = path.resolve(process.cwd(), ".superpowers/sdd/028-sabah-verified-repairs/browser-evidence");
const ARABIC_MARKDOWN_PROMPT = "اكتب تقرير متابعة Markdown بالعربية";
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

mkdirSync(EVIDENCE_ROOT, { recursive: true });

type Fixture = {
    runId: string;
    actorId: string;
    actorEmail: string;
    overdueTaskId: string;
    rateLimitEntryIds: Set<string>;
};

type RuntimeDiagnostics = {
    consoleErrors: string[];
    pageErrors: string[];
    requestFailures: string[];
};

type EvidenceRecord = {
    test: string;
    origin: string;
    actor: string;
    injectedAssertions: string[];
    screenshots: Array<{ path: string; state: unknown }>;
    observations: Record<string, unknown>;
    diagnostics?: RuntimeDiagnostics;
};

function writeEvidence(name: string, value: unknown): string {
    const target = path.join(EVIDENCE_ROOT, name);
    writeFileSync(target, JSON.stringify(value, null, 2), "utf8");
    return target;
}

function bounded(value: unknown, max = 320): string {
    return String(value).replace(/[\r\n]+/g, " ").slice(0, max);
}

function pathnameOf(rawUrl: string): string {
    try {
        return new URL(rawUrl).pathname;
    } catch {
        return "<invalid-url>";
    }
}

function attachDiagnostics(page: Page): RuntimeDiagnostics {
    const diagnostics: RuntimeDiagnostics = {
        consoleErrors: [],
        pageErrors: [],
        requestFailures: [],
    };
    page.on("console", (message) => {
        if (message.type() === "error" && diagnostics.consoleErrors.length < 40) {
            diagnostics.consoleErrors.push(bounded(message.text()));
        }
    });
    page.on("pageerror", (error) => {
        if (diagnostics.pageErrors.length < 40) diagnostics.pageErrors.push(bounded(error.message));
    });
    page.on("requestfailed", (request) => {
        if (diagnostics.requestFailures.length >= 80) return;
        diagnostics.requestFailures.push(`${request.method()} ${pathnameOf(request.url())} — ${bounded(request.failure()?.errorText ?? "unknown", 160)}`);
    });
    return diagnostics;
}

function newFixture(): Fixture {
    const runId = randomUUID();
    const namespace = `e2e-sabah-verified-repairs-${runId}`;
    return {
        runId,
        actorId: `${namespace}-actor`,
        actorEmail: `${namespace}@test.com`,
        overdueTaskId: `${namespace}-overdue-task`,
        rateLimitEntryIds: new Set(),
    };
}

async function captureOwnedRateLimitEntries(fixture: Fixture): Promise<void> {
    await withPmoPrisma(async (prisma) => {
        const rows = await prisma.rateLimitEntry.findMany({
            where: { key: { startsWith: `login:${fixture.actorEmail}` } },
            select: { id: true },
        });
        for (const row of rows) fixture.rateLimitEntryIds.add(row.id);
    });
}

async function readCleanupState(fixture: Fixture): Promise<Record<string, unknown>> {
    return withPmoPrisma(async (prisma) => {
        const [task, actor, departmentMembership, rateLimits, conversations] = await Promise.all([
            prisma.task.findUnique({ where: { id: fixture.overdueTaskId }, select: { id: true } }),
            prisma.user.findUnique({ where: { id: fixture.actorId }, select: { id: true } }),
            prisma.userDepartment.findMany({ where: { userId: fixture.actorId, departmentId: PMO_IDS.department }, select: { id: true } }),
            prisma.rateLimitEntry.findMany({ where: { id: { in: Array.from(fixture.rateLimitEntryIds) } }, select: { id: true } }),
            prisma.aiConversation.findMany({ where: { userId: fixture.actorId }, select: { id: true } }),
        ]);
        return {
            runId: fixture.runId,
            actorId: fixture.actorId,
            overdueTaskId: fixture.overdueTaskId,
            overdueTaskRemaining: Boolean(task),
            actorRemaining: Boolean(actor),
            departmentMembershipsRemaining: departmentMembership.length,
            ownedRateLimitRowsRemaining: rateLimits.map(({ id }) => id),
            ownedConversationsRemaining: conversations.map(({ id }) => id),
        };
    });
}

async function cleanupFixture(fixture: Fixture): Promise<Record<string, unknown>> {
    assertLocalDatabaseUrl(process.env.DATABASE_URL ?? "", { requireDatabaseSuffix: "_test" });
    await captureOwnedRateLimitEntries(fixture);
    await withPmoPrisma(async (prisma) => {
        const conversations = await prisma.aiConversation.findMany({ where: { userId: fixture.actorId }, select: { id: true } });
        const conversationIds = conversations.map(({ id }) => id);
        await prisma.notification.deleteMany({ where: { linkUrl: `/tasks/${fixture.overdueTaskId}#follow-up` } });
        await prisma.auditLog.deleteMany({ where: { taskId: fixture.overdueTaskId } });
        await prisma.taskAssignment.deleteMany({ where: { taskId: fixture.overdueTaskId } });
        await prisma.task.deleteMany({ where: { id: fixture.overdueTaskId } });
        if (conversationIds.length > 0) {
            await prisma.aiConversation.deleteMany({ where: { id: { in: conversationIds } } });
        }
        await prisma.userDepartment.deleteMany({ where: { userId: fixture.actorId, departmentId: PMO_IDS.department } });
        if (fixture.rateLimitEntryIds.size > 0) {
            await prisma.rateLimitEntry.deleteMany({ where: { id: { in: Array.from(fixture.rateLimitEntryIds) } } });
        }
        await prisma.user.deleteMany({ where: { id: fixture.actorId } });
    });
    return readCleanupState(fixture);
}

async function prepareFixture(): Promise<Fixture> {
    assertLocalDatabaseUrl(process.env.DATABASE_URL ?? "", { requireDatabaseSuffix: "_test" });
    const fixture = newFixture();
    await withPmoPrisma(async (prisma) => {
        const [actor, actorEmail, task] = await Promise.all([
            prisma.user.findUnique({ where: { id: fixture.actorId }, select: { id: true } }),
            prisma.user.findUnique({ where: { email: fixture.actorEmail }, select: { id: true } }),
            prisma.task.findUnique({ where: { id: fixture.overdueTaskId }, select: { id: true } }),
        ]);
        if (actor || actorEmail || task) throw new Error(`Refusing Sabah acceptance fixture collision for run ${fixture.runId}`);
    });

    try {
        const password = await bcrypt.hash(PMO_PASSWORD, 10);
        await withPmoPrisma(async (prisma) => {
            await prisma.user.create({
                data: {
                    id: fixture.actorId,
                    email: fixture.actorEmail,
                    name: `E2E Sabah Verified Repairs ${fixture.runId}`,
                    password,
                    emailVerified: new Date(),
                    role: "MEMBER",
                    isActive: true,
                },
            });
            await prisma.userDepartment.create({ data: { userId: fixture.actorId, departmentId: PMO_IDS.department } });
            await prisma.task.create({
                data: {
                    id: fixture.overdueTaskId,
                    title: `E2E Sabah overdue fixture ${fixture.runId}`,
                    dueAt: new Date("2020-01-01T00:00:00.000Z"),
                    createdById: fixture.actorId,
                    assignments: { create: [{ userId: fixture.actorId }] },
                },
            });
        });
        return fixture;
    } catch (error) {
        try {
            await cleanupFixture(fixture);
        } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], "Sabah fixture creation and exact cleanup both failed");
        }
        throw error;
    }
}

async function configurePage(page: Page, options: { installEligible: boolean; dismissOverdue?: boolean }): Promise<void> {
    await page.setViewportSize({ width: 754, height: 480 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
    await page.addInitScript(({ installEligible, dismissOverdue }) => {
        Object.defineProperty(window, "onbeforeinstallprompt", {
            configurable: true,
            writable: true,
            value: null,
        });
        if (!installEligible) {
            window.localStorage.setItem("pwa-install-dismissed", "true");
        } else if (!window.sessionStorage.getItem("e2e-sabah-install-seeded")) {
            // Seed eligibility once per isolated browser context. A reload must
            // preserve an explicit dismissal so mobile launcher clicks remain
            // reachable during the matrix.
            window.localStorage.removeItem("pwa-install-dismissed");
            window.sessionStorage.setItem("e2e-sabah-install-seeded", "1");
        }
        if (dismissOverdue) window.localStorage.setItem("overdueReminderDismissed", new Date().toDateString());
    }, { installEligible: options.installEligible, dismissOverdue: options.dismissOverdue ?? false });
}

async function dispatchInstallPrompt(page: Page): Promise<void> {
    const installAside = page.getByRole("complementary", { name: "Install DepartmentHub" });
    await expect(installAside).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => {
        const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void> };
        Object.defineProperty(event, "prompt", { value: () => Promise.resolve() });
        window.dispatchEvent(event);
    });
}

async function chooseTheme(page: Page, theme: "light" | "dark"): Promise<void> {
    await page.getByRole("button", { name: "Change theme" }).click();
    await page.getByRole("menuitem", { name: new RegExp(`^${theme}\\b`, "i") }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.className)).toContain(theme);
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("theme"))).toBe(theme);
}

async function setDirection(page: Page, direction: "ltr" | "rtl"): Promise<void> {
    await page.evaluate((value) => {
        document.documentElement.dir = value;
        document.documentElement.lang = value === "rtl" ? "ar" : "en";
    }, direction);
}

async function openSabah(page: Page): Promise<ReturnType<Page["getByTestId"]>> {
    const launcher = page.getByRole("button", { name: "Open Sabah", exact: true });
    await expect(launcher).toBeVisible({ timeout: 30_000 });
    await launcher.click();
    const shell = page.getByTestId("sabah-shell");
    await expect(shell).toBeVisible({ timeout: 30_000 });
    return shell;
}

async function inspectOverlayParents(page: Page): Promise<Record<string, unknown>> {
    return page.evaluate(() => {
        const inspect = (selector: string) => {
            const element = document.querySelector<HTMLElement>(selector);
            if (!element) return { exists: false };
            const box = element.getBoundingClientRect();
            const parents: Array<Record<string, string | null>> = [];
            let current: HTMLElement | null = element;
            for (let index = 0; current && index < 4; index += 1, current = current.parentElement) {
                parents.push({
                    tag: current.tagName.toLowerCase(),
                    role: current.getAttribute("role"),
                    testId: current.getAttribute("data-testid"),
                    className: typeof current.className === "string" ? current.className.slice(0, 240) : null,
                });
            }
            return {
                exists: true,
                box: { x: box.x, y: box.y, width: box.width, height: box.height },
                parents,
            };
        };
        return {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            document: { dir: document.documentElement.dir, theme: document.documentElement.className },
            activeElement: document.activeElement instanceof HTMLElement
                ? { id: document.activeElement.id, role: document.activeElement.getAttribute("role"), ariaLabel: document.activeElement.getAttribute("aria-label") }
                : null,
            shell: inspect('[data-testid="sabah-shell"]'),
            composer: inspect("#sabah-composer"),
            install: inspect('[aria-label="Install DepartmentHub"]'),
            overdueDialog: inspect('[role="dialog"][aria-label*="Overdue Tasks Requiring Attention"]'),
            launcher: inspect('button[aria-label="Open Sabah"]'),
            mobileNavigation: inspect('[data-testid="mobile-navigation"]'),
            launcherCenterHit: (() => {
                const launcher = document.querySelector<HTMLElement>('button[aria-label="Open Sabah"]');
                if (!launcher) return null;
                const box = launcher.getBoundingClientRect();
                const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
                return {
                    tag: hit?.tagName.toLowerCase() ?? null,
                    ariaLabel: hit?.getAttribute("aria-label"),
                    testId: hit?.getAttribute("data-testid"),
                    withinLauncher: Boolean(hit && (hit === launcher || launcher.contains(hit))),
                };
            })(),
        };
    });
}

async function captureBoundedState(page: Page, name: string): Promise<{ path: string; state: unknown }> {
    const imagePath = path.join(EVIDENCE_ROOT, `${name}.png`);
    await page.screenshot({ path: imagePath, fullPage: false });
    return { path: imagePath, state: await inspectOverlayParents(page) };
}

async function waitForContextRequests(observed: { memory: string[]; playbooks: string[] }): Promise<void> {
    await expect.poll(() => observed.memory.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect.poll(() => observed.playbooks.length, { timeout: 10_000 }).toBeGreaterThan(0);
}

async function captureOverlayMatrix(page: Page, evidence: EvidenceRecord): Promise<void> {
    for (const viewport of [
        { label: "desktop", width: 754, height: 480, mode: "PANEL" },
        { label: "mobile", width: 390, height: 844, mode: "FULLSCREEN" },
    ] as const) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.reload({ waitUntil: "networkidle", timeout: 30_000 });
        for (const theme of ["light", "dark"] as const) {
            await setDirection(page, "ltr");
            await chooseTheme(page, theme);
            for (const direction of ["ltr", "rtl"] as const) {
                await setDirection(page, direction);
                const shell = await openSabah(page);
                await expect(shell).toHaveAttribute("data-mode", viewport.mode);
                evidence.screenshots.push(await captureBoundedState(page, `overlay-${viewport.label}-${theme}-${direction}`));
                await page.keyboard.press("Escape");
                await expect(page.getByRole("button", { name: "Open Sabah", exact: true })).toBeFocused();
            }
        }
    }
}

test.describe.serial("Sabah verified repairs local browser acceptance", () => {
    test.setTimeout(180_000);
    let fixture: Fixture | undefined;

    test.beforeAll(async () => {
        fixture = await prepareFixture();
    });

    test.afterAll(async () => {
        if (!fixture) return;
        let cleanupError: unknown;
        let readback: Record<string, unknown> | undefined;
        try {
            readback = await cleanupFixture(fixture);
        } catch (error) {
            cleanupError = error;
        }
        try {
            writeEvidence("cleanup-readback.json", readback ?? await readCleanupState(fixture));
        } catch (error) {
            cleanupError ??= error;
        }
        if (cleanupError) throw cleanupError;
    });

    test("authenticated Context distinguishes healthy empty, review-degraded, and HTTP-error states", async ({ page }) => {
        const activeFixture = fixture;
        if (!activeFixture) throw new Error("Sabah fixture was not prepared");
        const diagnostics = attachDiagnostics(page);
        const evidence: EvidenceRecord = {
            test: "context-states",
            origin: "",
            actor: activeFixture.actorEmail,
            injectedAssertions: [
                "healthy empty response is presentation evidence, not database proof",
                "reviewIds response is presentation evidence, not database proof",
                "HTTP error response is an injected recovery state, not outage proof",
            ],
            screenshots: [],
            observations: {},
        };
        const observed = { memory: [] as string[], playbooks: [] as string[] };
        let mode: "healthy" | "degraded" | "error" = "healthy";
        await configurePage(page, { installEligible: false, dismissOverdue: true });
        await loginAsEmail(page, activeFixture.actorEmail);
        evidence.origin = new URL(page.url()).origin;
        expect(new URL(page.url()).pathname).toBe("/dashboard");

        const realMemory = await page.request.get("/api/ai/memory?query=my%20preferences%20and%20ways%20of%20working&limit=8");
        const realPlaybooks = await page.request.get("/api/ai/playbooks?query=my%20preferences%20and%20ways%20of%20working&limit=5");
        expect(realMemory.status()).toBe(200);
        expect(realPlaybooks.status()).toBe(200);
        evidence.observations.authenticatedRouteStatuses = {
            memory: realMemory.status(),
            playbooks: realPlaybooks.status(),
        };
        await chooseTheme(page, "light");

        await page.route("**/api/ai/memory**", async (route) => {
            const url = new URL(route.request().url());
            if (url.pathname !== "/api/ai/memory") return route.continue();
            observed.memory.push(`${url.pathname}${url.search}`);
            if (mode === "error") {
                await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "injected-context-error" }) });
            } else if (mode === "degraded") {
                await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], reviewIds: ["e2e-sabah-review-row"] }) });
            } else {
                await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
            }
        });
        await page.route("**/api/ai/playbooks**", async (route) => {
            const url = new URL(route.request().url());
            if (url.pathname !== "/api/ai/playbooks") return route.continue();
            observed.playbooks.push(`${url.pathname}${url.search}`);
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
        });

        try {
            const shell = await openSabah(page);
            await expect(shell).toHaveAttribute("data-mode", "PANEL");
            await shell.getByRole("tab", { name: "Context", exact: true }).click();
            await waitForContextRequests(observed);
            await expect(page.getByText("No context attached to this conversation.", { exact: true })).toBeVisible();
            evidence.screenshots.push(await captureBoundedState(page, "context-healthy-empty-754x480-light"));

            mode = "degraded";
            await shell.getByRole("tab", { name: "Chat", exact: true }).click();
            await shell.getByRole("tab", { name: "Context", exact: true }).click();
            await waitForContextRequests(observed);
            await expect(page.getByText("Learning context partially unavailable.", { exact: true })).toBeVisible();
            evidence.screenshots.push(await captureBoundedState(page, "context-review-degraded-754x480-light"));

            mode = "error";
            await shell.getByRole("tab", { name: "Chat", exact: true }).click();
            await shell.getByRole("tab", { name: "Context", exact: true }).click();
            await waitForContextRequests(observed);
            await expect(page.getByText("Learning context unavailable.", { exact: true })).toBeVisible();
            evidence.screenshots.push(await captureBoundedState(page, "context-http-error-754x480-light"));

            evidence.observations.contextRequests = observed;
            evidence.observations.contextRequestContracts = {
                memory: observed.memory.every((url) => url.includes("limit=8") && url.includes("query=")),
                playbooks: observed.playbooks.every((url) => url.includes("limit=5") && url.includes("query=")),
            };
            expect(evidence.observations.contextRequestContracts).toEqual({ memory: true, playbooks: true });
            expect(diagnostics.pageErrors).toEqual([]);
        } finally {
            await page.unroute("**/api/ai/memory**");
            await page.unroute("**/api/ai/playbooks**");
            evidence.diagnostics = diagnostics;
            writeEvidence("context-states-evidence.json", evidence);
        }
    });

    test("eligible undismissed mobile install guidance leaves the launcher reachable", async ({ page }) => {
        const activeFixture = fixture;
        if (!activeFixture) throw new Error("Sabah fixture was not prepared");
        const diagnostics = attachDiagnostics(page);
        const evidence: EvidenceRecord = {
            test: "undismissed-install-launcher",
            origin: "",
            actor: activeFixture.actorEmail,
            injectedAssertions: [
                "install eligibility remains visible until the user explicitly dismisses guidance",
                "the launcher center hit target is the launcher, not the install banner",
                "pointer and keyboard opening hide the banner while Sabah is open and close restores it",
            ],
            screenshots: [],
            observations: {},
        };

        await configurePage(page, { installEligible: true, dismissOverdue: true });
        await page.setViewportSize({ width: 390, height: 844 });
        try {
            await loginAsEmail(page, activeFixture.actorEmail);
            evidence.origin = new URL(page.url()).origin;
            expect(new URL(page.url()).pathname).toBe("/dashboard");
            await chooseTheme(page, "light");
            await dispatchInstallPrompt(page);
            expect(await page.evaluate(() => window.localStorage.getItem("pwa-install-dismissed"))).toBeNull();

            const installGuidance = page.getByRole("complementary", { name: "Install DepartmentHub" });
            const launcher = page.getByRole("button", { name: "Open Sabah", exact: true });
            await expect(installGuidance).toBeVisible();
            await expect(page.getByRole("button", { name: /Install DepartmentHub/i })).toBeVisible();
            await expect(launcher).toBeVisible();
            const undismissedState = await captureBoundedState(page, "install-undismissed-mobile-light-ltr");
            evidence.screenshots.push(undismissedState);
            expect((undismissedState.state as { launcherCenterHit?: { withinLauncher?: boolean } }).launcherCenterHit?.withinLauncher).toBe(true);

            const launcherBox = await launcher.boundingBox();
            if (!launcherBox) throw new Error("Open Sabah launcher has no mobile bounding box");
            await page.mouse.click(launcherBox.x + launcherBox.width / 2, launcherBox.y + launcherBox.height / 2);
            let shell = page.getByTestId("sabah-shell");
            await expect(shell).toBeVisible();
            await expect(shell).toHaveAttribute("data-mode", "FULLSCREEN");
            await expect(installGuidance).toBeHidden();
            const mobileComposer = shell.getByRole("textbox", { name: /Message Sabah/i });
            await mobileComposer.focus();
            await expect(mobileComposer).toBeFocused();
            evidence.observations.pointerOpen = { mode: "FULLSCREEN", bannerHidden: true, composerFocused: true };

            await page.getByRole("button", { name: "Close Sabah" }).click();
            await expect(installGuidance).toBeVisible();
            await launcher.focus();
            await expect(launcher).toBeFocused();
            await page.keyboard.press("Enter");
            shell = page.getByTestId("sabah-shell");
            await expect(shell).toBeVisible();
            await expect(shell).toHaveAttribute("data-mode", "FULLSCREEN");
            await expect(installGuidance).toBeHidden();
            evidence.observations.keyboardOpen = { mode: "FULLSCREEN", bannerHidden: true };

            await page.getByRole("button", { name: "Close Sabah" }).click();
            await expect(installGuidance).toBeVisible();
            await installGuidance.getByRole("button", { name: "Dismiss install guidance" }).click();
            await expect(installGuidance).toBeHidden();
            expect(await page.evaluate(() => window.localStorage.getItem("pwa-install-dismissed"))).toBe("true");
            evidence.observations.explicitDismissal = true;
        } finally {
            evidence.diagnostics = diagnostics;
            writeEvidence("install-launcher-evidence.json", evidence);
        }
    });

    test("real chat transport renders Arabic Markdown, preserves copy/reload, and coordinates overlays", async ({ page }) => {
        const activeFixture = fixture;
        if (!activeFixture) throw new Error("Sabah fixture was not prepared");
        const diagnostics = attachDiagnostics(page);
        const evidence: EvidenceRecord = {
            test: "markdown-and-overlays",
            origin: "",
            actor: activeFixture.actorEmail,
            injectedAssertions: [
                "Arabic Markdown is returned only by the local synthetic provider fixture",
                "the internal task href is link-target/rendering evidence, not workflow source authorization",
                "the overdue response is fetched from the real local route against the owned DB fixture",
                "install and overdue states are inspected at bounded viewport sizes with reduced motion",
            ],
            screenshots: [],
            observations: {},
        };

        await configurePage(page, { installEligible: true });
        await page.setViewportSize({ width: 754, height: 480 });
        await page.route("**/api/tasks**", async (route) => {
            const url = new URL(route.request().url());
            if (url.pathname !== "/api/tasks" || url.searchParams.get("due") !== "overdue" || url.searchParams.get("assigneeId") !== activeFixture.actorId) {
                return route.continue();
            }
            const response = await route.fetch();
            const body = await response.body();
            const rows = JSON.parse(body.toString("utf8")) as Array<{ id?: string }>;
            evidence.observations.overdueRouteFixturePresent = rows.some((row) => row.id === activeFixture.overdueTaskId);
            evidence.observations.overdueRouteStatus = response.status();
            await new Promise<void>((resolve) => {
                (page as Page & { __releaseOverdue?: () => void }).__releaseOverdue = resolve;
            });
            await route.fulfill({ response, body });
        });

        const writes: string[] = [];
        page.on("request", (request) => {
            if (!/\/api\/(tasks\/[^/]+|support)$/.test(pathnameOf(request.url()))) return;
            if (request.method() === "POST" || request.method() === "PATCH") writes.push(`${request.method()} ${pathnameOf(request.url())}`);
        });

        try {
            await loginAsEmail(page, activeFixture.actorEmail);
            evidence.origin = new URL(page.url()).origin;
            expect(new URL(page.url()).pathname).toBe("/dashboard");
            await dispatchInstallPrompt(page);
            await expect(page.getByRole("button", { name: /Install DepartmentHub/i })).toBeVisible();

            let shell = await openSabah(page);
            await expect(shell).toHaveAttribute("data-mode", "PANEL");
            await expect(page.getByRole("complementary", { name: "Install DepartmentHub" })).toBeHidden();

            const composer = shell.getByRole("textbox", { name: /Message Sabah/i });
            await composer.fill("draft focus");
            await composer.focus();
            await expect.poll(() => evidence.observations.overdueRouteStatus).toBe(200);
            const releaseOverdue = (page as Page & { __releaseOverdue?: () => void }).__releaseOverdue;
            releaseOverdue?.();
            await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? "")).toBe("sabah-composer");
            await expect(page.getByRole("dialog", { name: /Overdue Tasks Requiring Attention/i })).toBeHidden();
            expect(evidence.observations.overdueRouteFixturePresent).toBe(true);
            expect(writes).toEqual([]);
            evidence.observations.focusAfterDeferredOverdue = await page.evaluate(() => document.activeElement?.id ?? null);

            await setDirection(page, "rtl");
            await chooseTheme(page, "light");
            evidence.screenshots.push(await captureBoundedState(page, "overlay-desktop-light-rtl-deferred"));

            await page.keyboard.press("Escape");
            const deferredDialog = page.getByRole("dialog", { name: /Overdue Tasks Requiring Attention/i });
            await expect(deferredDialog).toBeVisible();
            // The eligible install banner remains mounted behind the modal; the
            // modal intentionally owns accessibility visibility while open.
            // Radix correctly moves focus into the newly opened dialog. Close that
            // presentation layer first, then exercise launcher Enter reopening.
            await deferredDialog.getByRole("button", { name: "Close" }).click();
            await expect(deferredDialog).toBeHidden();
            await expect(page.getByRole("complementary", { name: "Install DepartmentHub" })).toBeVisible();
            const launcherAfterDialog = page.getByRole("button", { name: "Open Sabah", exact: true });
            await launcherAfterDialog.focus();
            await page.keyboard.press("Enter");
            shell = page.getByTestId("sabah-shell");
            await expect(shell).toBeVisible();
            await expect(shell).toHaveAttribute("data-mode", "PANEL");
            await expect(page.getByRole("dialog", { name: /Overdue Tasks Requiring Attention/i })).toBeHidden();
            await page.keyboard.press("Tab");
            expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
            await page.getByRole("button", { name: "Close Sabah" }).click();
            const overdueDialog = page.getByRole("dialog", { name: /Overdue Tasks Requiring Attention/i });
            await expect(overdueDialog).toBeVisible();
            await overdueDialog.getByRole("button", { name: "Dismiss for Today" }).click();
            await expect(overdueDialog).toBeHidden();
            expect(await page.evaluate(() => window.localStorage.getItem("overdueReminderDismissed"))).toBeTruthy();
            expect(writes).toEqual([]);
            const installGuidance = page.getByRole("complementary", { name: "Install DepartmentHub" });
            await expect(installGuidance).toBeVisible();
            await installGuidance.getByRole("button", { name: "Dismiss install guidance" }).click();
            await expect(installGuidance).toBeHidden();
            evidence.observations.installGuidanceDismissedAfterEligibility = true;
            await page.unroute("**/api/tasks**");

            await page.setViewportSize({ width: 754, height: 480 });
            await setDirection(page, "rtl");
            await chooseTheme(page, "light");
            shell = await openSabah(page);
            await expect(shell).toHaveAttribute("data-mode", "PANEL");
            await expect(shell).toHaveClass(/rounded-xl/);
            const send = shell.getByRole("button", { name: "Send", exact: true });
            await composer.fill(ARABIC_MARKDOWN_PROMPT);
            const chatResponse = page.waitForResponse((response) => pathnameOf(response.url()) === "/api/ai/chat" && response.request().method() === "POST");
            await send.click();
            const chatResponseResult = await chatResponse;
            expect(chatResponseResult.status()).toBe(200);
            const chatResponseBody = await chatResponseResult.text();
            const streamCompleted = chatResponseBody.includes('"type":"done"');
            expect(streamCompleted).toBe(true);
            evidence.observations.chatTransport = {
                status: chatResponseResult.status(),
                streamCompleted,
                responseBodyInspection: "The browser-rendered DOM and authenticated conversation read-back are the content oracles; raw SSE framing is not reported as transcript evidence.",
            };
            expect(chatResponseBody).not.toContain('"type":"error"');
            await expect.poll(async () => page.locator('[data-role="assistant"]').count(), { timeout: 10_000 }).toBeGreaterThan(0);
            evidence.observations.chatDomBeforeMarkdownAssertion = await page.evaluate(() => ({
                assistantBubbles: Array.from(document.querySelectorAll<HTMLElement>('[data-role="assistant"]')).map((node) => ({
                    text: (node.textContent ?? "").slice(0, 240),
                    status: node.getAttribute("data-streaming-status"),
                })),
                alerts: Array.from(document.querySelectorAll<HTMLElement>('[role="alert"]')).map((node) => (node.textContent ?? "").slice(0, 240)),
            }));

            await expect(page.getByRole("heading", { name: "تقرير المتابعة", exact: true })).toBeVisible({ timeout: 60_000 });
            const table = page.getByRole("table", { name: "Assistant response table" });
            await expect(table).toBeVisible();
            await expect(table.getByRole("columnheader", { name: "الأولوية" })).toBeVisible();
            await expect(table.getByRole("cell", { name: "2" })).toBeVisible();
            await expect(page.getByRole("link", { name: "فتح المهمة", exact: true })).toHaveAttribute("href", "/tasks/e2e-sabah-verified-link");
            await expect(page.getByRole("link", { name: "رابط خارجي غير آمن", exact: true })).toHaveCount(0);
            await expect(page.getByText("رابط خارجي غير آمن", { exact: true })).toBeVisible();

            const assistantBubble = page.locator('[data-role="assistant"]').filter({ hasText: "تقرير المتابعة" }).last();
            await assistantBubble.getByRole("button", { name: "Copy message" }).click();
            expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(ARABIC_MARKDOWN_RESPONSE);
            evidence.observations.markdownRendered = { heading: true, table: true, safeInternalLink: true, unsafeLinkNotAnchor: true, copyPreserved: true };
            evidence.screenshots.push(await captureBoundedState(page, "markdown-desktop-light-rtl"));
            await page.getByRole("heading", { name: "تقرير المتابعة", exact: true }).scrollIntoViewIfNeeded();
            evidence.screenshots.push(await captureBoundedState(page, "markdown-desktop-light-rtl-top"));
            await table.scrollIntoViewIfNeeded();
            evidence.screenshots.push(await captureBoundedState(page, "markdown-desktop-light-rtl-table"));

            const conversationId = await page.evaluate(() => window.localStorage.getItem("sabah:activeConversation"));
            expect(conversationId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
            const stored = await page.request.get(`/api/ai/conversations/${conversationId}`);
            expect(stored.status()).toBe(200);
            const storedBody = await stored.json() as { messages?: Array<{ role?: string; content?: string }> };
            expect(storedBody.messages?.some((message) => message.role === "assistant" && message.content === ARABIC_MARKDOWN_RESPONSE)).toBe(true);
            evidence.observations.persistedAssistantExactBeforeReload = true;

            await page.reload({ waitUntil: "networkidle", timeout: 30_000 });
            evidence.observations.afterReloadDom = await page.evaluate(() => ({
                url: window.location.href,
                bodyText: document.body.innerText.slice(0, 800),
                launcherCount: document.querySelectorAll('button[aria-label="Open Sabah"]').length,
                shellCount: document.querySelectorAll('[data-testid="sabah-shell"]').length,
                dialogCount: document.querySelectorAll('[role="dialog"]').length,
                installCount: document.querySelectorAll('[aria-label="Install DepartmentHub"]').length,
            }));
            await expect(page.getByRole("button", { name: "Open Sabah", exact: true })).toBeVisible({ timeout: 30_000 });
            shell = await openSabah(page);
            await expect(page.getByRole("heading", { name: "تقرير المتابعة", exact: true })).toBeVisible({ timeout: 60_000 });
            await expect(page.getByRole("table", { name: "Assistant response table" })).toBeVisible();
            await expect(page.getByRole("link", { name: "فتح المهمة", exact: true })).toHaveAttribute("href", "/tasks/e2e-sabah-verified-link");
            const recoveredBubble = page.locator('[data-role="assistant"]').filter({ hasText: "تقرير المتابعة" }).last();
            await recoveredBubble.getByRole("button", { name: "Copy message" }).click();
            expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(ARABIC_MARKDOWN_RESPONSE);
            evidence.observations.reloadRecovered = true;

            await page.getByRole("button", { name: "Close Sabah" }).click();
            await setDirection(page, "rtl");
            await chooseTheme(page, "dark");
            shell = await openSabah(page);
            await expect(shell).toHaveAttribute("data-mode", "PANEL");
            evidence.screenshots.push(await captureBoundedState(page, "markdown-desktop-dark-rtl-reload"));
            await page.getByRole("button", { name: "Close Sabah" }).click();

            await captureOverlayMatrix(page, evidence);
            expect(writes).toEqual([]);
            expect(diagnostics.pageErrors).toEqual([]);
            evidence.observations.noAutomaticTaskWrites = true;
            evidence.observations.reducedMotion = true;
        } finally {
            await page.unroute("**/api/tasks**");
            evidence.observations.taskWriteRequests = writes;
            evidence.diagnostics = diagnostics;
            writeEvidence("markdown-overlays-evidence.json", evidence);
        }
    });
});
