"use client";

import React from "react";
import { SendHorizontal, Loader2, Paperclip } from "lucide-react";

export function Composer({
    value,
    onChange,
    onSubmit,
    onStop,
    onUpload,
    pending = false,
    uploading = false,
}: {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onStop?: () => void;
    onUpload?: (file: File) => void | Promise<void>;
    pending?: boolean;
    uploading?: boolean;
}) {
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    // Touch keyboards: Enter must insert a newline (Enter-to-send fights the
    // IME and autocorrect); sending stays on the explicit button.
    const [coarsePointer, setCoarsePointer] = React.useState(false);
    React.useEffect(() => {
        try {
            setCoarsePointer(window.matchMedia("(pointer: coarse)").matches);
        } catch {
            // matchMedia unavailable — keep desktop behavior.
        }
    }, []);
    const canSend = !pending && !uploading && value.trim().length > 0;
    const showStop = pending;
    const enterSends = !coarsePointer;
    return (
        <div className="border-t border-border p-3" aria-busy={pending || uploading}>
            <div className="flex items-end gap-2">
                {onUpload && (
                    <>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".xlsx,.xls,.csv,.txt,.md,.docx"
                            className="hidden"
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                if (file) void onUpload(file);
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={pending || uploading}
                            aria-label="Upload a file"
                            title="Upload Excel / CSV / MoM"
                            className="mb-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {uploading ? <Loader2 aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" /> : <Paperclip aria-hidden="true" className="h-4 w-4" />}
                        </button>
                    </>
                )}
                <div className="flex-1">
                    <label htmlFor="sabah-composer" className="sr-only">
                        Message Sabah
                    </label>
                    <textarea
                        id="sabah-composer"
                        name="sabah-composer"
                        rows={2}
                        maxLength={4000}
                        value={value}
                        disabled={pending || uploading}
                        aria-describedby="sabah-composer-hint"
                        onChange={(event) => onChange(event.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey && enterSends) {
                                e.preventDefault();
                                if (canSend) {
                                    onSubmit();
                                }
                            }
                        }}
                        enterKeyHint={enterSends ? "send" : "enter"}
                        placeholder={pending ? "Sabah is working…" : uploading ? "Uploading file…" : "Message Sabah…"}
                        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-base sm:text-sm placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors motion-safe:duration-150"
                    />
                </div>
                <button
                    type="button"
                    onClick={() => {
                        if (showStop) onStop?.();
                        else onSubmit();
                    }}
                    disabled={showStop ? !onStop : !canSend}
                    aria-label={showStop ? "Stop" : "Send"}
                    className="mb-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 motion-safe:transition-colors motion-safe:duration-150"
                >
                    {showStop ? (
                        <span aria-hidden="true" className="block size-2.5 rounded-[0.1875rem] bg-current" />
                    ) : (
                        <SendHorizontal aria-hidden="true" className="h-4 w-4 rtl:-scale-x-100" />
                    )}
                </button>
            </div>
            <p id="sabah-composer-hint" className="mt-1 flex items-center gap-1.5 px-0.5 text-[10px] text-muted-foreground">
                {pending ? (
                    <>
                        <Loader2 aria-hidden="true" className="h-3 w-3 motion-safe:animate-spin" />
                        Sabah is working on your request…
                    </>
                ) : enterSends ? (
                    <>Enter to send · Shift+Enter for a new line</>
                ) : null}
            </p>
        </div>
    );
}
