import { Suspense } from "react";
import { PmoRouteTracker } from "@/components/pmo/pmo-route-tracker";

export default function PmoLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <Suspense fallback={null}>
                <PmoRouteTracker kind="pmo" />
            </Suspense>
            {children}
        </>
    );
}
