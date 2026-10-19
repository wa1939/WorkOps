"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Copy, Check, AlertTriangle } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function ProjectBriefButton({ projectId, projectName }: { projectId: string; projectName: string }) {
    const [showWarning, setShowWarning] = useState(false);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [brief, setBrief] = useState("");
    const [error, setError] = useState("");
    const [copied, setCopied] = useState(false);

    const generate = async () => {
        setShowWarning(false);
        setOpen(true);
        setLoading(true);
        setError("");
        setBrief("");
        try {
            const res = await fetch(`/api/projects/${projectId}/brief`, { method: "POST" });
            const data = await res.json();
            if (res.ok && data.brief) {
                setBrief(data.brief);
            } else {
                setError(typeof data.error === "string" ? data.error : "Failed to generate the brief");
            }
        } catch (e) {
            console.error(e);
            setError("Connection error while generating the brief");
        } finally {
            setLoading(false);
        }
    };

    const copy = () => {
        navigator.clipboard.writeText(brief);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <>
            <Button
                variant="outline"
                onClick={() => setShowWarning(true)}
                className="border-purple-500 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/30"
            >
                <Sparkles className="mr-2 h-4 w-4" />
                AI project brief
            </Button>

            {/* Cost warning */}
            <Dialog open={showWarning} onOpenChange={setShowWarning}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-yellow-600">
                            <AlertTriangle className="h-5 w-5" />
                            Uses AI (consumes credits)
                        </DialogTitle>
                        <DialogDescription>
                            This turns this week&apos;s activity on <span dir="auto">{projectName}</span> into an executive-style
                            brief using the GLM model. Each run consumes API credits.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowWarning(false)}>
                            Cancel
                        </Button>
                        <Button onClick={generate} className="bg-purple-600 hover:bg-purple-700">
                            <Sparkles className="mr-2 h-4 w-4" />
                            Generate brief
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Result */}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-purple-600" />
                            Project brief
                        </DialogTitle>
                        <DialogDescription dir="auto">{projectName}</DialogDescription>
                    </DialogHeader>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {loading ? (
                        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            Writing the brief...
                        </div>
                    ) : brief ? (
                        <div className="space-y-2">
                            <Textarea
                                value={brief}
                                onChange={(e) => setBrief(e.target.value)}
                                dir="auto"
                                className="min-h-[260px] text-sm leading-relaxed"
                            />
                            <div className="flex justify-end">
                                <Button size="sm" variant="outline" onClick={copy}>
                                    {copied ? (
                                        <>
                                            <Check className="mr-1 h-3 w-3" />
                                            Copied
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="mr-1 h-3 w-3" />
                                            Copy
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    ) : null}

                    <DialogFooter>
                        <Button variant="secondary" onClick={() => setOpen(false)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
