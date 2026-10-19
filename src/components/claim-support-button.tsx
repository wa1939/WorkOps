"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { UserPlus, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ClaimSupportButtonProps {
    taskId: string;
}

export function ClaimSupportButton({ taskId }: ClaimSupportButtonProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);

    const handleClaim = async () => {
        setLoading(true);
        try {
            // First, get the support request for this task
            const res = await fetch(`/api/support?taskId=${taskId}&status=Open`);
            if (!res.ok) throw new Error("Failed to fetch support request");

            const requests = await res.json();
            if (requests.length === 0) {
                toast({ title: "Error", description: "No open support request found for this task", variant: "destructive" });
                return;
            }

            // Claim the first open support request
            const claimRes = await fetch(`/api/support/${requests[0].id}/claim`, {
                method: "POST",
            });

            if (claimRes.ok) {
                toast({ title: "Success", description: "You have claimed this support request!", variant: "success" });
                router.refresh();
            } else {
                const error = await claimRes.json();
                toast({ title: "Error", description: error.error || "Failed to claim support request", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Error claiming support request", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Button
            variant="default"
            size="sm"
            onClick={handleClaim}
            disabled={loading}
            className="gap-2"
        >
            {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
                <UserPlus className="h-4 w-4" />
            )}
            Claim Support
        </Button>
    );
}
