import { ArrowLeft, CalendarRange } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import type { AuthzUser } from "@/lib/authz/types";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { TaskGantt } from "@/components/tasks/gantt/TaskGantt";

export default async function ProjectRoadmapPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const session = await auth();
    if (!session?.user?.id) return null;

    const { id } = await params;
    const actor: AuthzUser = {
        id: session.user.id,
        role: typeof session.user.role === "string" ? session.user.role : null,
    };
    if (!(await authorize(actor, "project:view", { kind: "project", id }))) {
        notFound();
    }

    const project = await prisma.project.findUnique({
        where: { id },
        select: { id: true, name: true },
    });
    if (!project) notFound();

    return (
        <div className="mx-auto max-w-7xl space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <Button variant="ghost" asChild className="mb-3 -ml-3">
                        <Link href={`/projects/${project.id}`}>
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Back to project
                        </Link>
                    </Button>
                    <div className="flex items-center gap-2">
                        <CalendarRange className="h-6 w-6 text-muted-foreground" />
                        <h1 className="text-2xl font-semibold">{project.name} roadmap</h1>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Plan the work by stage and reschedule dated tasks directly on the timeline.
                    </p>
                </div>
                <Button variant="outline" asChild>
                    <Link href={`/projects/${project.id}`}>Project overview</Link>
                </Button>
            </div>

            <TaskGantt projectId={project.id} />
        </div>
    );
}
