"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Block } from "./block-editor";

type KpiOption = { id: string; name: string; perspective: string };

export function KpiSnapshotBlockEditor({ block, onUpdate }: { block: Block; onUpdate: (b: Block) => void }) {
    const [kpis, setKpis] = useState<KpiOption[]>([]);

    useEffect(() => {
        fetch("/api/kpis")
            .then((r) => r.json())
            .then((data: KpiOption[]) => setKpis(data))
            .catch(() => setKpis([]));
    }, []);

    return (
        <div>
            <Label>Pick a KPI</Label>
            <Select
                value={(block.kpiId as string) ?? ""}
                onValueChange={(v) => onUpdate({ ...block, kpiId: v })}
            >
                <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select a KPI" />
                </SelectTrigger>
                <SelectContent>
                    {kpis.map((k) => (
                        <SelectItem key={k.id} value={k.id}>
                            {k.name} · {k.perspective}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
