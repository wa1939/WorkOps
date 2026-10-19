"use client";

import React from "react";
import { Eye, Save } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CoverPicker } from "./cover-picker";

export function ViewEditorActions({
    viewId,
    cover,
    saving,
    onCoverChange,
    onSave,
}: {
    viewId: string;
    cover: string | null;
    saving: boolean;
    onCoverChange: (cover: string | null) => void;
    onSave: () => void;
}) {
    return (
        <div data-testid="view-editor-actions" className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
            <CoverPicker value={cover} onChange={onCoverChange} className="h-11 w-full min-w-0 basis-full sm:h-10 sm:w-auto sm:basis-auto sm:flex-none" />
            <Button variant="outline" asChild className="h-11 min-w-0 flex-1 sm:h-10 sm:flex-none">
                <Link href={`/views/${viewId}`}>
                    <Eye className="mr-2 h-4 w-4" />
                    Preview
                </Link>
            </Button>
            <Button onClick={onSave} disabled={saving} className="h-11 min-w-0 flex-1 sm:h-10 sm:flex-none">
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Saving..." : "Save"}
            </Button>
        </div>
    );
}
