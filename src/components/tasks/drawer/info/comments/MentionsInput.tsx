"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn, getInitials } from "@/lib/utils";
import { parseMentions } from "@/lib/comments/mentions";
import type { CommentMember } from "./types";
import { memberLabel } from "./types";

interface MentionsInputProps {
    value: string;
    members: CommentMember[];
    disabled?: boolean;
    placeholder?: string;
    onChange: (value: string) => void;
    onSubmit: () => void | Promise<void>;
}

function mentionTrigger(value: string, cursor: number): { start: number; query: string } | null {
    const beforeCursor = value.slice(0, cursor);
    const atIndex = beforeCursor.lastIndexOf("@");
    if (atIndex < 0) return null;
    const preceding = beforeCursor[atIndex - 1];
    if (preceding && /[A-Za-z0-9_@؀-ۿ]/.test(preceding)) return null;
    const query = beforeCursor.slice(atIndex + 1);
    if (query.includes("\n") || /[,!?;:]/.test(query)) return null;
    return { start: atIndex, query };
}

const MENTION_LIST_ID = "task-drawer-mention-options";

export function MentionsInput({
    value,
    members,
    disabled = false,
    placeholder = "Add a comment… Use @ to mention someone",
    onChange,
    onSubmit,
}: MentionsInputProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
    const [highlightedIndex, setHighlightedIndex] = useState(0);

    const filteredMembers = useMemo(() => {
        const query = trigger?.query.trim().toLocaleLowerCase() ?? "";
        return members
            .filter((member) => memberLabel(member).toLocaleLowerCase().includes(query))
            .slice(0, 8);
    }, [members, trigger]);

    const pickerVisible = pickerOpen && filteredMembers.length > 0;
    const activeIndex = filteredMembers.length > 0 ? Math.min(highlightedIndex, filteredMembers.length - 1) : 0;
    const activeMember = filteredMembers[activeIndex];

    useEffect(() => {
        setHighlightedIndex(0);
    }, [trigger?.start, trigger?.query]);

    const updateTrigger = (nextValue: string, cursor: number) => {
        const nextTrigger = mentionTrigger(nextValue, cursor);
        setTrigger(nextTrigger);
        setPickerOpen(Boolean(nextTrigger));
    };

    useEffect(() => {
        const element = textareaRef.current;
        if (!element) return;
        element.style.height = "auto";
        element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
    }, [value]);

    const handleChange = (nextValue: string, cursor: number) => {
        onChange(nextValue);
        updateTrigger(nextValue, cursor);
    };

    const selectMember = (member: CommentMember) => {
        if (!trigger || !textareaRef.current) return;
        const cursor = textareaRef.current.selectionStart;
        const label = memberLabel(member);
        const nextValue = `${value.slice(0, trigger.start)}@${label} ${value.slice(cursor)}`;
        const nextCursor = trigger.start + label.length + 2;
        onChange(nextValue);
        setPickerOpen(false);
        setTrigger(null);
        window.requestAnimationFrame(() => {
            textareaRef.current?.focus();
            textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
        });
    };

    const mentionedMembers = parseMentions(value, members).mentionUserIds
        .map((id) => members.find((member) => member.id === id))
        .filter((member): member is CommentMember => Boolean(member));

    return (
        <div className="space-y-2">
            <Popover open={pickerOpen && filteredMembers.length > 0} onOpenChange={setPickerOpen}>
                <PopoverAnchor asChild>
                    <div>
                        <Textarea
                            ref={textareaRef}
                            value={value}
                            disabled={disabled}
                            rows={2}
                            placeholder={placeholder}
                            aria-label="Comment text"
                            aria-expanded={pickerVisible}
                            aria-controls={pickerVisible ? MENTION_LIST_ID : undefined}
                            aria-activedescendant={pickerVisible && activeMember ? `${MENTION_LIST_ID}-${activeMember.id}` : undefined}
                            className="max-h-[180px] min-h-[76px] resize-none overflow-y-auto"
                            onChange={(event) => handleChange(event.target.value, event.target.selectionStart)}
                            onClick={(event) => updateTrigger(event.currentTarget.value, event.currentTarget.selectionStart)}
                            onKeyUp={(event) => updateTrigger(event.currentTarget.value, event.currentTarget.selectionStart)}
                            onKeyDown={(event) => {
                                if (pickerVisible && event.key === "ArrowDown") {
                                    event.preventDefault();
                                    setHighlightedIndex((current) => (Math.min(current, filteredMembers.length - 1) + 1) % filteredMembers.length);
                                    return;
                                }
                                if (pickerVisible && event.key === "ArrowUp") {
                                    event.preventDefault();
                                    setHighlightedIndex((current) => (Math.min(current, filteredMembers.length - 1) - 1 + filteredMembers.length) % filteredMembers.length);
                                    return;
                                }
                                if (pickerOpen && event.key === "Escape") {
                                    event.preventDefault();
                                    setPickerOpen(false);
                                    setTrigger(null);
                                    return;
                                }
                                if (pickerVisible && event.key === "Enter" && !event.shiftKey && activeMember) {
                                    event.preventDefault();
                                    selectMember(activeMember);
                                    return;
                                }
                                if (event.key !== "Enter" || event.shiftKey) return;
                                event.preventDefault();
                                void onSubmit();
                            }}
                        />
                    </div>
                </PopoverAnchor>
                <PopoverContent
                    side="top"
                    align="start"
                    className="w-64 p-1"
                    onOpenAutoFocus={(event) => event.preventDefault()}
                >
                    <div id={MENTION_LIST_ID} className="max-h-56 overflow-y-auto" role="listbox" aria-label="Mention a member">
                        {filteredMembers.map((member, index) => (
                            <button
                                key={member.id}
                                id={`${MENTION_LIST_ID}-${member.id}`}
                                type="button"
                                role="option"
                                aria-selected={index === activeIndex}
                                className={cn("flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-accent", index === activeIndex && "bg-accent")}
                                onMouseDown={(event) => event.preventDefault()}
                                onMouseEnter={() => setHighlightedIndex(index)}
                                onClick={() => selectMember(member)}
                            >
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                                    {getInitials(memberLabel(member))}
                                </span>
                                <span className="min-w-0 truncate">{memberLabel(member)}</span>
                            </button>
                        ))}
                    </div>
                </PopoverContent>
            </Popover>
            <div className="flex items-center justify-between gap-2">
                <div className="flex min-h-6 flex-wrap gap-1" aria-label="Mention chips">
                    {mentionedMembers.map((member) => (
                        <span key={member.id} className={cn("rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary")}>
                            @{memberLabel(member)}
                        </span>
                    ))}
                </div>
                <Button type="button" size="sm" disabled={disabled || !value.trim()} onClick={() => void onSubmit()}>
                    <Send className="mr-1.5 h-3.5 w-3.5" />
                    Send
                </Button>
            </div>
        </div>
    );
}
