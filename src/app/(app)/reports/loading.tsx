import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonGrid } from "@/components/ui/skeleton-list";

export default function ReportsLoading() {
    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
                <div className="space-y-2">
                    <Skeleton className="h-8 w-32" />
                    <Skeleton className="h-4 w-64" />
                </div>
                <div className="flex gap-2">
                    <Skeleton className="h-9 w-40" />
                    <Skeleton className="h-9 w-32" />
                </div>
            </div>

            <SkeletonGrid count={6} />
        </div>
    );
}
