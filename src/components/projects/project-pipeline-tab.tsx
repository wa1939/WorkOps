"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, GitBranch } from "lucide-react";
import { PipelineView, type PipelineStage, type PipelineTask } from "@/components/projects/pipeline-view";

interface ProjectPipelineTabProps {
    projectId: string;
    stages: PipelineStage[];
    tasks: PipelineTask[];
}

export function ProjectPipelineTab({ projectId, stages: initialStages, tasks }: ProjectPipelineTabProps) {
    const { toast } = useToast();
    const [creating, setCreating] = useState(false);
    // Hold stages locally so creating a pipeline renders it in place — no server
    // refresh (which would reset the uncontrolled Tabs back to the Overview tab).
    const [stages, setStages] = useState<PipelineStage[]>(initialStages);

    const createPipeline = async () => {
        setCreating(true);
        try {
            const res = await fetch(`/api/projects/${projectId}/stages/init`, { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            setStages(data.stages ?? []);
            toast({ title: "Pipeline created", description: "5 default stages added. Drag tasks to organize them." });
        } catch (error) {
            toast({ title: "Couldn't create pipeline", description: (error as Error).message, variant: "destructive" });
        } finally {
            setCreating(false);
        }
    };

    if (stages.length === 0) {
        return (
            <div className="rounded-lg border border-dashed p-10 text-center max-w-md mx-auto">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
                    <GitBranch className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-base font-semibold mb-1">Organize this project into stages</h3>
                <p className="text-sm text-muted-foreground mb-5">
                    Add a Kickoff → Planning → Execution → Review → Wrap-up pipeline, then drag tasks across stages as they move.
                </p>
                <Button onClick={createPipeline} disabled={creating}>
                    {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitBranch className="mr-2 h-4 w-4" />}
                    Create default pipeline
                </Button>
            </div>
        );
    }

    return <PipelineView projectId={projectId} stages={stages} tasks={tasks} />;
}
