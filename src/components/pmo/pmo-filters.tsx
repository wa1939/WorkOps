"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { PmoFilters as PmoFilterValues } from "@/lib/pmo/portfolio";

type Option = { id: string; name: string };
type Props = {
    filters: PmoFilterValues;
    owners: Option[];
    workAreas: Option[];
    projects: Option[];
    caseStudies: Option[];
    contacts: Option[];
    clearHref?: string;
};

// Radix Select forbids empty-string item values, so an "all/any" choice is
// carried by this sentinel and mapped back to "" in the hidden GET input.
const ALL = "__all__";

export function PmoFilters({ filters, owners, workAreas, projects, caseStudies, contacts, clearHref = "/pmo" }: Props) {
    return (
        <form className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            <SelectFilter
                label="Owner"
                name="ownerId"
                defaultValue={filters.ownerId ?? "all"}
                placeholder="Select owner"
            >
                <SelectItem value="me">My follow-ups</SelectItem>
                <SelectItem value="all">All owners</SelectItem>
                {owners.map((owner) => (
                    <SelectItem key={owner.id} value={owner.id}>
                        {owner.name}
                    </SelectItem>
                ))}
            </SelectFilter>
            <SelectFilter
                label="Work area"
                name="workAreaId"
                defaultValue={filters.workAreaId || ALL}
                placeholder="Select work area"
            >
                <SelectItem value={ALL}>All work areas</SelectItem>
                {workAreas.map((area) => (
                    <SelectItem key={area.id} value={area.id}>
                        {area.name}
                    </SelectItem>
                ))}
            </SelectFilter>
            <SelectFilter
                label="Parent type"
                name="parentType"
                defaultValue={filters.parentType ?? ALL}
                placeholder="Select parent type"
            >
                <SelectItem value={ALL}>All parent types</SelectItem>
                <SelectItem value="project">Projects</SelectItem>
                <SelectItem value="case-study">Case studies</SelectItem>
            </SelectFilter>
            <SelectFilter
                label="Parent"
                name="parentId"
                defaultValue={filters.parentId || ALL}
                placeholder="Select parent"
            >
                <SelectItem value={ALL}>All parents</SelectItem>
                <SelectGroup>
                    <SelectLabel>Projects</SelectLabel>
                    {projects.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                            {item.name}
                        </SelectItem>
                    ))}
                </SelectGroup>
                <SelectGroup>
                    <SelectLabel>Case studies</SelectLabel>
                    {caseStudies.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                            {item.name}
                        </SelectItem>
                    ))}
                </SelectGroup>
            </SelectFilter>
            <SelectFilter
                label="External contact"
                name="contactId"
                defaultValue={filters.contactId || ALL}
                placeholder="Select contact"
            >
                <SelectItem value={ALL}>All contacts</SelectItem>
                {contacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                        {contact.name}
                    </SelectItem>
                ))}
            </SelectFilter>
            <SelectFilter label="Status" name="status" defaultValue={filters.status ?? ALL} placeholder="Select status">
                <SelectItem value={ALL}>All statuses</SelectItem>
                {["TODO", "DOING", "BLOCKED", "WAITING", "DONE", "CANCELED"].map((value) => (
                    <SelectItem key={value} value={value}>
                        {value}
                    </SelectItem>
                ))}
            </SelectFilter>
            <SelectFilter
                label="Due bucket"
                name="dueBucket"
                defaultValue={filters.dueBucket ?? ALL}
                placeholder="Select due bucket"
            >
                <SelectItem value={ALL}>All dates</SelectItem>
                <SelectItem value="OVERDUE">Overdue</SelectItem>
                <SelectItem value="DUE_7">Due in 7 days</SelectItem>
                <SelectItem value="DUE_30">Due in 30 days</SelectItem>
            </SelectFilter>
            <SelectFilter
                label="Evidence"
                name="evidence"
                defaultValue={filters.evidence ?? ALL}
                placeholder="Select evidence"
            >
                <SelectItem value={ALL}>Any evidence</SelectItem>
                <SelectItem value="has">Has evidence</SelectItem>
                <SelectItem value="missing">Missing evidence</SelectItem>
            </SelectFilter>
            <Filter label="Due from">
                <Input name="dueStart" type="date" defaultValue={filters.dueStart ?? ""} aria-label="Due from" />
            </Filter>
            <Filter label="Due through">
                <Input name="dueEnd" type="date" defaultValue={filters.dueEnd ?? ""} aria-label="Due through" />
            </Filter>
            <div className="flex items-end gap-2">
                <Button type="submit">Apply filters</Button>
                <Button type="reset" variant="outline" asChild>
                    <a href={clearHref}>Clear</a>
                </Button>
            </div>
        </form>
    );
}

function SelectFilter({
    label,
    name,
    defaultValue,
    placeholder,
    children,
}: {
    label: string;
    name: string;
    defaultValue: string;
    placeholder?: string;
    children: React.ReactNode;
}) {
    const [value, setValue] = useState(defaultValue);
    return (
        <Filter label={label}>
            <input type="hidden" name={name} value={value === ALL ? "" : value} />
            <Select value={value} onValueChange={setValue}>
                <SelectTrigger aria-label={label}>
                    <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>{children}</SelectContent>
            </Select>
        </Filter>
    );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="grid gap-1 text-xs font-medium text-muted-foreground">
            <span>{label}</span>
            {children}
        </div>
    );
}
