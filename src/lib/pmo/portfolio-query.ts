import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canViewAllPmo, type PmoActor } from "./authorization";
import { getDueBucket, toRiyadhDate } from "./date";
import { buildPmoWhere, calculatePortfolioMetrics, type PmoFilters } from "./portfolio";
import { selectNextReminderOccurrence } from "./reminders";

// Bulk-PII surfaces are bounded so a single request can never stream the whole
// external-action table. 200 comfortably fits the department's real volume; a
// broader dataset paginates via PmoFilters.page.
export const PMO_PAGE_SIZE = 200;

// Non-managers may only ever read their own actions. If they ask for "all"
// (ownerId null) or another owner's id, force the query back to their own scope
// rather than leaking other owners' external-contact PII.
export function scopePmoFiltersToActor(filters: PmoFilters, actor: PmoActor): PmoFilters {
    if (canViewAllPmo(actor)) return filters;
    if (filters.ownerId === "me" || filters.ownerId === actor.id) return filters;
    return { ...filters, ownerId: "me" };
}

export type PmoActionRow = {
    id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    dueDate: string;
    dueBucket: string;
    workAreaName: string;
    parentType: "Project" | "Case Study";
    parentName: string;
    ownerName: string;
    ownerId: string;
    contactName: string;
    contactId: string;
    contactEmail: string;
    contactDepartment: string;
    contactOrganization: string;
    evidence: Array<{ label: string; url: string }>;
    lastResponseAt: string | null;
    lastFollowUpAt: string | null;
    nextReminder: string | null;
    closedAt: string | null;
    closureNote: string;
};

export async function loadPmoPortfolio(filters: PmoFilters, actor: PmoActor, today: string, db: PrismaClient = prisma) {
    const scopedFilters = scopePmoFiltersToActor(filters, actor);
    const [tasks, owners, workAreas, projects, caseStudies, contacts] = await Promise.all([
        db.task.findMany({
            where: buildPmoWhere(scopedFilters, actor.id, today),
            include: {
                externalAction: {
                    include: {
                        owner: true,
                        externalContact: true,
                        evidence: true,
                        reminderRules: true,
                        followUpEvents: { orderBy: { scheduledDate: "asc" } },
                    },
                },
                project: { include: { workArea: true } },
                caseStudy: { include: { workArea: true } },
            },
            orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
            skip: (scopedFilters.page - 1) * PMO_PAGE_SIZE,
            take: PMO_PAGE_SIZE,
        }),
        db.user.findMany({ where: { isActive: true, role: { not: "VIEWER" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        db.workArea.findMany({ where: { isArchived: false }, select: { id: true, name: true }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] }),
        db.project.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
        db.caseStudy.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
        db.externalContact.findMany({ where: { isArchived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    const rows: PmoActionRow[] = tasks.flatMap((task) => {
        if (!task.externalAction || !task.dueAt) return [];
        const action = task.externalAction;
        const latestSent = action.followUpEvents
            .filter((event) => event.sentAt)
            .sort((left, right) => right.sentAt!.getTime() - left.sentAt!.getTime())[0];
        const dueDate = toRiyadhDate(task.dueAt);
        const scheduledEvents = action.followUpEvents.filter((event) => event.triggerType !== "MANUAL");
        const nextReminder = ["DONE", "CANCELED"].includes(task.status) ? null : selectNextReminderOccurrence({
            actionId: action.id,
            dueDate,
            today,
            daysBeforeDue: action.reminderRules.map((rule) => rule.daysBeforeDue),
            overdueIntervalDays: action.overdueIntervalDays,
            processedDedupKeys: new Set(scheduledEvents.map((event) => event.dedupKey)),
            hasScheduledHistory: scheduledEvents.length > 0,
        });
        return [{
            id: task.id,
            title: task.title,
            description: task.description ?? "",
            status: task.status,
            priority: task.priority,
            dueDate,
            dueBucket: getDueBucket(dueDate, task.status, today),
            workAreaName: task.project?.workArea?.name ?? task.caseStudy?.workArea?.name ?? "Unclassified",
            parentType: task.project ? "Project" : "Case Study",
            parentName: task.project?.name ?? task.caseStudy?.name ?? "",
            ownerName: action.owner.name,
            ownerId: action.ownerId,
            contactName: action.externalContact.name,
            contactId: action.externalContactId,
            contactEmail: action.externalContact.email,
            contactDepartment: action.externalContact.department ?? "",
            contactOrganization: action.externalContact.organization ?? "",
            evidence: action.evidence.map((item) => ({ label: item.label, url: item.url })),
            lastResponseAt: action.lastExternalResponseAt?.toISOString() ?? null,
            lastFollowUpAt: latestSent?.sentAt?.toISOString() ?? null,
            nextReminder: nextReminder?.scheduledDate ?? null,
            closedAt: action.closedAt?.toISOString() ?? null,
            closureNote: action.closureNote ?? "",
        }];
    });

    const metrics = calculatePortfolioMetrics(rows.map((row) => ({
        status: row.status,
        dueDate: row.dueDate,
        closedDate: row.closedAt ? toRiyadhDate(new Date(row.closedAt)) : null,
    })), today);
    return { rows, metrics, options: { owners, workAreas, projects, caseStudies, contacts } };
}
