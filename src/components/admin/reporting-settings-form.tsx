"use client";

import { useMemo, useState } from "react";
import { parseAndValidateRecipients } from "@/lib/communications/digest";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Sparkles } from "lucide-react";

export function ReportingSettingsForm({ initialRecipients, internalDomains = [] }: { initialRecipients: string; internalDomains?: readonly string[] }) {
    const { toast } = useToast();
    const [recipients, setRecipients] = useState(initialRecipients);
    const [saving, setSaving] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const validation = useMemo(
        () => parseAndValidateRecipients(recipients, { allowExternal: false, internalDomains }),
        [recipients, internalDomains],
    );

    const save = async () => {
        setSaving(true);
        try {
            const res = await fetch("/api/admin/config", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: "SUNDAY_DIGEST_TO", value: recipients.trim() }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Failed (${res.status})`);
            }
            toast({ title: "Saved", description: "Sunday digest recipients updated." });
        } catch (e) {
            toast({ variant: "destructive", title: "Save failed", description: (e as Error).message });
        } finally {
            setSaving(false);
        }
    };

    const preview = async () => {
        setPreviewing(true);
        try {
            const res = await fetch("/api/cron/sunday-digest?deliver=false", { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
            toast({
                title: "Preview generated",
                description: `No report saved or email sent (${data.report?.bullets?.length ?? 0} count lines).`,
            });
        } catch (e) {
            toast({ variant: "destructive", title: "Preview failed", description: (e as Error).message });
        } finally {
            setPreviewing(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Sunday executive digest</CardTitle>
                <CardDescription>
                    7-bullet department update sent every Sunday 07:00 Asia/Riyadh. Enter one or more email addresses (comma-separated).
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="recipients">Recipients</Label>
                    <Input
                        id="recipients"
                        placeholder="e.g. alex@example.com, sam@example.com"
                        value={recipients}
                        onChange={(e) => setRecipients(e.target.value)}
                        dir="ltr"
                    />
                    <p className="text-xs text-muted-foreground">
                        Leave blank to skip email delivery — the report still generates and appears under /reports.
                    </p>
                    <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-xs" aria-live="polite">
                        <p><span className="font-medium">Valid:</span> {validation.valid.join(", ") || "None"}</p>
                        <p><span className="font-medium">Invalid:</span> {validation.invalid.join(", ") || "None"}</p>
                        <p><span className="font-medium">Duplicates removed:</span> {validation.duplicatesRemoved.join(", ") || "None"}</p>
                        <p><span className="font-medium">External blocked:</span> {validation.externalBlocked.join(", ") || "None"}</p>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                    <Button onClick={save} disabled={saving}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save
                    </Button>
                    <Button
                        variant="outline"
                        onClick={preview}
                        disabled={previewing}
                        title="Generate a digest report without sending an email"
                    >
                        {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                        Preview (no email)
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
