"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type LifecycleAction = "close" | "cancel" | "reopen";

// Copy + affordance per lifecycle transition. Kept in one place so the trigger,
// dialog title, field, and confirm button never drift out of sync.
const COPY = {
    close: {
        trigger: "Close action",
        title: "Close this action?",
        description:
            "Summarize how it was resolved. A closure needs either attached evidence or a note — otherwise the server will ask for one.",
        fieldLabel: "Closure note",
        placeholder: "How was this resolved?",
        confirm: "Close action",
        pending: "Closing…",
        destructive: false,
        requireText: false,
    },
    cancel: {
        trigger: "Cancel action",
        title: "Cancel this action?",
        description: "Tell the team why this action is being canceled. The reason is recorded on the action.",
        fieldLabel: "Cancellation reason",
        placeholder: "Why is this being canceled?",
        confirm: "Cancel action",
        pending: "Canceling…",
        destructive: true,
        requireText: true,
    },
} as const;

async function postLifecycle(taskId: string, payload: Record<string, unknown>): Promise<string | null> {
    try {
        const result = await fetch(`/api/pmo/actions/${taskId}/lifecycle`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!result.ok) {
            const body = await result.json().catch(() => ({}));
            return body.error ?? "Something went wrong. Please try again.";
        }
        return null;
    } catch {
        return "Network error — check your connection and try again.";
    }
}

/**
 * Replaces the native browser prompt/confirm lifecycle flow with Radix dialogs.
 * `close`/`cancel` capture a note via a text field; `reopen` is a plain confirm.
 * The lifecycle POST payload shape is unchanged.
 */
export function LifecycleDialog({
    taskId,
    action,
    onDone,
}: {
    taskId: string;
    action: LifecycleAction;
    onDone: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [note, setNote] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    function reset(next: boolean) {
        setOpen(next);
        if (!next) {
            setError("");
            setLoading(false);
        }
    }

    async function submit(payload: Record<string, unknown>) {
        setLoading(true);
        setError("");
        const message = await postLifecycle(taskId, payload);
        if (message) {
            setError(message);
            setLoading(false);
            return;
        }
        setOpen(false);
        setLoading(false);
        setNote("");
        onDone();
    }

    if (action === "reopen") {
        return (
            <AlertDialog open={open} onOpenChange={reset}>
                <AlertDialogTrigger asChild>
                    <Button>Reopen action</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Reopen this action?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Reopening moves the action back to an active state so you can record responses, add
                            evidence, or make changes.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {error && (
                        <p className="text-sm text-destructive" role="alert">
                            {error}
                        </p>
                    )}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={loading}>Keep closed</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={loading}
                            onClick={(event) => {
                                event.preventDefault();
                                submit({ action });
                            }}
                        >
                            {loading ? "Reopening…" : "Reopen action"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        );
    }

    const copy = COPY[action];
    const disabled = loading || (copy.requireText && !note.trim());

    return (
        <Dialog open={open} onOpenChange={reset}>
            <DialogTrigger asChild>
                <Button variant={copy.destructive ? "destructive" : "default"}>{copy.trigger}</Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{copy.title}</DialogTitle>
                    <DialogDescription>{copy.description}</DialogDescription>
                </DialogHeader>
                <Textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    dir="auto"
                    aria-label={copy.fieldLabel}
                    placeholder={copy.placeholder}
                    required={copy.requireText}
                    disabled={loading}
                />
                {error && (
                    <p className="text-sm text-destructive" role="alert">
                        {error}
                    </p>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={() => reset(false)} disabled={loading}>
                        Keep open
                    </Button>
                    <Button
                        variant={copy.destructive ? "destructive" : "default"}
                        onClick={() =>
                            submit(action === "close" ? { action, closureNote: note } : { action, reason: note })
                        }
                        disabled={disabled}
                    >
                        {loading ? copy.pending : copy.confirm}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
