import { ExternalActionForm } from "@/components/pmo/external-action-form";
import { PmoBackButton } from "@/components/pmo/pmo-back-button";
import { prisma } from "@/lib/prisma";
import { getCurrentPmoActor } from "@/lib/pmo/current-actor";
import { SabahFormProvider } from "@/components/sabah/forms/form-context";
import { FormAssistMenu } from "@/components/sabah/forms/form-assist-menu";
import { FieldAssist } from "@/components/sabah/forms/field-assist";

export default async function NewExternalActionPage({
    searchParams,
}: {
    searchParams: Promise<{ projectId?: string; caseStudyId?: string }>;
}) {
    const actor = await getCurrentPmoActor();
    if (!actor || actor.role === "VIEWER") return null;
    const query = await searchParams;
    const [users, projects, caseStudies, contacts, tags, dependencies, workAreas] = await Promise.all([
        prisma.user.findMany({
            where: { isActive: true, role: { not: "VIEWER" } },
            select: { id: true, name: true, email: true },
            orderBy: { name: "asc" },
        }),
        prisma.project.findMany({
            select: { id: true, name: true, workArea: { select: { id: true, name: true } } },
            orderBy: { name: "asc" },
        }),
        prisma.caseStudy.findMany({
            select: { id: true, name: true, workArea: { select: { id: true, name: true } } },
            orderBy: { name: "asc" },
        }),
        prisma.externalContact.findMany({ orderBy: { name: "asc" } }),
        prisma.tag.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
        prisma.task.findMany({
            where: { status: { notIn: ["DONE", "CANCELED"] } },
            select: { id: true, title: true },
            orderBy: { title: "asc" },
        }),
        prisma.workArea.findMany({
            where: { isArchived: false },
            select: { id: true, name: true },
            orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        }),
    ]);
    const preselectedParent = query.projectId
        ? { type: "project" as const, id: query.projectId }
        : query.caseStudyId
          ? { type: "case-study" as const, id: query.caseStudyId }
          : undefined;
    return (
        <SabahFormProvider formId="pmo-action-new" entityType="pmo.action" entityId={null} recordVersion={null} fields={[]}>
            <div className="mx-auto max-w-3xl space-y-6">
                <PmoBackButton />
                <div className="flex items-center gap-2"><FormAssistMenu /><FieldAssist fieldName="title" /></div>
                <div>
                    <p className="text-sm font-medium text-primary">PMO Follow-up</p>
                    <h1 className="text-3xl font-bold">New external action</h1>
                    <p className="text-muted-foreground">Assign one accountable owner to follow up with an external contact.</p>
                </div>
                <ExternalActionForm mode="create" users={users} projects={projects} caseStudies={caseStudies} contacts={contacts} tags={tags} dependencies={dependencies.map((task) => ({ id: task.id, name: task.title }))} workAreas={workAreas} preselectedParent={preselectedParent} recordVersion={null} />
            </div>
        </SabahFormProvider>
    );
}
