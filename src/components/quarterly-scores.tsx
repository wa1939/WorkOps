"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Star, Plus } from "lucide-react";
import { KPIUpdateDialog } from "@/components/kpi-update-dialog";

interface QuarterlyScoresProps {
    kpiId: string;
    kpiName: string;
    expectedUpdatedAt: string;
    unit?: string | null;
    trackingPeriod: string;
    q1Target: number | null;
    q2Target: number | null;
    q3Target: number | null;
    q4Target: number | null;
    updates: Array<{
        id: string;
        quarter: string | null;
        value: number | null;
        score: number | null;
        achievementPercent: number | null;
    }>;
}

export function QuarterlyScores({
    kpiId,
    kpiName,
    expectedUpdatedAt,
    unit,
    trackingPeriod,
    q1Target,
    q2Target,
    q3Target,
    q4Target,
    updates,
}: QuarterlyScoresProps) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [selectedQuarter, setSelectedQuarter] = useState<string | null>(null);
    const [selectedTarget, setSelectedTarget] = useState<number | null>(null);

    const quarters = [
        { name: "Q1", target: q1Target },
        { name: "Q2", target: q2Target },
        { name: "Q3", target: q3Target },
        { name: "Q4", target: q4Target },
    ];

    const getQuarterUpdate = (quarter: string) => {
        return updates.find((u) => u.quarter === quarter);
    };

    const handleUpdateClick = (quarter: string, target: number | null) => {
        setSelectedQuarter(quarter);
        setSelectedTarget(target);
        setDialogOpen(true);
    };

    // Render stars for score
    const renderStars = (score: number | null) => {
        if (!score) return <span className="text-muted-foreground text-sm">Not updated</span>;

        return (
            <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                        key={star}
                        className={`h-4 w-4 ${star <= score ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground/30"
                            }`}
                    />
                ))}
            </div>
        );
    };

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>Quarterly Performance</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4 sm:grid-cols-2">
                        {quarters.map(({ name, target }) => {
                            const update = getQuarterUpdate(name);
                            const canUpdate =
                                trackingPeriod === name || trackingPeriod === "ANNUAL";

                            return (
                                <div
                                    key={name}
                                    className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <h3 className="font-semibold text-lg">{name}</h3>
                                        {canUpdate && target && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => handleUpdateClick(name, target)}
                                            >
                                                <Plus className="mr-1 h-3 w-3" />
                                                Update
                                            </Button>
                                        )}
                                    </div>

                                    {target ? (
                                        <div className="space-y-2">
                                            <div className="flex justify-between text sm">
                                                <span className="text-muted-foreground">Target:</span>
                                                <span className="font-medium">
                                                    {target} {unit}
                                                </span>
                                            </div>

                                            {update && (
                                                <>
                                                    <div className="flex justify-between text-sm">
                                                        <span className="text-muted-foreground">Actual:</span>
                                                        <span className="font-medium">
                                                            {update.value} {unit}
                                                        </span>
                                                    </div>

                                                    <div className="flex justify-between text-sm">
                                                        <span className="text-muted-foreground">Achievement:</span>
                                                        <Badge
                                                            variant={
                                                                (update.achievementPercent || 0) >= 100
                                                                    ? "default"
                                                                    : (update.achievementPercent || 0) >= 60
                                                                        ? "secondary"
                                                                        : "destructive"
                                                            }
                                                        >
                                                            {Math.round(update.achievementPercent || 0)}%
                                                        </Badge>
                                                    </div>

                                                    <div className="pt-2 border-t">
                                                        {renderStars(update.score)}
                                                        {update.score && (
                                                            <p className="text-xs text-muted-foreground mt-1">
                                                                Score: {update.score}/5
                                                            </p>
                                                        )}
                                                    </div>
                                                </>
                                            )}

                                            {!update && (
                                                <p className="text-sm text-muted-foreground text-center py-4">
                                                    No update yet
                                                </p>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground text-center py-4">
                                            No target set
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            {selectedQuarter && (
                <KPIUpdateDialog
                    open={dialogOpen}
                    onOpenChange={setDialogOpen}
                    kpiId={kpiId}
                    kpiName={kpiName}
                    expectedUpdatedAt={expectedUpdatedAt}
                    quarter={selectedQuarter}
                    target={selectedTarget}
                    unit={unit}
                />
            )}
        </>
    );
}
