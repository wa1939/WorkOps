"use client";

import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import { SabahAvatar } from "../sabah-avatar";
import { AssistantMarkdown } from "./assistant-markdown";

export type SabahThreadMessage = {
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt?: string;
    streamingStatus?: "STREAMING" | "FINISHED" | "FAILED" | "STOPPED";
};

function formatTime(createdAt: string): string | null {
    const parsed = Date.parse(createdAt);
    if (Number.isNaN(parsed)) {
        return null;
    }
    try {
        return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(parsed));
    } catch {
        return null;
    }
}

/**
 * Sabah-identity chat bubble. Assistant messages carry the Sabah avatar
 * (never a generic bot icon); user messages align to the inline end.
 * Uses only theme tokens + logical properties so RTL and dark mode hold.
 */
export function SabahMessageBubble({ message, verifiedHrefs }: { message: SabahThreadMessage; verifiedHrefs?: ReadonlySet<string> }) {
    const isUser = message.role === "user";
    const isStreaming = !isUser && message.streamingStatus === "STREAMING";
    const isFailed = !isUser && message.streamingStatus === "FAILED";
    const isStopped = !isUser && message.streamingStatus === "STOPPED";
    const [copied, setCopied] = useState(false);
    const time = message.createdAt ? formatTime(message.createdAt) : null;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(message.content);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard can be blocked; the copy affordance is best-effort.
        }
    };

    return (
        <div
            data-testid={`sabah-bubble-${message.id}`}
            data-role={message.role}
            data-streaming-status={message.streamingStatus}
            aria-busy={isStreaming ? "true" : undefined}
            className={`group flex items-end gap-2 ${isUser ? "flex-row-reverse" : ""}`}
        >
            {!isUser && <SabahAvatar size="sm" className="mb-0.5" />}
            <div className={`flex min-w-0 max-w-[85%] flex-col gap-0.5 ${isUser ? "items-end" : "items-start"}`}>
                <div className="relative min-w-0 max-w-full">
                    <div
                        className={
                            isUser
                                ? "rounded-2xl rounded-ee-md bg-primary px-3 py-2 text-sm leading-relaxed text-primary-foreground shadow-sm"
                                : "rounded-2xl rounded-es-md border border-border bg-muted px-3 py-2 text-sm leading-relaxed text-foreground"
                        }
                    >
                        {isUser ? (
                            <p className="whitespace-pre-wrap break-words">{message.content}</p>
                        ) : (
                            <AssistantMarkdown content={message.content} verifiedHrefs={verifiedHrefs} />
                        )}
                    </div>
                    {isFailed && (
                        <p role="status" aria-label="Response interrupted" data-testid="sabah-response-interrupted" className="mt-1 text-xs font-medium text-destructive">
                            Response interrupted
                        </p>
                    )}
                    {isStopped && (
                        <p role="status" aria-label="Response stopped" data-testid="sabah-response-stopped" className="mt-1 text-xs font-medium text-muted-foreground">
                            Response stopped
                        </p>
                    )}
                    {!isUser && message.content.trim().length > 0 && (
                        <button
                            type="button"
                            onClick={handleCopy}
                            aria-label="Copy message"
                            title="Copy"
                            className="absolute -bottom-1 -end-1 rounded-md border border-border bg-background p-1 opacity-0 shadow-sm hover:bg-accent focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary group-hover:opacity-100 motion-safe:transition-opacity motion-safe:duration-150"
                        >
                            {copied ? (
                                <Check aria-hidden="true" className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                                <Copy aria-hidden="true" className="h-3 w-3 text-muted-foreground" />
                            )}
                        </button>
                    )}
                </div>
                {time && message.createdAt && (
                    <time dateTime={message.createdAt} className="px-1 text-[10px] tabular-nums text-muted-foreground">
                        {time}
                    </time>
                )}
            </div>
        </div>
    );
}
