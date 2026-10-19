import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TimeEntriesClient } from "@/components/time/time-entries-client";

const elevatedRoles = new Set(["ADMIN", "LEAD", "MANAGER"]);

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

function dayString(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function startOfWeek(value: Date): Date {
    const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    date.setUTCDate(date.getUTCDate() - date.getUTCDay());
    return date;
}

function initialWeek(from: string | undefined): { from: string; to: string } {
    const parsed = from ? new Date(`${from}T00:00:00.000Z`) : new Date();
    const start = Number.isNaN(parsed.getTime()) ? startOfWeek(new Date()) : startOfWeek(parsed);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return { from: dayString(start), to: dayString(end) };
}

export default async function TimeEntriesPage({ searchParams }: { searchParams: SearchParams }) {
    const session = await auth();
    const sessionUser = session?.user;
    if (!sessionUser?.id) return null;

    const params = await searchParams;
    const role = typeof sessionUser.role === "string" ? sessionUser.role : "MEMBER";
    const canFilterMembers = elevatedRoles.has(role);
    const week = initialWeek(firstParam(params.from));

    const [members, projects, tasks] = await Promise.all([
        canFilterMembers
            ? prisma.user.findMany({
                where: { isActive: true },
                select: { id: true, name: true, email: true },
                orderBy: { name: "asc" },
            })
            : Promise.resolve([]),
        prisma.project.findMany({
            select: { id: true, name: true },
            orderBy: { name: "asc" },
        }),
        prisma.task.findMany({
            where: { archived: false },
            select: { id: true, taskKey: true, title: true },
            orderBy: { title: "asc" },
            take: 500,
        }),
    ]);

    return (
        <TimeEntriesClient
            canFilterMembers={canFilterMembers}
            initialFrom={week.from}
            initialTo={week.to}
            initialMemberId={canFilterMembers ? firstParam(params.member) ?? "" : ""}
            initialProjectId={firstParam(params.project) ?? ""}
            initialTaskId={firstParam(params.taskId) ?? ""}
            members={members.map((member) => ({ id: member.id, name: member.name, email: member.email }))}
            projects={projects}
            tasks={tasks}
        />
    );
}
