"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_VIEW_METRIC } from "@/lib/view-aggregate-client";
import type { Block } from "./block-editor";

const METRICS = [
    { id: "my-open", label: "My open tasks" },
    { id: "my-overdue", label: "My overdue tasks" },
    { id: "my-due-today", label: "My tasks due today" },
    { id: "my-due-week", label: "My tasks due this week" },
    { id: "team-done-week", label: "Team done this week" },
    { id: "team-overdue", label: "Team overdue" },
    { id: "active-projects", label: "Active projects" },
    { id: "on-track-kpis", label: "On-track KPIs" },
    { id: "at-risk-kpis", label: "At-risk KPIs" },
];

const TONES = [
    { id: "violet", label: "Violet" },
    { id: "blue", label: "Blue" },
    { id: "emerald", label: "Emerald" },
    { id: "amber", label: "Amber" },
    { id: "rose", label: "Rose" },
];

export function StatTileBlockEditor({ block, onUpdate }: { block: Block; onUpdate: (b: Block) => void }) {
    return (
        <div className="space-y-3">
            <div>
                <Label>Metric</Label>
                <Select
                    value={typeof block.metric === "string" && block.metric.trim().length > 0 ? block.metric : DEFAULT_VIEW_METRIC}
                    onValueChange={(v) => onUpdate({ ...block, metric: v })}
                >
                    <SelectTrigger className="mt-1">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {METRICS.map((m) => (
                            <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div>
                <Label>Custom label (optional)</Label>
                <Input
                    value={(block.label as string) ?? ""}
                    onChange={(e) => onUpdate({ ...block, label: e.target.value })}
                    placeholder="Defaults to the metric label"
                    className="mt-1"
                />
            </div>
            <div>
                <Label>Color</Label>
                <Select
                    value={(block.tone as string) ?? "violet"}
                    onValueChange={(v) => onUpdate({ ...block, tone: v })}
                >
                    <SelectTrigger className="mt-1">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {TONES.map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
}
