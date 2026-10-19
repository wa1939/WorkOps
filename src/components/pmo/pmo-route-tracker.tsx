"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { PmoHistoryEntry } from "@/lib/pmo/navigation-history";
import { getPmoSessionStorage, recordPmoVisit } from "@/lib/pmo/navigation-storage";

export function PmoRouteTracker({
    kind,
}: {
    kind: PmoHistoryEntry["kind"];
}) {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const search = searchParams.toString();

    useEffect(() => {
        const storage = getPmoSessionStorage();
        if (!storage) return;
        recordPmoVisit(storage, {
            kind,
            url: `${pathname}${search ? `?${search}` : ""}`,
        });
    }, [kind, pathname, search]);

    return null;
}
