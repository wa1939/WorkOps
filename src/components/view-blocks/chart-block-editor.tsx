"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_VIEW_CHART_KIND } from "@/lib/view-aggregate-client";
import type { Block } from "./block-editor";

const CHART_KINDS = [
    { id: "task-by-status", label: "Tasks by Status (pie)" },
    { id: "task-by-priority", label: "Tasks by Priority (bar)" },
    { id: "task-by-project", label: "Tasks by Project (bar)" },
    { id: "task-completion-trend", label: "Completion trend — last 14 days (line)" },
    { id: "kpi-by-perspective", label: "KPIs by Perspective (pie)" },
    { id: "kpi-status", label: "KPI Status (bar)" },
];

export function ChartBlockEditor({ block, onUpdate }: { block: Block; onUpdate: (b: Block) => void }) {
    return (
        <div className="space-y-3">
            <div>
                <Label>Chart type</Label>
                <Select
                    value={typeof block.chartKind === "string" && block.chartKind.trim().length > 0 ? block.chartKind : DEFAULT_VIEW_CHART_KIND}
                    onValueChange={(v) => onUpdate({ ...block, chartKind: v })}
                >
                    <SelectTrigger className="mt-1">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {CHART_KINDS.map((k) => (
                            <SelectItem key={k.id} value={k.id}>{k.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div>
                <Label>Title</Label>
                <Input
                    value={(block.title as string) ?? ""}
                    onChange={(e) => onUpdate({ ...block, title: e.target.value })}
                    placeholder="e.g. Weekly activity"
                    className="mt-1"
                />
            </div>
        </div>
    );
}
