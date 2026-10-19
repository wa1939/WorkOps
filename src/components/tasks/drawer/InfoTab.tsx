"use client";

import { useEffect, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { TaskDrawerPayload, TaskDrawerPatch } from "./types";
import { AttachmentsSection } from "./info/AttachmentsSection";
import { CommentsSection } from "./info/CommentsSection";
import { CustomFieldsSection } from "./info/CustomFieldsSection";
import { DependenciesSection } from "./info/DependenciesSection";
import { DescriptionSection } from "./info/DescriptionSection";
import { DetailsSection } from "./info/DetailsSection";
import { RecurringSection } from "./info/RecurringSection";
import { SubtasksSection } from "./info/SubtasksSection";

export interface InfoTabProps {
    task: TaskDrawerPayload;
    commentId: string | null;
    onUpdate: (patch: TaskDrawerPatch) => Promise<TaskDrawerPayload>;
    onRefresh: () => Promise<void>;
}

export function InfoTab({ task, commentId, onUpdate, onRefresh }: InfoTabProps) {
    const [openSections, setOpenSections] = useState<string[]>([
        "details",
        "description",
        "subtasks",
        "dependencies",
        "attachments",
        "custom-fields",
    ]);

    useEffect(() => {
        if (!commentId) return;
        const anchor = document.getElementById("comments");
        anchor?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, [commentId, task.id]);

    return (
        <div className="space-y-3">
            <Accordion type="multiple" value={openSections} onValueChange={setOpenSections} className="w-full">
                <AccordionItem value="details">
                    <AccordionTrigger className="h-9 min-h-9 rounded-md px-3 py-2 text-sm transition-colors duration-200 hover:bg-muted/50">Details</AccordionTrigger>
                    <AccordionContent><DetailsSection task={task} onUpdate={onUpdate} onRefresh={onRefresh} /></AccordionContent>
                </AccordionItem>
                <AccordionItem value="description">
                    <AccordionTrigger className="h-9 min-h-9 rounded-md px-3 py-2 text-sm transition-colors duration-200 hover:bg-muted/50">Description</AccordionTrigger>
                    <AccordionContent><DescriptionSection task={task} onUpdate={onUpdate} /></AccordionContent>
                </AccordionItem>
                <AccordionItem value="subtasks">
                    <AccordionTrigger className="h-9 min-h-9 rounded-md px-3 py-2 text-sm transition-colors duration-200 hover:bg-muted/50">Subtasks <span className="ml-2 text-xs font-normal text-muted-foreground">{task.subtasks.length}</span></AccordionTrigger>
                    <AccordionContent><SubtasksSection task={task} onRefresh={onRefresh} /></AccordionContent>
                </AccordionItem>
                <AccordionItem value="dependencies">
                    <AccordionTrigger className="h-9 min-h-9 rounded-md px-3 py-2 text-sm transition-colors duration-200 hover:bg-muted/50">Dependencies</AccordionTrigger>
                    <AccordionContent><DependenciesSection task={task} onRefresh={onRefresh} /></AccordionContent>
                </AccordionItem>
                <AccordionItem value="attachments">
                    <AccordionTrigger className="h-9 min-h-9 rounded-md px-3 py-2 text-sm transition-colors duration-200 hover:bg-muted/50">Attachments <span className="ml-2 text-xs font-normal text-muted-foreground">{task.attachments.length}</span></AccordionTrigger>
                    <AccordionContent><AttachmentsSection task={task} /></AccordionContent>
                </AccordionItem>
                <AccordionItem value="custom-fields">
                    <AccordionTrigger className="h-9 min-h-9 rounded-md px-3 py-2 text-sm transition-colors duration-200 hover:bg-muted/50">Custom fields</AccordionTrigger>
                    <AccordionContent><CustomFieldsSection task={task} onRefresh={onRefresh} /></AccordionContent>
                </AccordionItem>
                <AccordionItem value="recurring">
                    <AccordionTrigger className="h-9 min-h-9 rounded-md px-3 py-2 text-sm transition-colors duration-200 hover:bg-muted/50">Recurring</AccordionTrigger>
                    <AccordionContent><RecurringSection task={task} onRefresh={onRefresh} /></AccordionContent>
                </AccordionItem>
            </Accordion>
            <CommentsSection task={task} commentId={commentId} />
        </div>
    );
}
