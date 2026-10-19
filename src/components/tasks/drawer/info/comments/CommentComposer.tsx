"use client";

import { useState } from "react";
import { parseMentions } from "@/lib/comments/mentions";
import { MentionsInput } from "./MentionsInput";
import type { CommentMember } from "./types";

interface CommentComposerProps {
    members: CommentMember[];
    disabled?: boolean;
    onSubmit: (text: string, mentionUserIds: string[]) => Promise<void>;
}

export function CommentComposer({ members, disabled = false, onSubmit }: CommentComposerProps) {
    const [text, setText] = useState("");
    const [pending, setPending] = useState(false);

    const submit = async () => {
        const parsed = parseMentions(text, members);
        if (!parsed.cleanedText || pending) return;
        setPending(true);
        try {
            await onSubmit(parsed.cleanedText, parsed.mentionUserIds);
            setText("");
        } finally {
            setPending(false);
        }
    };

    return (
        <MentionsInput
            value={text}
            members={members}
            disabled={disabled || pending}
            onChange={setText}
            onSubmit={submit}
        />
    );
}
