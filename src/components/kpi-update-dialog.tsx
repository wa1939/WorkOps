"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Star, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface KPIUpdateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    kpiId: string;
    kpiName: string;
    quarter: string;
    expectedUpdatedAt: string;
    target: number | null;
    unit?: string | null;
}

export function KPIUpdateDialog({
    open,
    onOpenChange,
    kpiId,
    kpiName,
    quarter,
    expectedUpdatedAt,
    target,
    unit,
}: KPIUpdateDialogProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [value, setValue] = useState("");
    const [note, setNote] = useState("");
    const [predictedScore, setPredictedScore] = useState<number | null>(null);

    const handleValueChange = (val: string) => {
        setValue(val);
        // Simple score prediction (actual calculation is server-side)
        if (val && target) {
            const numVal = parseFloat(val);
            const percent = (numVal / target) * 100;
            if (percent >= 100) setPredictedScore(5);
            else if (percent >= 80) setPredictedScore(4);
            else if (percent >= 60) setPredictedScore(3);
            else if (percent >= 40) setPredictedScore(2);
            else setPredictedScore(1);
        } else {
            setPredictedScore(null);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!value) return;

        setLoading(true);
        try {
            const res = await fetch(`/api/kpis/${kpiId}/update`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    value: parseFloat(value),
                    note: note.trim() || undefined,
                    quarter,
                    expectedUpdatedAt,
                }),
            });

            if (res.ok) {
                onOpenChange(false);
                setValue("");
                setNote("");
                setPredictedScore(null);
                router.refresh();
            } else {
                const error = await res.json();
                toast({ title: "Error", description: error.error || "Failed to update KPI", variant: "destructive" });
            }
        } catch (error) {
            console.error("Update error:", error);
            toast({ title: "Error", description: "Failed to update KPI", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Update KPI for {quarter}</DialogTitle>
                        <DialogDescription>{kpiName}</DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="value">
                                Actual Value {target && `(Target: ${target}${unit ? ` ${unit}` : ""})`}
                            </Label>
                            <Input
                                id="value"
                                type="number"
                                step="any"
                                value={value}
                                onChange={(e) => handleValueChange(e.target.value)}
                                placeholder="Enter actual value"
                                required
                                disabled={loading}
                            />
                        </div>

                        {predictedScore !== null && (
                            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                                <span className="text-sm text-muted-foreground">Predicted Score:</span>
                                <div className="flex gap-1">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                        <Star
                                            key={star}
                                            className={`h-4 w-4 ${star <= predictedScore
                                                    ? "fill-yellow-500 text-yellow-500"
                                                    : "text-muted-foreground"
                                                }`}
                                        />
                                    ))}
                                </div>
                                <Badge
                                    variant={
                                        predictedScore >= 4
                                            ? "default"
                                            : predictedScore === 3
                                                ? "secondary"
                                                : "destructive"
                                    }
                                >
                                    {predictedScore}/5
                                </Badge>
                            </div>
                        )}

                        <div className="grid gap-2">
                            <Label htmlFor="note">Notes (Optional)</Label>
                            <Textarea
                                id="note"
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder="Add context or notes about this update..."
                                rows={3}
                                disabled={loading}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading || !value}>
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Submit Update
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
