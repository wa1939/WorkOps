"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { HandHelping } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface OfferHelpButtonProps {
    taskId: string;
    taskTitle: string;
}

export function OfferHelpButton({ taskId, taskTitle }: OfferHelpButtonProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);

    const handleOfferHelp = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setLoading(true);

        try {
            const res = await fetch(`/api/tasks/${taskId}/offer-help`, {
                method: "POST",
            });

            if (res.ok) {
                router.refresh();
            } else {
                const data = await res.json();
                toast({ title: "Error", description: data.error || "Failed to offer help", variant: "destructive" });
            }
        } catch (error) {
            console.error("Offer help error:", error);
            toast({ title: "Error", description: "Error offering help", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Button
            size="sm"
            variant="secondary"
            onClick={handleOfferHelp}
            disabled={loading}
            className="sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
        >
            <HandHelping className="mr-1 h-3 w-3" />
            {loading ? "..." : "Offer Help"}
        </Button>
    );
}
