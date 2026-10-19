import { prisma } from "@/lib/prisma";
import { riyadhWeekWindow } from "@/lib/week";
import { callGLMText, DEFAULT_GLM_MODEL } from "@/lib/glm";
import {
    buildExecutivePrompt,
    normalizeSummaryLines,
    type SummaryContext,
    type SummaryItem,
    type PromptExtras,
} from "@/lib/executive-summary-prompt";
import { getReportPromptExtrasForActor } from "@/lib/reports/history";
import type { SabahActor } from "@/lib/sabah/auth/actor";

// Re-export the pure API so callers only import from one module.
export { buildExecutivePrompt, type SummaryContext, type SummaryItem, type PromptExtras };

export type ProjectBriefActor = Pick<SabahActor, "id" | "role" | "departmentIds">;

/** Project visibility used by both brief authorization and context queries. */
export function projectVisibilityWhere(actor: ProjectBriefActor): Record<string, unknown> {
    if (actor.role === "ADMIN") return {};
    return {
        OR: [
            { ownerId: null },
            { ownerId: actor.id },
            { managerId: actor.id },
            { sponsorId: actor.id },
            { members: { some: { userId: actor.id } } },
            { responsibleDepartmentId: { in: actor.departmentIds } },
        ],
    };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) : s;
}

type RichTask = {
    title: string;
    description: string | null;
    updatedAt: Date;
    project: { name: string } | null;
    caseStudy: { name: string } | null;
    comments: { body: string }[];
};

type LiteTask = {
    title: string;
    project: { name: string } | null;
};

/** When `weekStart` is passed, tags whether the task saw activity this week. */
function mapRich(t: RichTask, weekStart?: Date): SummaryItem {
    const project = t.project?.name || t.caseStudy?.name || undefined;
    const comment = t.comments[0]?.body;
    const detail = comment ? truncate(comment, 100) : t.description ? truncate(t.description, 120) : undefined;
    const item: SummaryItem = { title: t.title, project, detail };
    if (weekStart) item.updatedThisWeek = t.updatedAt >= weekStart;
    return item;
}

function mapLite(t: LiteTask): SummaryItem {
    return { title: t.title, project: t.project?.name || undefined };
}

/**
 * Gather the week's activity for the executive summary. Pass a projectId to
 * scope every query to a single project (used by the per-project brief); in
 * that mode KPI-at-risk is skipped since KPIs are department-level.
 */
export async function gatherWeekContext(opts?: { projectId?: string; actor?: ProjectBriefActor }): Promise<SummaryContext> {
    const now = new Date();
    const { weekStart, weekEnd } = riyadhWeekWindow(now);
    const projectId = opts?.projectId;
    const scoped = projectId ? { projectId, ...(opts?.actor ? { project: projectVisibilityWhere(opts.actor) } : {}) } : {};

    const richInclude = {
        project: true,
        caseStudy: true,
        comments: { orderBy: { createdAt: "desc" as const }, take: 1, select: { body: true } },
    };

    const [completed, inProgress, overdue, upcoming, kpisAtRisk] = await Promise.all([
        prisma.task.findMany({
            where: { status: "DONE", doneAt: { gte: weekStart, lte: weekEnd }, ...scoped },
            include: richInclude,
            take: 40,
        }),
        prisma.task.findMany({
            where: { status: "DOING", ...scoped },
            include: richInclude,
            take: 20,
        }),
        prisma.task.findMany({
            where: { status: { notIn: ["DONE", "CANCELED"] }, dueAt: { lt: now }, ...scoped },
            include: { project: true },
            take: 15,
        }),
        prisma.task.findMany({
            where: {
                status: { notIn: ["DONE", "CANCELED"] },
                dueAt: { gte: now, lte: new Date(now.getTime() + WEEK_MS) },
                ...scoped,
            },
            include: { project: true },
            take: 15,
        }),
        projectId
            ? Promise.resolve([] as { name: string }[])
            : prisma.kPI.findMany({ where: { status: { in: ["AT_RISK", "OFF_TRACK"] } }, take: 8, select: { name: true } }),
    ]);

    return {
        done: completed.map((t) => mapRich(t)),
        doing: inProgress.map((t) => mapRich(t, weekStart)), // mark stale in-progress tasks
        overdue: overdue.map(mapLite),
        upcoming: upcoming.map(mapLite),
        kpiRisk: kpisAtRisk.map((k) => k.name),
    };
}

/**
 * Read only the authenticated actor's approved report-learning memory and
 * dated style examples. The legacy global AppConfig memo is intentionally not
 * consulted; omitting an actor therefore yields no personal learning.
 */
export async function gatherPromptExtras(actorId: string): Promise<PromptExtras> {
    if (!actorId) return { styleMemo: null };
    return getReportPromptExtrasForActor(actorId);
}

/**
 * gather-shaped context → GLM → normalized lines (3–9 executive sentences).
 * Throws on an empty/unusable completion so callers can surface a real error.
 * `extras` is optional so the digest / project-brief callers are unaffected.
 */
export async function generateExecutiveSummary(ctx: SummaryContext, extras?: PromptExtras): Promise<string[]> {
    const prompt = buildExecutivePrompt(ctx, extras);
    const raw = await callGLMText(prompt, { model: DEFAULT_GLM_MODEL, temperature: 0.4, max_tokens: 2500 });
    const lines = normalizeSummaryLines(raw);
    if (lines.length < 3) {
        throw new Error("GLM returned no usable lines");
    }
    return lines;
}
