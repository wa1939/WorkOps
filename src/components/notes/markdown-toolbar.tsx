"use client";

import { Button } from "@/components/ui/button";
import { Bold, Italic, Heading2, List, Code, Link2, Quote } from "lucide-react";

interface MarkdownToolbarProps {
    textareaRef: React.RefObject<HTMLTextAreaElement>;
    onUpdate: (value: string) => void;
}

function wrapSelection(
    textarea: HTMLTextAreaElement,
    prefix: string,
    suffix: string,
    onUpdate: (value: string) => void
) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.slice(start, end) || "text";

    const newText = text.slice(0, start) + prefix + selected + suffix + text.slice(end);
    onUpdate(newText);

    requestAnimationFrame(() => {
        textarea.focus();
        textarea.selectionStart = start + prefix.length;
        textarea.selectionEnd = start + prefix.length + selected.length;
    });
}

function insertLine(
    textarea: HTMLTextAreaElement,
    prefix: string,
    onUpdate: (value: string) => void
) {
    const start = textarea.selectionStart;
    const text = textarea.value;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;

    const newText = text.slice(0, lineStart) + prefix + text.slice(lineStart);
    onUpdate(newText);

    requestAnimationFrame(() => {
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = start + prefix.length;
    });
}

const tools = [
    { icon: Bold, label: "Bold", action: (ta: HTMLTextAreaElement, u: (v: string) => void) => wrapSelection(ta, "**", "**", u) },
    { icon: Italic, label: "Italic", action: (ta: HTMLTextAreaElement, u: (v: string) => void) => wrapSelection(ta, "_", "_", u) },
    { icon: Heading2, label: "Heading", action: (ta: HTMLTextAreaElement, u: (v: string) => void) => insertLine(ta, "## ", u) },
    { icon: List, label: "List", action: (ta: HTMLTextAreaElement, u: (v: string) => void) => insertLine(ta, "- ", u) },
    { icon: Code, label: "Code", action: (ta: HTMLTextAreaElement, u: (v: string) => void) => wrapSelection(ta, "`", "`", u) },
    { icon: Link2, label: "Link", action: (ta: HTMLTextAreaElement, u: (v: string) => void) => wrapSelection(ta, "[", "](url)", u) },
    { icon: Quote, label: "Quote", action: (ta: HTMLTextAreaElement, u: (v: string) => void) => insertLine(ta, "> ", u) },
];

export function MarkdownToolbar({ textareaRef, onUpdate }: MarkdownToolbarProps) {
    return (
        <div className="flex items-center gap-0.5 p-1 border rounded-md bg-muted/50">
            {tools.map((tool) => (
                <Button
                    key={tool.label}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title={tool.label}
                    onClick={() => {
                        if (textareaRef.current) {
                            tool.action(textareaRef.current, onUpdate);
                        }
                    }}
                >
                    <tool.icon className="h-3.5 w-3.5" />
                </Button>
            ))}
        </div>
    );
}
