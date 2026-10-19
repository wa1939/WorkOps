import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface SkeletonListProps {
    rows?: number;
    className?: string;
}

/** Skeleton placeholder for task-row / list-row loading states. */
export function SkeletonList({ rows = 5, className }: SkeletonListProps) {
    return (
        <div className={cn("space-y-3", className)}>
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-4 rounded-lg border bg-card">
                    <Skeleton className="h-8 w-2 rounded-full" />
                    <Skeleton className="h-4 w-4 rounded" />
                    <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-3/5" />
                        <div className="flex gap-3">
                            <Skeleton className="h-3 w-16" />
                            <Skeleton className="h-3 w-12" />
                            <Skeleton className="h-3 w-14" />
                        </div>
                    </div>
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <Skeleton className="h-8 w-8 rounded" />
                </div>
            ))}
        </div>
    );
}

interface SkeletonGridProps {
    count?: number;
    className?: string;
}

/** Skeleton placeholder for card-grid layouts. */
export function SkeletonGrid({ count = 6, className }: SkeletonGridProps) {
    return (
        <div className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-3", className)}>
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="rounded-lg border bg-card p-5 space-y-3">
                    <div className="flex justify-between">
                        <Skeleton className="h-8 w-8 rounded" />
                        <Skeleton className="h-5 w-16" />
                    </div>
                    <Skeleton className="h-5 w-4/5" />
                    <Skeleton className="h-3 w-2/3" />
                    <div className="pt-2">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-full mt-2" />
                    </div>
                </div>
            ))}
        </div>
    );
}
