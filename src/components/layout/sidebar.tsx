"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    LayoutDashboard,
    CheckSquare,
    FolderKanban,
    BookOpen,
    Users,
    Target,
    StickyNote,
    Calendar,
    CalendarDays,
    Settings,
    Star,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    LogOut,
    Plus,
    Menu,
    X,
    ClipboardCheck,
    BarChart3,
} from "lucide-react";
import { cn, getInitials } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { useState, useEffect } from "react";
import { SavedViewsList } from "@/components/layout/saved-views-list";

interface SidebarProps {
    user?: {
        name?: string | null;
        email?: string | null;
        image?: string | null;
        role?: string;
    };
}

type NavSection = {
    id: string;
    label: string | null;
    items: { href: string; label: string; icon: typeof LayoutDashboard }[];
};

const navSections: NavSection[] = [
    {
        id: "home",
        label: null,
        items: [
            { href: "/", label: "Home", icon: LayoutDashboard },
        ],
    },
    {
        id: "work",
        label: "Work",
        items: [
            { href: "/tasks", label: "Tasks", icon: CheckSquare },
            { href: "/projects", label: "Projects", icon: FolderKanban },
            { href: "/case-studies", label: "Case Studies", icon: BookOpen },
            { href: "/pmo", label: "PMO Follow-up", icon: ClipboardCheck },
            { href: "/notes", label: "Notes", icon: StickyNote },
        ],
    },
    {
        id: "team",
        label: "Team",
        items: [
            { href: "/team", label: "Team", icon: Users },
            { href: "/leave", label: "Leave", icon: Calendar },
        ],
    },
    {
        id: "insights",
        label: "Insights",
        items: [
            { href: "/kpis", label: "KPIs", icon: Target },
            { href: "/reports", label: "Reports", icon: BarChart3 },
        ],
    },
];

const adminNavItems = [
    { href: "/admin", label: "Admin", icon: Settings },
];

const NAV_PREFS_STORAGE_KEY = "nav-prefs";
const NAV_PREFS_VERSION = 1 as const;

export function isNavItemActive(pathname: string, href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
}

type NavPreferences = {
    version: typeof NAV_PREFS_VERSION;
    collapsed: boolean;
    sectionOrder: Record<string, string[]>;
};

function defaultSectionOrder(): Record<string, string[]> {
    const order: Record<string, string[]> = {};
    navSections.forEach((section) => {
        order[section.id] = section.items.map((item) => item.href);
    });
    return order;
}

function defaultNavPreferences(): NavPreferences {
    return {
        version: NAV_PREFS_VERSION,
        collapsed: false,
        sectionOrder: defaultSectionOrder(),
    };
}

function readNavPreferences(): NavPreferences {
    const defaults = defaultNavPreferences();
    try {
        const raw = window.localStorage.getItem(NAV_PREFS_STORAGE_KEY);
        if (!raw) return defaults;
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return defaults;
        const candidate = parsed as {
            version?: unknown;
            collapsed?: unknown;
            sectionOrder?: unknown;
        };
        if (candidate.version !== NAV_PREFS_VERSION) return defaults;

        const storedOrder = candidate.sectionOrder;
        const sectionOrder: Record<string, string[]> = {};
        navSections.forEach((section) => {
            const defaultItems = defaults.sectionOrder[section.id] ?? [];
            const rawItems = storedOrder && typeof storedOrder === "object"
                ? (storedOrder as Record<string, unknown>)[section.id]
                : undefined;
            const validItems = Array.isArray(rawItems)
                ? rawItems.filter((item): item is string => typeof item === "string" && defaultItems.includes(item))
                : [];
            defaultItems.forEach((item) => {
                if (!validItems.includes(item)) validItems.push(item);
            });
            sectionOrder[section.id] = validItems;
        });

        return {
            version: NAV_PREFS_VERSION,
            collapsed: typeof candidate.collapsed === "boolean" ? candidate.collapsed : defaults.collapsed,
            sectionOrder,
        };
    } catch {
        return defaults;
    }
}

