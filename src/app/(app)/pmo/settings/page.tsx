import { ExternalContactManager } from "@/components/pmo/external-contact-manager";
import { PmoBackButton } from "@/components/pmo/pmo-back-button";
import { PmoSettingsTabs } from "@/components/pmo/pmo-settings-tabs";
import { WorkAreaManager } from "@/components/pmo/work-area-manager";
import { prisma } from "@/lib/prisma";
import { getCurrentPmoActor } from "@/lib/pmo/current-actor";
import { parsePmoSettingsTab } from "@/lib/pmo/settings-tab";
import { canManageWorkAreas } from "@/lib/pmo/authorization";
import { SabahFormProvider } from "@/components/sabah/forms/form-context";
import { FormAssistMenu } from "@/components/sabah/forms/form-assist-menu";
import { TableCellAssist } from "@/components/sabah/forms/table-cell-assist";

export default async function PmoSettingsPage({
    searchParams,
}: {
    searchParams: Promise<{ tab?: string | string[] }>;
}) {
    const actor = await getCurrentPmoActor();
    if (!actor) return null;
    const initialTab = parsePmoSettingsTab((await searchParams).tab);
    const [areas, contacts] = await Promise.all([
        prisma.workArea.findMany({
            include: { _count: { select: { projects: true, caseStudies: true } } },
            orderBy: [{ isArchived: "asc" }, { displayOrder: "asc" }],
        }),
        prisma.externalContact.findMany({ orderBy: [{ isArchived: "asc" }, { name: "asc" }] }),
    ]);
    const canManageAreas = canManageWorkAreas(actor);
    return (
        <SabahFormProvider formId="pmo-settings" entityType="pmo.settings" entityId={null} recordVersion={null} fields={[]}>
            <div className="mx-auto max-w-5xl space-y-6">
                <PmoBackButton />
                <div className="flex items-center gap-2"><FormAssistMenu /></div>
                <div>
                    <p className="text-primary">PMO Follow-up</p>
                    <h1 className="text-3xl font-bold">Settings</h1>
                    <p className="text-muted-foreground">Manage shared work areas and reusable external contacts.</p>
                </div>
                <PmoSettingsTabs
                    initialTab={initialTab}
                    areasContent={
                        <>
                            {canManageAreas && areas.map((area) => <TableCellAssist key={area.id} entityId={area.id} columnKey="workArea" />)}
                            <WorkAreaManager canMutate={canManageAreas} initialAreas={canManageAreas ? areas.map(({ _count, ...area }) => ({ ...area, projectCount: _count.projects, caseStudyCount: _count.caseStudies })) : []} />
                        </>
                    }
                    contactsContent={
                        <>
                            {actor.role !== "VIEWER" && contacts.map((contact) => <TableCellAssist key={contact.id} entityId={contact.id} columnKey="contact" />)}
                            <ExternalContactManager initialContacts={actor.role === "VIEWER" ? [] : contacts} canMutate={actor.role !== "VIEWER"} />
                        </>
                    }
                />
            </div>
        </SabahFormProvider>
    );
}
