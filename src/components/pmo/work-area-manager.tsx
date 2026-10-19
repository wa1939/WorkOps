"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export type WorkAreaDto = {
    id: string;
    name: string;
    description: string | null;
    displayOrder: number;
    isArchived: boolean;
    projectCount: number;
    caseStudyCount: number;
};

// Archiving reclassifies nothing but hides the area from pickers, so it gets an
// explicit confirm. Reactivating is non-destructive and needs none.
function ArchiveWorkAreaButton({ area, onConfirm }: { area: WorkAreaDto; onConfirm: () => void }) {
    const [open, setOpen] = useState(false);
    return (
        <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                    Archive
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Archive <span dir="auto">{area.name}</span>?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        Projects and case studies keep their classification. The area is hidden from pickers and you can
                        reactivate it later.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Keep active</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={() => {
                            setOpen(false);
                            onConfirm();
                        }}
                    >
                        Archive
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

function DeleteWorkAreaButton({
    area,
    pending,
    onConfirm,
}: {
    area: WorkAreaDto;
    pending: boolean;
    onConfirm: () => Promise<boolean>;
}) {
    const [open, setOpen] = useState(false);
    const referenceCount = area.projectCount + area.caseStudyCount;

    if (referenceCount > 0) {
        return (
            <div className="space-y-1">
                <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="min-h-11"
                    aria-label={`Delete ${area.name}`}
                    title="Archive this area instead"
                    disabled
                >
                    Delete
                </Button>
                <p className="max-w-48 text-xs text-muted-foreground">
                    Archive this area instead; permanent deletion is available only for empty areas.
                </p>
            </div>
        );
    }

    return (
        <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>
                <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="min-h-11"
                    aria-label={`Delete ${area.name}`}
                    disabled={pending}
                >
                    Delete
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Permanently delete <span dir="auto">{area.name}</span>?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        This cannot be undone. Delete is available only because no projects or case studies use this
                        area. Use Archive when you need to preserve an area and its history.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>Keep area</AlertDialogCancel>
                    <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        disabled={pending}
                        onClick={async (event) => {
                            event.preventDefault();
                            if (await onConfirm()) setOpen(false);
                        }}
                    >
                        {pending ? "Deleting…" : "Delete permanently"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

export function WorkAreaManager({
    initialAreas,
    canMutate,
}: {
    initialAreas: WorkAreaDto[];
    canMutate: boolean;
}) {
    const [areas, setAreas] = useState(initialAreas);
    const [name, setName] = useState("");
    const [error, setError] = useState("");
    const [pendingAreaId, setPendingAreaId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    async function create(event: FormEvent) {
        event.preventDefault();
        setError("");
        setCreating(true);
        try {
            const response = await fetch("/api/pmo/work-areas", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
            });
            const body = await response.json();
            if (!response.ok) return setError(body.error ?? "Unable to add work area");
            setAreas((current) => [...current, body]);
            setName("");
        } catch {
            setError("Unable to add work area. Check your connection and try again.");
        } finally {
            setCreating(false);
        }
    }

    async function patch(area: WorkAreaDto, input: Partial<WorkAreaDto>) {
        setError("");
        setPendingAreaId(area.id);
        try {
            const response = await fetch(`/api/pmo/work-areas/${area.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
            });
            const body = await response.json();
            if (!response.ok) return setError(body.error ?? "Unable to update work area");
            setAreas((current) => current.map((item) => (item.id === area.id ? body : item)));
        } catch {
            setError("Unable to update work area. Check your connection and try again.");
        } finally {
            setPendingAreaId(null);
        }
    }

    async function remove(area: WorkAreaDto): Promise<boolean> {
        setError("");
        setPendingAreaId(area.id);
        try {
            const response = await fetch(`/api/pmo/work-areas/${area.id}`, { method: "DELETE" });
            const body = await response.json();
            if (!response.ok) {
                if (response.status === 409) {
                    setAreas((current) =>
                        current.map((item) =>
                            item.id === area.id
                                ? {
                                      ...item,
                                      projectCount: body.projectCount ?? item.projectCount,
                                      caseStudyCount: body.caseStudyCount ?? item.caseStudyCount,
                                  }
                                : item,
                        ),
                    );
                }
                setError(body.error ?? "Unable to delete work area");
                return false;
            }
            setAreas((current) => current.filter((item) => item.id !== area.id));
            return true;
        } catch {
            setError("Unable to delete work area. Check your connection and try again.");
            return false;
        } finally {
            setPendingAreaId(null);
        }
    }

    return (
        <div className="space-y-4">
            {canMutate && (
                <form onSubmit={create} className="flex gap-2">
                    <Input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Work area name"
                        required
                        disabled={creating}
                    />
                    <Button type="submit" disabled={creating}>
                        {creating ? "Adding…" : "Add area"}
                    </Button>
                </form>
            )}
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
            <div className="space-y-2">
                {areas.map((area) => (
                    <div key={area.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                        {canMutate ? (
                            <>
                                <Input
                                    aria-label={`Name for ${area.name}`}
                                    className="max-w-xs"
                                    defaultValue={area.name}
                                    disabled={pendingAreaId === area.id}
                                    onBlur={(event) =>
                                        event.target.value !== area.name && patch(area, { name: event.target.value })
                                    }
                                />
                                <Input
                                    aria-label={`Order for ${area.name}`}
                                    className="w-24"
                                    type="number"
                                    defaultValue={area.displayOrder}
                                    disabled={pendingAreaId === area.id}
                                    onBlur={(event) => patch(area, { displayOrder: Number(event.target.value) })}
                                />
                            </>
                        ) : (
                            <div className="min-w-48">
                                <p className="font-medium" dir="auto">
                                    {area.name}
                                </p>
                                <p className="text-xs text-muted-foreground">Display order: {area.displayOrder}</p>
                            </div>
                        )}
                        <span className="text-xs text-muted-foreground">
                            {area.projectCount} projects, {area.caseStudyCount} cases
                        </span>
                        {canMutate && (
                            <div className="ml-auto flex flex-wrap items-start gap-2">
                                {area.isArchived ? (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="min-h-11"
                                        disabled={pendingAreaId === area.id}
                                        onClick={() => patch(area, { isArchived: false })}
                                    >
                                        Reactivate
                                    </Button>
                                ) : (
                                    <ArchiveWorkAreaButton
                                        area={area}
                                        onConfirm={() => patch(area, { isArchived: true })}
                                    />
                                )}
                                <DeleteWorkAreaButton
                                    area={area}
                                    pending={pendingAreaId === area.id}
                                    onConfirm={() => remove(area)}
                                />
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
