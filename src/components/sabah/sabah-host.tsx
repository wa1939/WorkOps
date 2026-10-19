"use client";

import React, { useEffect, useRef } from "react";
import { useSabah } from "./state/sabah-context";

export function SabahWorkspaceHost({ hostId, className = "" }: { hostId: string; className?: string }) {
    const { registerHost } = useSabah();
    const elementRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const element = elementRef.current;
        if (!element) return;
        return registerHost(hostId, element);
    }, [hostId, registerHost]);

    return <div ref={elementRef} data-sabah-host={hostId} className={className} />;
}
