"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type ExternalContactDto = {
    id: string;
    name: string;
    email: string;
    department: string | null;
    organization: string | null;
    isArchived: boolean;
};
export type ExternalContactDialogProps = { triggerLabel?: string; onCreated: (contact: ExternalContactDto) => void };

export function ExternalContactDialog({ triggerLabel = "Add contact", onCreated }: ExternalContactDialogProps) {
    const [open, setOpen] = useState(false);
    const [duplicate, setDuplicate] = useState<ExternalContactDto | null>(null);
    const [error, setError] = useState("");
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        const data = Object.fromEntries(new FormData(event.currentTarget));
        const response = await fetch("/api/pmo/contacts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        const body = await response.json();
        if (response.status === 409 && body.contact) return setDuplicate(body.contact);
        if (!response.ok) return setError(body.error ?? "Unable to add contact");
        onCreated(body);
        setOpen(false);
    }
    async function useDuplicate() {
        if (!duplicate) return;
        if (duplicate.isArchived) {
            const response = await fetch(`/api/pmo/contacts/${duplicate.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isArchived: false }),
            });
            if (!response.ok) return setError("Unable to reactivate contact");
            duplicate.isArchived = false;
        }
        onCreated(duplicate);
        setOpen(false);
    }
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button type="button" variant="outline">
                    {triggerLabel}
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>External contact</DialogTitle>
                </DialogHeader>
                <form onSubmit={submit} className="space-y-3">
                    <Input name="name" placeholder="Name" required />
                    <Input name="email" type="email" placeholder="Email" required />
                    <Input name="department" placeholder="Department" />
                    <Input name="organization" placeholder="Organization" />
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <Button type="submit">Save contact</Button>
                    {duplicate && (
                        <Button type="button" variant="secondary" onClick={useDuplicate}>
                            {duplicate.isArchived ? "Reactivate and use" : "Use existing contact"}
                        </Button>
                    )}
                </form>
            </DialogContent>
        </Dialog>
    );
}
