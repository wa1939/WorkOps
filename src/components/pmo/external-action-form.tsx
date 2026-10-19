"use client";

import { FormEvent, useEffect, useState } from "react";
import { useSabahForm } from "@/components/sabah/forms/form-context";
import { FieldAssist } from "@/components/sabah/forms/field-assist";
import type { SabahFieldDescriptor } from "@/components/sabah/forms/contracts";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ExternalContactDialog, type ExternalContactDto } from "./external-contact-dialog";

type Parent = { id: string; name: string; workArea: { id: string; name: string } | null };
type Option = { id: string; name: string };
type Status = "TODO" | "DOING" | "BLOCKED" | "WAITING";
type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type ExternalActionFormValue = {
    taskId: string;
    title: string;
    description: string;
    priority: Priority;
    status: Status;
    ownerId: string;
    externalContactId: string;
    dueDate: string;
    projectId: string | null;
    caseStudyId: string | null;
    collaboratorIds: string[];
    tagIds: string[];
    dependencyIds: string[];
    reminderOffsets: number[];
    overdueIntervalDays: number | null;
};

type Props = {
    mode: "create" | "edit";
    initial?: ExternalActionFormValue;
    users: Array<{ id: string; name: string; email: string }>;
    projects: Parent[];
    caseStudies: Parent[];
    contacts: ExternalContactDto[];
    tags: Option[];
    dependencies: Option[];
    workAreas: Option[];
    preselectedParent?: { type: "project" | "case-study"; id: string };
    recordVersion?: string | null;
};

