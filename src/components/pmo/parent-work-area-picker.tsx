"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ParentWorkAreaPickerProps = {
    parentType: "project" | "case-study";
    parentId: string;
    currentWorkAreaId: string | null;
    expectedUpdatedAt: string;
    workAreas: Array<{ id: string; name: string }>;
    canEditParent: boolean;
};

export function buildWorkAreaUpdate(next: string, expectedUpdatedAt: string): { workAreaId: string | null; expectedUpdatedAt: string } {
    return { workAreaId: next === "unclassified" ? null : next, expectedUpdatedAt };
}

export function ParentWorkAreaPicker({
    parentType,
    parentId,
    currentWorkAreaId,
    expectedUpdatedAt,
    workAreas,
    canEditParent,
}: ParentWorkAreaPickerProps) {
    const router = useRouter();
    const [value, setValue] = useState(currentWorkAreaId ?? "unclassified");
    const [pending, setPending] = useState(false);
    if (!canEditParent)
        return (
            <span className="rounded-full bg-muted px-3 py-1 text-xs">
                {workAreas.find((area) => area.id === currentWorkAreaId)?.name ?? "Unclassified"}
            </span>
        );

    async function update(next: string) {
        if (pending) return;
        const previous = value;
        setValue(next);
        setPending(true);
        try {
            const response = await fetch(`/api/${parentType === "project" ? "projects" : "case-studies"}/${parentId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildWorkAreaUpdate(next, expectedUpdatedAt)),
            });
            if (!response.ok) { setValue(previous); return; }
            startTransition(() => router.refresh());
        } catch { setValue(previous); } finally { setPending(false); }
    }

    return (
        <Select value={value} onValueChange={update} disabled={pending}>
            <SelectTrigger className="w-52">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="unclassified">Unclassified</SelectItem>
                {workAreas.map((area) => (
                    <SelectItem key={area.id} value={area.id}>
                        {area.name}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
