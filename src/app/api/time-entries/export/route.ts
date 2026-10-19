import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTimeEntries } from "@/lib/time/aggregation";

const isoDate = z.union([
    z.string().date(),
    z.string().datetime({ offset: true }),
]);

const filterSchema = z.object({
    from: isoDate,
    to: isoDate,
    userId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
}).superRefine((value, context) => {
    if (new Date(value.to).getTime() <= new Date(value.from).getTime()) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "to must be after from" });
    }
});

type SessionUser = { id?: unknown; role?: unknown };
const EXPORT_HEADERS = ["Date", "TaskKey", "Task", "Project", "User", "Minutes", "Note", "Source"];
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function canQueryOtherUsers(role: unknown): boolean {
    return role === "ADMIN" || role === "LEAD" || role === "MANAGER";
}

function workbookBytes(rows: Array<Record<string, string | number>>): Uint8Array {
    const worksheet = XLSX.utils.json_to_sheet(rows, { header: EXPORT_HEADERS });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Time Entries");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new Uint8Array(buffer);
}

export async function POST(request: Request): Promise<Response> {
    try {
        const session = await auth();
        const sessionUser = (session?.user ?? {}) as SessionUser;
        if (typeof sessionUser.id !== "string" || sessionUser.id.length === 0) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
        }
        const parsed = filterSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
        }

        const targetUserId = parsed.data.userId ?? sessionUser.id;
        if (targetUserId !== sessionUser.id && !canQueryOtherUsers(sessionUser.role)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const logs = await getTimeEntries({
            from: new Date(parsed.data.from),
            to: new Date(parsed.data.to),
            userId: targetUserId,
            projectId: parsed.data.projectId,
            taskId: parsed.data.taskId,
        });
        const rows = logs.map((log) => ({
            Date: log.startedAt.toISOString().slice(0, 10),
            TaskKey: log.task.taskKey ?? "",
            Task: log.task.title,
            Project: log.task.project?.name ?? "",
            User: log.user.name || log.user.email,
            Minutes: log.minutes,
            Note: log.note ?? "",
            Source: log.source,
        }));
        const bytes = workbookBytes(rows);

        return new Response(bytes.buffer as ArrayBuffer, {
            status: 200,
            headers: {
                "Content-Type": XLSX_CONTENT_TYPE,
                "Content-Disposition": 'attachment; filename="time-entries.xlsx"',
                "Cache-Control": "no-store",
            },
        });
    } catch (error) {
        console.error("Failed to export time entries", error);
        return NextResponse.json({ error: "Failed to export time entries" }, { status: 500 });
    }
}
