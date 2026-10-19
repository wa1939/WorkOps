import { notFound, redirect } from "next/navigation";
import { ExternalActionForm } from "@/components/pmo/external-action-form";
import { PmoBackButton } from "@/components/pmo/pmo-back-button";
import { prisma } from "@/lib/prisma";
import { getCurrentPmoActor } from "@/lib/pmo/current-actor";
import { toRiyadhDate } from "@/lib/pmo/date";
import { canManageExternalAction } from "@/lib/pmo/authorization";
import { SabahFormProvider } from "@/components/sabah/forms/form-context";
import { FormAssistMenu } from "@/components/sabah/forms/form-assist-menu";
import { FieldAssist } from "@/components/sabah/forms/field-assist";

export default async function EditExternalActionPage({ params }: { params: Promise<{ taskId: string }> }) {
    const actor = await getCurrentPmoActor();
    if (!actor) return null;
    const { taskId } = await params;
    const task = await prisma.task.findFirst({
        where: { id: taskId, type: "EXTERNAL_ACTION" },
        include: {
            externalAction: { include: { reminderRules: true, owner: { select: { managerId: true } } } },
            assignments: true,
            tags: true,
            blockers: true,
            project: { select: { ownerId: true } },
            caseStudy: { select: { ownerId: true } },
        },
    });
    if (!task?.externalAction || !task.dueAt) notFound();
    if (
        !canManageExternalAction(actor, {
            ownerId: task.externalAction.ownerId,
            parentOwnerId: task.project?.ownerId ?? task.caseStudy?.ownerId ?? null,
            ownerManagerId: task.externalAction.owner.managerId,
        })
    )
        redirect(`/tasks/${taskId}`);

    const [users, projects, caseStudies, contacts, tags, dependencies, workAreas] = await Promise.all([
        prisma.user.findMany({
            where: { isActive: true, role: { not: "VIEWER" } },
            select: { id: true, name: true, email: true },
        }),
        prisma.project.findMany({ select: { id: true, name: true, workArea: { select: { id: true, name: true } } } }),
        prisma.caseStudy.findMany({ select: { id: true, name: true, workArea: { select: { id: true, name: true } } } }),
        prisma.externalContact.findMany(),
        prisma.tag.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
        prisma.task.findMany({
            where: { id: { not: taskId }, status: { notIn: ["DONE", "CANCELED"] } },
            select: { id: true, title: true },
            orderBy: { title: "asc" },
        }),
        prisma.workArea.findMany({
            where: { isArchived: false },
            select: { id: true, name: true },
            orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        }),
    ]);
    const ownerId = task.externalAction.ownerId;
    return (
        <SabahFormProvider formId={`pmo-action-edit-${taskId}`} entityType="pmo.action" entityId={taskId} recordVersion={task.updatedAt.toISOString()} fields={[]}>
            <div className="mx-auto max-w-3xl space-y-6">
                <div className="flex items-center gap-2"><FormAssistMenu /><FieldAssist fieldName="title" /><FieldAssist fieldName="description" /></div>
                <PmoBackButton />
                <h1 className="text-3xl font-bold">Edit external action</h1>
                <ExternalActionForm
                    mode="edit"
                    users={users}
                    projects={projects}
                    caseStudies={caseStudies}
                    contacts={contacts}
                    tags={tags}
                    dependencies={dependencies.map((item) => ({ id: item.id, name: item.title }))}
                    workAreas={workAreas}
                    recordVersion={task.updatedAt.toISOString()}
                    initial={{
                        taskId,
                        title: task.title,
                        description: task.description ?? "",
                        priority: task.priority,
                        status: task.status as "TODO" | "DOING" | "BLOCKED" | "WAITING",
                        ownerId,
                        externalContactId: task.externalAction.externalContactId,
                        dueDate: toRiyadhDate(task.dueAt),
                        projectId: task.projectId,
                        caseStudyId: task.caseStudyId,
                        collaboratorIds: task.assignments.map((item) => item.userId).filter((id) => id !== ownerId),
                        tagIds: task.tags.map((item) => item.tagId),
                        dependencyIds: task.blockers.map((item) => item.dependsOnId),
                        reminderOffsets: task.externalAction.reminderRules.map((rule) => rule.daysBeforeDue),
                        overdueIntervalDays: task.externalAction.overdueIntervalDays,
                    }}
                />
            </div>
        </SabahFormProvider>
    );
}
