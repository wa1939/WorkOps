"use client";

import React from "react";

import { useState } from "react";
import { AssistantMarkdown } from "@/components/sabah/chat/assistant-markdown";
import { collectVerifiedInternalHrefs } from "@/lib/ai/verified-links";
import { Bot, User as UserIcon, Copy, Check } from "lucide-react";
import { ToolCard } from "./tool-card";
import type { ChatToolCall } from "@/app/api/ai/chat/route";

export type ChatMessage = {
    id: string;
    role: "user" | "assistant";
    content: string;
    toolCalls?: ChatToolCall[];
};

export function ChatMessageBubble({ message, verifiedHrefs }: { message: ChatMessage; verifiedHrefs?: ReadonlySet<string> }) {
    const verified = React.useMemo(() => verifiedHrefs ?? new Set(collectVerifiedInternalHrefs(message.toolCalls)), [verifiedHrefs, message.toolCalls]);
    const isUser = message.role === "user";
    const [copied, setCopied] = useState(false);

    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(message.content);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // clipboard may be blocked in some contexts
        }
    };

    return (
        <div className={`group flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
            <div
                className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${
                    isUser
                        ? "bg-violet-500/20 text-violet-300"
                        : "bg-gradient-to-br from-violet-500/30 to-fuchsia-500/30 text-fuchsia-300"
                }`}
            >
                {isUser ? <UserIcon className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
            </div>
            <div className={`min-w-0 flex-1 space-y-2 ${isUser ? "items-end" : "items-start"}`}>
                {message.content && (
                    <div className="relative inline-block max-w-full">
                        <div
                            className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                                isUser
                                    ? "bg-violet-500/15 text-foreground ml-auto"
                                    : "bg-muted text-foreground"
                            }`}
                        >
                            {isUser ? (
                                <p className="whitespace-pre-wrap break-words">{message.content}</p>
                            ) : (
                                <div className="prose prose-sm prose-invert max-w-none [&>*]:my-1 [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1">
                                    <AssistantMarkdown content={message.content} verifiedHrefs={verified} />
                                </div>
                            )}
                        </div>
                        {!isUser && message.id !== "intro" && message.content.trim().length > 0 && (
                            <button
                                type="button"
                                onClick={handleCopy}
                                aria-label="Copy message"
                                title="Copy"
                                className="absolute -right-1 -bottom-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md bg-background border border-border shadow-sm hover:bg-accent"
                            >
                                {copied ? (
                                    <Check className="h-3 w-3 text-emerald-400" />
                                ) : (
                                    <Copy className="h-3 w-3 text-muted-foreground" />
                                )}
                            </button>
                        )}
                    </div>
                )}
                {message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="space-y-1.5">
                        {message.toolCalls.map((tc, idx) => (
                            <ToolCard key={`${message.id}-tc-${idx}`} call={tc} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