function writeNavPreferences(preferences: NavPreferences): void {
    try {
        window.localStorage.setItem(NAV_PREFS_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
        // Storage can be unavailable in private browsing; navigation remains usable.
    }
    // TODO(T4.1): sync v1 preferences to the authenticated user's profile server-side.
}

function orderedItems(section: NavSection, order: Record<string, string[]>): NavSection["items"] {
    const storedOrder = order[section.id] ?? [];
    return section.items.slice().sort((left, right) => {
        const leftIndex = storedOrder.indexOf(left.href);
        const rightIndex = storedOrder.indexOf(right.href);
        return leftIndex - rightIndex;
    });
}

function SidebarContent({
    user,
    collapsed,
    onCollapse,
    sectionOrder,
    onReorder,
    collapseLabel,
}: SidebarProps & {
    collapsed: boolean;
    onCollapse: () => void;
    sectionOrder: Record<string, string[]>;
    onReorder: (sectionId: string, sourceHref: string, targetHref: string) => void;
    collapseLabel?: string;
}) {
    const pathname = usePathname();
    const [draggedItem, setDraggedItem] = useState<{ sectionId: string; href: string } | null>(null);

    const collapseButtonLabel = collapseLabel
        ?? (collapsed ? "Expand sidebar" : "Collapse sidebar");

    return (
        <>
            {/* Logo */}
            <div className="flex items-center gap-2.5 px-4 py-4 border-b">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg shadow-sm overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/icons/app-192.png" alt="WorkOps" width={32} height={32} className="w-8 h-8" />
                </div>
                {!collapsed && (
                    <span className="font-semibold text-[15px] tracking-tight text-foreground">
                        WorkOps
                    </span>
                )}
                <GlobalSearch collapsed={collapsed} />
                <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    onClick={onCollapse}
                    aria-label={collapseButtonLabel}
                    title={collapseButtonLabel}
                >
                    {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                </Button>
            </div>

            {/* Navigation */}
            <ScrollArea className="flex-1 px-2 py-4">
                <nav className="space-y-5">
                    {navSections.map((section) => {
                        const items = orderedItems(section, sectionOrder);
                        return (
                            <div key={section.id} className="space-y-1">
                                {section.label && !collapsed && (
                                    <div className="px-3 pb-1 pt-1 text-[11px] font-medium text-muted-foreground/60">
                                        {section.label}
                                    </div>
                                )}
                                {items.map((item) => {
                                    const isActive = isNavItemActive(pathname, item.href);
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            draggable={items.length > 1}
                                            onDragStart={(event) => {
                                                setDraggedItem({ sectionId: section.id, href: item.href });
                                                event.dataTransfer.effectAllowed = "move";
                                                event.dataTransfer.setData("text/plain", item.href);
                                            }}
                                            onDragOver={(event) => {
                                                if (draggedItem?.sectionId === section.id) event.preventDefault();
                                            }}
                                            onDrop={(event) => {
                                                event.preventDefault();
                                                if (draggedItem?.sectionId === section.id && draggedItem.href !== item.href) {
                                                    onReorder(section.id, draggedItem.href, item.href);
                                                }
                                                setDraggedItem(null);
                                            }}
                                            onDragEnd={() => setDraggedItem(null)}
                                            className={cn(
                                                "group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                                                isActive
                                                    ? "bg-primary/10 text-primary before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-r before:bg-primary"
                                                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                            )}
                                            title={collapsed ? item.label : undefined}
                                        >
                                            <item.icon className={cn("h-4.5 w-4.5 shrink-0 transition-transform", isActive && "scale-110")} />
                                            {!collapsed && <span>{item.label}</span>}
                                        </Link>
                                    );
                                })}
                            </div>
                        );
                    })}
                </nav>

                {/* Saved Views */}
                {!collapsed && (
                    <div className="mt-6 space-y-1">
                        <div className="flex items-center justify-between px-3 pb-1">
                            <span className="text-[11px] font-medium text-muted-foreground/60">
                                Saved views
                            </span>
                            <Button variant="ghost" size="icon" className="h-5 w-5" asChild>
                                <Link href="/views/new" title="New view">
                                    <Plus className="h-3 w-3" />
                                </Link>
                            </Button>
                        </div>
                        <SavedViewsList />
                    </div>
                )}

                {/* Admin */}
                {user?.role === "ADMIN" && (
                    <div className="mt-6 space-y-1">
                        {!collapsed && (
                            <div className="px-3 pb-1 pt-1 text-[11px] font-medium text-muted-foreground/60">
                                Admin
                            </div>
                        )}
                        {adminNavItems.map((item) => {
                            const isActive = isNavItemActive(pathname, item.href);
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={cn(
                                        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                                        isActive
                                            ? "bg-primary/10 text-primary"
                                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                    )}
                                    title={collapsed ? item.label : undefined}
                                >
                                    <item.icon className="h-4.5 w-4.5 shrink-0" />
                                    {!collapsed && <span>Settings</span>}
                                </Link>
                            );
                        })}
                    </div>
                )}
            </ScrollArea>

            {/* User Menu */}
            <div className="border-t p-4">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            className={cn(
                                "w-full justify-start gap-3 px-2",
                                collapsed && "justify-center"
                            )}
                        >
                            <Avatar className="h-8 w-8">
                                <AvatarImage src={user?.image || ""} alt={user?.name || ""} />
                                <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                                    {getInitials(user?.name || "U")}
                                </AvatarFallback>
                            </Avatar>
                            {!collapsed && (
                                <>
                                    <div className="flex flex-col items-start text-left">
                                        <span className="text-sm font-medium">{user?.name}</span>
                                        <span className="text-xs text-muted-foreground">{user?.role}</span>
                                    </div>
                                    <ChevronDown className="h-4 w-4 ml-auto text-muted-foreground" />
                                </>
                            )}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem asChild>
                            <Link href="/settings">
                                <Settings className="mr-2 h-4 w-4" />
                                Settings
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="text-destructive cursor-pointer"
                            onClick={async () => {
                                // Best-effort: stop this device receiving the
                                // account's push before the session ends.
                                try {
                                    await fetch("/api/notifications/push/revoke-all", { method: "POST" });
                                    if ("serviceWorker" in navigator) {
                                        const registration = await navigator.serviceWorker.getRegistration();
                                        const subscription = await registration?.pushManager.getSubscription();
                                        await subscription?.unsubscribe();
                                    }
                                } catch {
                                    // Never block sign-out on revocation.
                                }
                                window.location.href = "/api/auth/signout";
                            }}
                        >
                            <LogOut className="mr-2 h-4 w-4" />
                            Sign out
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </>
    );
}

