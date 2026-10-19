import { NextResponse } from "next/server"; import { processPmoReminderRun } from "@/lib/pmo/reminder-service";
async function handle(request: Request) { const secret = process.env.CRON_SECRET; if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); return NextResponse.json(await processPmoReminderRun({ now: new Date() })); }
export const GET = handle; export const POST = handle;
