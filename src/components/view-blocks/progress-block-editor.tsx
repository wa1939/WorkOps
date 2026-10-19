"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Block } from "./block-editor";
import { TrendingUp, Flame, Trophy } from "lucide-react";

interface ProgressBlockEditorProps {
    block: Block;
    onUpdate: (block: Block) => void;
}

export function ProgressBlockEditor({ block, onUpdate }: ProgressBlockEditorProps) {
    return (
        <div className="space-y-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Progress Widget
            </p>

            <div className="space-y-2">
                <Label className="text-xs">Progress Formula (optional)</Label>
                <Input
                    value={block.formula || ""}
                    onChange={(e) => onUpdate({ ...block, formula: e.target.value })}
                    placeholder="e.g., completedTasks / totalTasks"
                    className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                    Leave empty for default streak calculation
                </p>
            </div>

            <div className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 rounded-lg p-4">
                <div className="flex items-center justify-around text-center">
                    <div>
                        <Flame className="h-6 w-6 mx-auto text-orange-500 mb-1" />
                        <p className="text-2xl font-bold">0</p>
                        <p className="text-xs text-muted-foreground">Day Streak</p>
                    </div>
                    <div>
                        <Trophy className="h-6 w-6 mx-auto text-yellow-500 mb-1" />
                        <p className="text-2xl font-bold">0</p>
                        <p className="text-xs text-muted-foreground">Best Streak</p>
                    </div>
                    <div>
                        <TrendingUp className="h-6 w-6 mx-auto text-green-500 mb-1" />
                        <p className="text-2xl font-bold">0%</p>
                        <p className="text-xs text-muted-foreground">Progress</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
