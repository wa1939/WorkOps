"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Block } from "./block-editor";

type ProjectOption = { id: string; name: string };

export function ProjectSnapshotBlockEditor({ block, onUpdate }: { block: Block; onUpdate: (b: Block) => void }) {
    const [projects, setProjects] = useState<ProjectOption[]>([]);

    useEffect(() => {
        fetch("/api/projects")
            .then((r) => r.json())
            .then((data: ProjectOption[]) => setProjects(data))
            .catch(() => setProjects([]));
    }, []);

    return (
        <div>
            <Label>Pick a project</Label>
            <Select
                value={(block.projectId as string) ?? ""}
                onValueChange={(v) => onUpdate({ ...block, projectId: v })}
            >
                <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                    {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
