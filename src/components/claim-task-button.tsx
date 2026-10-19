"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Hand, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ClaimTaskButtonProps {
    taskId: string;
    taskTitle: string;
}

export function ClaimTaskButton({ taskId, taskTitle }: ClaimTaskButtonProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);

    const handleClaim = async (e: React.MouseEvent) => {
        e.preventDefault(); // Prevent Link navigation
        e.stopPropagation();

        setLoading(true);
        try {
            const res = await fetch(`/api/tasks/${taskId}/claim`, {
                method: "POST",
            });

            if (res.ok) {
                toast({ title: "Task Claimed", description: `You claimed "${taskTitle}"`, variant: "success" });
                router.refresh();
            } else {
                const error = await res.json();
                toast({ title: "Error", description: error.error || "Failed to claim task", variant: "destructive" });
            }
        } catch (error) {
            console.error("Claim error:", error);
            toast({ title: "Error", description: "Failed to claim task", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Button
            size="sm"
            variant="secondary"
            onClick={handleClaim}
            disabled={loading}
            className="sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
        >
            {loading ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
                <Hand className="mr-1 h-3 w-3" />
            )}
            Claim
        </Button>
    );
}