export function Sidebar({ user }: SidebarProps) {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [sectionOrder, setSectionOrder] = useState<Record<string, string[]>>(() => defaultSectionOrder());
    const [navPrefsHydrated, setNavPrefsHydrated] = useState(false);

    useEffect(() => {
        const preferences = readNavPreferences();
        setCollapsed(preferences.collapsed);
        setSectionOrder(preferences.sectionOrder);
        setNavPrefsHydrated(true);
    }, []);

    useEffect(() => {
        if (!navPrefsHydrated) return;
        writeNavPreferences({
            version: NAV_PREFS_VERSION,
            collapsed,
            sectionOrder,
        });
    }, [collapsed, navPrefsHydrated, sectionOrder]);

    const reorderNavItem = (sectionId: string, sourceHref: string, targetHref: string) => {
        setSectionOrder((current) => {
            const currentOrder = current[sectionId];
            if (!currentOrder) return current;
            const sourceIndex = currentOrder.indexOf(sourceHref);
            const targetIndex = currentOrder.indexOf(targetHref);
            if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return current;

            const nextOrder = currentOrder.slice();
            const moved = nextOrder.splice(sourceIndex, 1)[0];
            if (!moved) return current;
            nextOrder.splice(nextOrder.indexOf(targetHref), 0, moved);
            return { ...current, [sectionId]: nextOrder };
        });
    };

    // Close mobile drawer on navigation
    useEffect(() => {
        setMobileOpen(false);
    }, [pathname]);

    return (
        <>
            {/* Desktop sidebar */}
            <aside
                className={cn(
                    "hidden md:flex flex-col h-screen border-r bg-card transition-all duration-300",
                    collapsed ? "w-16" : "w-64"
                )}
            >
                <SidebarContent
                    user={user}
                    collapsed={collapsed}
                    onCollapse={() => setCollapsed((current) => !current)}
                    sectionOrder={sectionOrder}
                    onReorder={reorderNavItem}
                />
            </aside>

            {/* Mobile drawer overlay */}
            {mobileOpen && (
                <div
                    className="fixed inset-0 z-50 bg-black/50 md:hidden"
                    onClick={() => setMobileOpen(false)}
                />
            )}

            {/* Mobile drawer */}
            <aside
                className={cn(
                    "fixed inset-y-0 left-0 z-50 flex flex-col w-64 bg-card border-r transition-transform duration-300 md:hidden",
                    mobileOpen ? "translate-x-0" : "-translate-x-full"
                )}
            >
                <SidebarContent
                    user={user}
                    collapsed={false}
                    onCollapse={() => setMobileOpen(false)}
                    sectionOrder={sectionOrder}
                    onReorder={reorderNavItem}
                    collapseLabel="Close navigation"
                />
            </aside>

            {/* Mobile hamburger button - rendered as a portal-like element, consumed by Topbar */}
            <button
                className="md:hidden fixed top-3 left-3 z-40 p-2 rounded-md bg-background border shadow-sm"
                onClick={() => setMobileOpen(true)}
                style={{ display: mobileOpen ? "none" : undefined }}
            >
                <Menu className="h-5 w-5" />
            </button>
        </>
    );
}

interface TopbarProps {
    user?: {
        name?: string | null;
    };
}

export function Topbar({ user }: TopbarProps) {
    return (
        <header className="sticky top-0 z-40 flex items-center gap-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 md:px-6 py-3">
            {/* Spacer for mobile hamburger */}
            <div className="w-10 md:hidden" />

            {/* Quick Actions */}
            <div className="flex items-center gap-2 ml-auto">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button size="sm" className="gap-2">
                            <Plus className="h-4 w-4" />
                            <span className="hidden sm:inline">Quick Add</span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                            <Link href="/tasks/new">New Task</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                            <Link href="/pmo/actions/new">New External Action</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                            <Link href="/projects/new">New Project</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                            <Link href="/case-studies/new">New Case Study</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                            <Link href="/notes/new">New Note</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                            <Link href="/leave/new">Request Leave</Link>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* Theme */}
                <ThemeToggle />

                {/* Notifications */}
                <NotificationBell />
            </div>
        </header>
    );
}
