"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Folder, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import type { Block } from "./block-editor";

type Project = {
    id: string;
    name: string;
    status: string;
    dueAt?: string | null;
    owner?: { name: string | null } | null;
    tasks: { status: string }[];
};

export function ProjectSnapshotBlock({ block }: { block: Block }) {
    const id = block.projectId as string | undefined;
    const [project, setProject] = useState<Project | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!id) { setLoading(false); return; }
        fetch(`/api/projects/${id}`)
            .then((r) => r.ok ? r.json() : null)
            .then((data: Project | null) => setProject(data))
            .finally(() => setLoading(false));
    }, [id]);

    if (!id) {
        return (
            <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Pick a project in the editor.
            </div>
        );
    }

    if (loading) {
        return (
            <div className="rounded-xl border border-border bg-card p-5 flex items-center justify-center h-32">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!project) {
        return (
            <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                Project not found.
            </div>
        );
    }

    const total = project.tasks.filter((t) => t.status !== "CANCELED").length;
    const done = project.tasks.filter((t) => t.status === "DONE").length;
    const progress = total > 0 ? (done / total) * 100 : 0;

    return (
        <Link href={`/projects/${project.id}`}>
            <div className="rounded-xl border border-border bg-gradient-to-br from-blue-500/10 to-transparent p-4 hover:border-blue-500/40 transition-colors">
                <div className="flex items-start gap-2 mb-3">
                    <Folder className="h-4 w-4 text-blue-400 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{project.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{project.status}</Badge>
                            {project.owner?.name && (
                                <span className="text-xs text-muted-foreground truncate">· {project.owner.name}</span>
                            )}
                        </div>
                    </div>
                </div>
                <div className="space-y-1.5">
                    <Progress value={progress} className="h-1.5" />
                    <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                        <span>{done}/{total} tasks</span>
                        <span>{Math.round(progress)}%</span>
                    </div>
                    {project.dueAt && (
                        <p className="text-xs text-muted-foreground">
                            Due {new Date(project.dueAt).toLocaleDateString()}
                        </p>
                    )}
                </div>
            </div>
        </Link>
    );
}
