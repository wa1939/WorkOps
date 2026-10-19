"use client";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Evidence = { id: string; label: string; url: string; createdAt: string };
export function EvidenceList({
    taskId,
    initialEvidence,
    canManage,
}: {
    taskId: string;
    initialEvidence: Evidence[];
    canManage: boolean;
}) {
    const [items, setItems] = useState(initialEvidence);
    const [error, setError] = useState("");
    async function add(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        const response = await fetch(`/api/pmo/actions/${taskId}/evidence`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        const body = await response.json();
        if (!response.ok) return setError(body.error ?? "Unable to add evidence");
        setItems((current) => [...current, { ...body, createdAt: new Date(body.createdAt).toISOString() }]);
        event.currentTarget.reset();
    }
    async function remove(id: string) {
        const response = await fetch(`/api/pmo/actions/${taskId}/evidence/${id}`, { method: "DELETE" });
        if (!response.ok) {
            const body = await response.json();
            return setError(body.error ?? "Unable to remove evidence");
        }
        setItems((current) => current.filter((item) => item.id !== id));
    }
    return (
        <div className="space-y-3">
            <div className="space-y-2">
                {items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 rounded-md border p-2">
                        <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex-1 text-sm font-medium text-primary underline"
                            dir="auto"
                        >
                            {item.label}
                        </a>
                        {canManage && (
                            <Button size="sm" variant="ghost" onClick={() => remove(item.id)}>
                                Remove
                            </Button>
                        )}
                    </div>
                ))}
                {items.length === 0 && <p className="text-sm text-muted-foreground">No evidence links yet.</p>}
            </div>
            {canManage && (
                <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                    <Input name="label" placeholder="Evidence label" required />
                    <Input name="url" type="url" placeholder="https://..." required />
                    <Button>Add</Button>
                </form>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
    );
}
