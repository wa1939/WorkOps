import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface EmptyStateAction {
    label: string;
    href?: string;
    onClick?: () => void;
    icon?: LucideIcon;
    variant?: "primary" | "secondary" | "ghost";
}

interface EmptyStateProps {
    icon: LucideIcon;
    title: string;
    description?: string;
    actions?: EmptyStateAction[];
    className?: string;
}

const actionClasses: Record<NonNullable<EmptyStateAction["variant"]>, string> = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border/40",
    ghost: "bg-transparent text-foreground hover:bg-accent border border-border/40",
};

/**
 * Actionable empty state. Shows an icon, title, prose, and 1-3 action cards.
 * Prefer this over the older icon+text-only pattern — dead pages become
 * inviting first-actions.
 */
export function EmptyState({ icon: Icon, title, description, actions = [], className }: EmptyStateProps) {
    return (
        <Card className={cn("col-span-full", className)}>
            <CardContent className="flex flex-col items-center py-16 px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-5">
                    <Icon className="h-7 w-7" />
                </div>
                <h3 className="text-lg font-semibold">{title}</h3>
                {description && (
                    <p className="mt-2 max-w-md text-sm text-muted-foreground leading-relaxed">
                        {description}
                    </p>
                )}
                {actions.length > 0 && (
                    <div className="mt-6 grid w-full max-w-2xl gap-3 sm:grid-cols-3">
                        {actions.map((a, i) => {
                            const variant = a.variant ?? (i === 0 ? "primary" : "secondary");
                            const content = (
                                <div className="flex flex-col items-start gap-2 rounded-xl p-4 text-left transition-colors h-full">
                                    {a.icon && <a.icon className="h-5 w-5" />}
                                    <span className="text-sm font-medium leading-tight">{a.label}</span>
                                </div>
                            );
                            const className = cn(
                                "rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                actionClasses[variant],
                            );
                            if (a.href) {
                                return (
                                    <Link key={i} href={a.href} className={className}>
                                        {content}
                                    </Link>
                                );
                            }
                            return (
                                <button key={i} type="button" onClick={a.onClick} className={className}>
                                    {content}
                                </button>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
