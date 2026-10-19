import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonGrid } from "@/components/ui/skeleton-list";

export default function KpisLoading() {
    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
                <div className="space-y-2">
                    <Skeleton className="h-8 w-32" />
                    <Skeleton className="h-4 w-64" />
                </div>
                <Skeleton className="h-9 w-24" />
            </div>

            <div className="grid gap-4 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-lg border bg-card p-4 space-y-3">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-8 w-12" />
                    </div>
                ))}
            </div>

            <div className="space-y-3">
                <Skeleton className="h-5 w-40" />
                <SkeletonGrid count={6} />
            </div>
        </div>
    );
}
