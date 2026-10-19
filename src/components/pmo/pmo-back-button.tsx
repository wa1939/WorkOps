"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getPmoSessionStorage, takePmoBackDestination } from "@/lib/pmo/navigation-storage";

export function PmoBackButton() {
    const router = useRouter();

    function goBack() {
        const current = `${window.location.pathname}${window.location.search}`;
        const storage = getPmoSessionStorage();
        router.push(storage ? takePmoBackDestination(storage, current) : "/pmo");
    }

    return (
        <Button
            type="button"
            variant="ghost"
            className="min-h-11 gap-2 px-3"
            aria-label="Back"
            onClick={goBack}
        >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Back</span>
        </Button>
    );
}
