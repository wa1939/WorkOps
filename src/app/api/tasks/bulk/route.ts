import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { executeBulk, bulkInputSchema, type BulkViewer } from "@/lib/tasks/bulk";

export const dynamic = "force-dynamic";

const EXPORT_HEADERS = ["title", "key", "status", "priority", "assignees", "due", "estimate", "project"];
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type SessionUser = {
    id?: unknown;
    role?: unknown;
    departmentIds?: unknown;
};

function viewerFromSession(user: SessionUser): BulkViewer | null {
    if (typeof user.id !== "string" || user.id.length === 0) return null;
    return {
        id: user.id,
        role: typeof user.role === "string" && user.role.length > 0 ? user.role : "MEMBER",
        departmentIds: Array.isArray(user.departmentIds)
            ? user.departmentIds.filter((id): id is string => typeof id === "string")
            : [],
    };
}

function exportWorkbook(rows: NonNullable<Awaited<ReturnType<typeof executeBulk>>["exportRows"]>): Uint8Array {
    const worksheet = XLSX.utils.json_to_sheet(rows, { header: EXPORT_HEADERS });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Tasks");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new Uint8Array(buffer);
}

export async function POST(request: Request): Promise<Response> {
    let session: { user?: unknown } | null = null;
    try {
        session = await auth();
    } catch (error) {
        console.error("POST /api/tasks/bulk session lookup failed", error);
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const viewer = viewerFromSession((session?.user ?? {}) as SessionUser);
    if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = bulkInputSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    try {
        const execution = await executeBulk(parsed.data, viewer);
        if (parsed.data.action === "export") {
            const bytes = exportWorkbook(execution.exportRows ?? []);
            return new Response(bytes.buffer as ArrayBuffer, {
                status: 200,
                headers: {
                    "Content-Type": XLSX_CONTENT_TYPE,
                    "Content-Disposition": 'attachment; filename="tasks-export.xlsx"',
                    "Cache-Control": "no-store",
                },
            });
        }
        return NextResponse.json({ results: execution.results });
    } catch (error) {
        console.error("POST /api/tasks/bulk failed", error);
        return NextResponse.json({ error: "Failed to execute bulk action" }, { status: 500 });
    }
}