export function ExternalActionForm(props: Props) {
    const router = useRouter();
    const form = useSabahForm();
    const { registerField, unregisterField } = form;
    const [title, setTitle] = useState(props.initial?.title ?? "");
    const [description, setDescription] = useState(props.initial?.description ?? "");
    const [dueDate, setDueDate] = useState(props.initial?.dueDate ?? "");
    const [contacts, setContacts] = useState(props.contacts);
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const initialParent = props.initial?.projectId
        ? `project:${props.initial.projectId}`
        : props.initial?.caseStudyId
          ? `case-study:${props.initial.caseStudyId}`
          : props.preselectedParent
            ? `${props.preselectedParent.type}:${props.preselectedParent.id}`
            : "";
    const [parent, setParent] = useState(initialParent);
    const [classificationWorkAreaId, setClassificationWorkAreaId] = useState("");
    const [ownerId, setOwnerId] = useState(props.initial?.ownerId ?? "");
    const [contactId, setContactId] = useState(props.initial?.externalContactId ?? "");
    const [priority, setPriority] = useState<Priority>(props.initial?.priority ?? "MEDIUM");
    const [status, setStatus] = useState<Status>(props.initial?.status ?? "WAITING");
    const [collaboratorIds, setCollaboratorIds] = useState(props.initial?.collaboratorIds ?? []);
    const [tagIds, setTagIds] = useState(props.initial?.tagIds ?? []);
    const [dependencyIds, setDependencyIds] = useState(props.initial?.dependencyIds ?? []);
    const [overdueEnabled, setOverdueEnabled] = useState(
        props.initial ? props.initial.overdueIntervalDays !== null : true,
    );
    const [reminderDays, setReminderDays] = useState<number[]>(props.initial?.reminderOffsets ?? [30, 7, 0]);
    const [reminderDraft, setReminderDraft] = useState("");
    const [reminderError, setReminderError] = useState("");

    useEffect(() => {
        const descriptor = <T,>(name: string, label: string, value: T, empty: boolean, setValue: (next: T) => void): SabahFieldDescriptor<T> => ({
            name, label, value, empty, protected: false, risk: "DRAFT", actions: ["SUGGEST"],
            validate: async (next) => ({ ok: true, value: next as T }), setValue,
        });
        const fields = [
            descriptor("title", "Action title", title, title.trim() === "", setTitle),
            descriptor("description", "Requested action", description, description.trim() === "", setDescription),
            descriptor("parent", "Parent", parent, parent === "", setParent),
            descriptor("ownerId", "Accountable owner", ownerId, ownerId === "", setOwnerId),
            descriptor("externalContactId", "External contact", contactId, contactId === "", setContactId),
            descriptor("dueDate", "Due date", dueDate, dueDate === "", setDueDate),
            descriptor("priority", "Priority", priority, false, setPriority),
            ...(props.mode === "edit" ? [descriptor("status", "Status", status, false, setStatus)] : []),
        ];
        fields.forEach((field) => registerField(field));
        return () => fields.forEach((field) => unregisterField(field.name));
    }, [contactId, description, dueDate, ownerId, parent, priority, props.mode, registerField, status, title]);

    const parents = [
        ...props.projects.map((item) => ({ ...item, type: "project" as const })),
        ...props.caseStudies.map((item) => ({ ...item, type: "case-study" as const })),
    ];
    const selectedParent = parents.find((item) => `${item.type}:${item.id}` === parent);

    function toggle(value: string, values: string[], setValues: (next: string[]) => void) {
        setValues(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
    }

    function addReminderDay() {
        const trimmed = reminderDraft.trim();
        if (trimmed === "") {
            setReminderError("Enter a number of days.");
            return;
        }
        const day = Number(trimmed);
        if (!Number.isInteger(day) || day < 0 || day > 365) {
            setReminderError("Use a whole number of days between 0 and 365.");
            return;
        }
        if (reminderDays.includes(day)) {
            setReminderError("That reminder day is already added.");
            return;
        }
        setReminderDays([...reminderDays, day].sort((a, b) => b - a));
        setReminderDraft("");
        setReminderError("");
    }

    function removeReminderDay(day: number) {
        setReminderDays(reminderDays.filter((value) => value !== day));
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSaving(true);
        setError("");
        const data = new FormData(event.currentTarget);
        const [parentType, parentId] = parent.split(":");

        const payload = {
            title,
            description,
            priority,
            ...(props.mode === "edit" ? { status, expectedUpdatedAt: props.recordVersion } : {}),
            ...(props.mode === "create" && !selectedParent?.workArea && classificationWorkAreaId
                ? { classifyParentWorkAreaId: classificationWorkAreaId }
                : {}),
            ownerId,
            externalContactId: contactId,
            dueDate,
            projectId: parentType === "project" ? parentId : null,
            caseStudyId: parentType === "case-study" ? parentId : null,
            collaboratorIds: collaboratorIds.filter((id) => id !== ownerId),
            tagIds,
            dependencyIds,
            reminderOffsets: String(data.get("reminders") ?? "30,7,0")
                .split(",")
                .map(Number)
                .filter((offset) => Number.isFinite(offset)),
            overdueIntervalDays: overdueEnabled ? Number(data.get("overdueIntervalDays") ?? 7) : null,
        };
        const response = await fetch(
            props.mode === "create" ? "/api/pmo/actions" : `/api/pmo/actions/${props.initial?.taskId}`,
            {
                method: props.mode === "create" ? "POST" : "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            },
        );
        const body = await response.json();
        if (!response.ok) {
            setError(body.error ?? "Unable to save action");
            setSaving(false);
            return;
        }
        router.push(`/tasks/${body.taskId ?? props.initial?.taskId}`);
        router.refresh();
    }

    return (
        <form onSubmit={submit} className="space-y-5">
            <div>
                <div className="flex items-center gap-2"><Label>Parent *</Label><FieldAssist fieldName="parent" /></div>
                <Select value={parent} onValueChange={setParent}>
                    <SelectTrigger aria-label="Parent">
                        <SelectValue placeholder="Select a project or case study" />
                    </SelectTrigger>
                    <SelectContent>
                        {parents.map((item) => (
                            <SelectItem key={`${item.type}:${item.id}`} value={`${item.type}:${item.id}`}>
                                {item.name} - {item.workArea?.name ?? "Unclassified"}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            {selectedParent && !selectedParent.workArea && (
                <div>
                    <Label>Classify parent work area *</Label>
                    <Select value={classificationWorkAreaId} onValueChange={setClassificationWorkAreaId}>
                        <SelectTrigger aria-label="Classify parent work area">
                            <SelectValue placeholder="Choose work area" />
                        </SelectTrigger>
                        <SelectContent>
                            {props.workAreas.map((area) => (
                                <SelectItem key={area.id} value={area.id}>
                                    {area.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}
            <div>
                <div className="flex items-center gap-2"><Label htmlFor="title">Action title *</Label><FieldAssist fieldName="title" /></div>
                <Input id="title" name="title" value={title} onChange={(event) => setTitle(event.target.value)} required dir="auto" />
            </div>
            <div>
                <div className="flex items-center gap-2"><Label htmlFor="description">Requested action *</Label><FieldAssist fieldName="description" /></div>
                <Textarea
                    id="description"
                    name="description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    required
                    dir="auto"
                />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <div className="flex items-center gap-2"><Label>Accountable owner *</Label><FieldAssist fieldName="ownerId" /></div>
                    <Select value={ownerId} onValueChange={setOwnerId}>
                        <SelectTrigger aria-label="Accountable owner">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {props.users.map((user) => (
                                <SelectItem key={user.id} value={user.id}>
                                    {user.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <div className="flex items-center gap-2"><Label>External contact *</Label><FieldAssist fieldName="externalContactId" /></div>
                    <div className="flex gap-2">
                        <Select value={contactId} onValueChange={setContactId}>
                            <SelectTrigger aria-label="External contact">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {contacts
                                    .filter((contact) => !contact.isArchived)
                                    .map((contact) => (
                                        <SelectItem key={contact.id} value={contact.id}>
                                            {contact.name}
                                        </SelectItem>
                                    ))}
                            </SelectContent>
                        </Select>
                        <ExternalContactDialog
                            onCreated={(contact) => {
                                setContacts((items) => [...items, contact]);
                                setContactId(contact.id);
                            }}
                        />
                    </div>
                </div>
                <div>
                    <div className="flex items-center gap-2"><Label htmlFor="dueDate">Due date *</Label><FieldAssist fieldName="dueDate" /></div>
                    <Input id="dueDate" name="dueDate" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required />
                </div>
                <div>
                    <div className="flex items-center gap-2"><Label>Priority</Label><FieldAssist fieldName="priority" /></div>
                    <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
                        <SelectTrigger aria-label="Priority">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {["LOW", "MEDIUM", "HIGH", "URGENT"].map((value) => (
                                <SelectItem key={value} value={value}>
                                    {value}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                {props.mode === "edit" && (
                    <div>
                        <div className="flex items-center gap-2"><Label>Status</Label><FieldAssist fieldName="status" /></div>
                        <Select value={status} onValueChange={(value) => setStatus(value as Status)}>
                            <SelectTrigger aria-label="Status">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {["TODO", "DOING", "BLOCKED", "WAITING"].map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {value}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
                <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="reminder-day">Reminder days (before due date)</Label>
                    <input type="hidden" name="reminders" value={reminderDays.join(",")} />
                    <div className="flex min-h-[52px] flex-wrap gap-2 rounded-md border p-3">
                        {reminderDays.length === 0 && (
                            <span className="text-sm text-muted-foreground">No reminders scheduled</span>
                        )}
                        {reminderDays.map((day) => (
                            <Badge key={day} variant="secondary" className="gap-1">
                                {day === 0 ? "On due date" : `${day} day${day === 1 ? "" : "s"} before`}
                                <X
                                    className="h-3 w-3 cursor-pointer"
                                    onClick={() => removeReminderDay(day)}
                                    aria-label={`Remove ${day}-day reminder`}
                                />
                            </Badge>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Input
                            id="reminder-day"
                            type="number"
                            min={0}
                            max={365}
                            inputMode="numeric"
                            value={reminderDraft}
                            onChange={(event) => {
                                setReminderDraft(event.target.value);
                                setReminderError("");
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    addReminderDay();
                                }
                            }}
                            placeholder="Add days, e.g. 14"
                            aria-label="Add reminder day"
                            className="w-40"
                        />
                        <Button type="button" variant="outline" size="sm" onClick={addReminderDay}>
                            Add
                        </Button>
                    </div>
                    {reminderError ? (
                        <p className="text-xs text-destructive">{reminderError}</p>
                    ) : (
                        <p className="text-xs text-muted-foreground">
                            Whole days between 0 and 365. 0 sends on the due date.
                        </p>
                    )}
                </div>
                <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={overdueEnabled}
                            onChange={(event) => setOverdueEnabled(event.target.checked)}
                        />
                        Repeat overdue reminders
                    </label>
                    <Label htmlFor="overdueIntervalDays">Overdue repeat days</Label>
                    <Input
                        id="overdueIntervalDays"
                        name="overdueIntervalDays"
                        type="number"
                        min={1}
                        max={90}
                        defaultValue={props.initial?.overdueIntervalDays ?? 7}
                        disabled={!overdueEnabled}
                    />
                </div>
            </div>
            <ChipMultiSelect
                label="Collaborators"
                options={props.users.filter((user) => user.id !== ownerId)}
                values={collaboratorIds}
                onToggle={(id) => toggle(id, collaboratorIds, setCollaboratorIds)}
                emptyText="No collaborators selected"
            />
            <ChipMultiSelect
                label="Tags"
                options={props.tags}
                values={tagIds}
                onToggle={(id) => toggle(id, tagIds, setTagIds)}
                emptyText="No tags selected"
            />
            <ChipMultiSelect
                label="Dependencies"
                options={props.dependencies.filter((item) => item.id !== props.initial?.taskId)}
                values={dependencyIds}
                onToggle={(id) => toggle(id, dependencyIds, setDependencyIds)}
                emptyText="No dependencies selected"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
                disabled={
                    saving ||
                    !parent ||
                    !ownerId ||
                    !contactId ||
                    Boolean(selectedParent && !selectedParent.workArea && !classificationWorkAreaId)
                }
            >
                {saving ? "Saving..." : props.mode === "create" ? "Create external action" : "Save changes"}
            </Button>
        </form>
    );
}

function ChipMultiSelect({
    label,
    options,
    values,
    onToggle,
    emptyText,
}: {
    label: string;
    options: Option[];
    values: string[];
    onToggle: (id: string) => void;
    emptyText: string;
}) {
    const selected = values
        .map((id) => options.find((option) => option.id === id))
        .filter((option): option is Option => Boolean(option));
    const available = options.filter((option) => !values.includes(option.id));
    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            <div className="flex min-h-[52px] flex-wrap gap-2 rounded-md border p-3">
                {selected.length === 0 && <span className="text-sm text-muted-foreground">{emptyText}</span>}
                {selected.map((option) => (
                    <Badge key={option.id} variant="secondary" className="gap-1">
                        {option.name}
                        <X
                            className="h-3 w-3 cursor-pointer"
                            onClick={() => onToggle(option.id)}
                            aria-label={`Remove ${option.name}`}
                        />
                    </Badge>
                ))}
            </div>
            {available.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {available.map((option) => (
                        <Button
                            key={option.id}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onToggle(option.id)}
                        >
                            + {option.name}
                        </Button>
                    ))}
                </div>
            )}
        </div>
    );
}
