"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExternalContactDialog, type ExternalContactDto } from "./external-contact-dialog";

export function ExternalContactManager({
    initialContacts,
    canMutate,
}: {
    initialContacts: ExternalContactDto[];
    canMutate: boolean;
}) {
    const [contacts, setContacts] = useState(initialContacts);
    const [search, setSearch] = useState("");
    async function patch(contact: ExternalContactDto, input: Partial<ExternalContactDto>) {
        const response = await fetch(`/api/pmo/contacts/${contact.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        if (response.ok) {
            const body = await response.json();
            setContacts((items) => items.map((item) => (item.id === body.id ? body : item)));
        }
    }
    const visible = contacts.filter((contact) =>
        `${contact.name} ${contact.email} ${contact.organization ?? ""}`.toLowerCase().includes(search.toLowerCase()),
    );
    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search contacts"
                />
                {canMutate && (
                    <ExternalContactDialog onCreated={(contact) => setContacts((items) => [...items, contact])} />
                )}
            </div>
            <div className="space-y-2">
                {visible.map((contact) => (
                    <div key={contact.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                        <div className="min-w-0 flex-1">
                            <p className="font-medium" dir="auto">
                                {contact.name}
                            </p>
                            <p className="text-sm text-muted-foreground">{contact.email}</p>
                        </div>
                        {canMutate && (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => patch(contact, { isArchived: !contact.isArchived })}
                            >
                                {contact.isArchived ? "Reactivate" : "Archive"}
                            </Button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
