"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Hand, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function ClaimButton({ taskId }: { taskId: string }) {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);

    const handleClaim = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/tasks/${taskId}/claim`, {
                method: "POST",
            });

            if (res.ok) {
                router.refresh();
            } else {
                const data = await res.json();
                toast({ title: "Error", description: data.error || "Failed to claim task", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Error claiming task", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Button size="sm" className="gap-2" onClick={handleClaim} disabled={loading}>
            {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
                <Hand className="h-4 w-4" />
            )}
            Claim Task
        </Button>
    );
}
