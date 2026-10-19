import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PmoBackButton } from "@/components/pmo/pmo-back-button";
import { Timeline } from "@/components/pmo/timeline/Timeline";
import { getCurrentPmoActor } from "@/lib/pmo/current-actor";

export default async function TimelinePage() {
    const actor = await getCurrentPmoActor();
    if (!actor || actor.role === "VIEWER") return null;

    return (
        <div className="mx-auto max-w-[1600px] space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <p className="text-primary">PMO Follow-up</p>
                    <h1 className="text-3xl font-bold">Portfolio timeline</h1>
                </div>
                <div className="flex gap-2">
                    <PmoBackButton />
                    <Button variant="outline" asChild>
                        <Link href="/pmo/portfolio">Portfolio</Link>
                    </Button>
                </div>
            </header>
            <Timeline />
        </div>
    );
}
