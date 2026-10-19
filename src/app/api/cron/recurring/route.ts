import { NextResponse } from "next/server";
import { runDueRecurrences } from "@/lib/tasks/materialize";

export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const counts = await runDueRecurrences(new Date());
        return NextResponse.json({ ok: true, ...counts });
    } catch {
        return NextResponse.json({ error: "Failed to materialize recurring tasks" }, { status: 500 });
    }
}
