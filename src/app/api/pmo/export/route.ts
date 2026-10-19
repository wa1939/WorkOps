import { canViewAllPmo } from "@/lib/pmo/authorization";
import { getCurrentPmoActor } from "@/lib/pmo/current-actor";
import { toRiyadhDate } from "@/lib/pmo/date";
import { escapeCsvCell, parsePmoFilters } from "@/lib/pmo/portfolio";
import { loadPmoPortfolio } from "@/lib/pmo/portfolio-query";

export async function GET(request: Request) {
    const actor = await getCurrentPmoActor();
    if (!actor) return new Response("Unauthorized", { status: 401 });
    if (!canViewAllPmo(actor)) return new Response("Forbidden", { status: 403 });
    const today = toRiyadhDate(new Date());
    const { rows } = await loadPmoPortfolio(parsePmoFilters(new URL(request.url).searchParams), actor, today);
    const header = ["Work area", "Parent type", "Parent", "Action", "Description", "Owner", "External contact", "Email", "Department", "Organization", "Status", "Priority", "Due date", "Due bucket", "Last response", "Last follow-up", "Next reminder", "Closure date", "Closure note", "Evidence"];
    const lines = [header, ...rows.map((row) => [
        row.workAreaName, row.parentType, row.parentName, row.title, row.description, row.ownerName,
        row.contactName, row.contactEmail, row.contactDepartment, row.contactOrganization, row.status,
        row.priority, row.dueDate, row.dueBucket, row.lastResponseAt ?? "", row.lastFollowUpAt ?? "",
        row.nextReminder ?? "", row.closedAt ?? "", row.closureNote,
        row.evidence.map((item) => `${item.label}: ${item.url}`).join(" | "),
    ])].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
    return new Response(`\uFEFF${lines}`, {
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="pmo-external-actions-${today}.csv"`,
        },
    });
}
