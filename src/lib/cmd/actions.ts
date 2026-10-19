import type { LucideIcon } from "lucide-react";
import {
    BarChart3,
    BookOpen,
    Calendar,
    CalendarDays,
    CheckSquare,
    ClipboardCheck,
    FolderKanban,
    LayoutDashboard,
    LayoutGrid,
    List,
    Settings,
    StickyNote,
    Sun,
    Target,
    Users,
} from "lucide-react";

export type CommandGroup = "Navigation" | "Quick actions" | "Views" | "Appearance";
export type CommandActionKind = "toggle-theme";

export type CommandDefinition = {
    id: string;
    label: string;
    description?: string;
    keywords?: readonly string[];
    group?: CommandGroup;
    href?: string;
    action?: CommandActionKind;
    icon?: LucideIcon;
    adminOnly?: boolean;
};

/**
 * Navigation mirrors the route entries in src/components/layout/sidebar.tsx.
 * Keep this registry declarative so commands remain searchable and extensible.
 */
export const COMMAND_ACTIONS: readonly CommandDefinition[] = [
    { id: "nav-dashboard", label: "Home", description: "Open your home view", group: "Navigation", href: "/", icon: LayoutDashboard },
    { id: "nav-tasks", label: "Tasks", description: "Open the task workspace", group: "Navigation", href: "/tasks", icon: CheckSquare, keywords: ["work", "todo"] },
    { id: "nav-projects", label: "Projects", description: "Open projects", group: "Navigation", href: "/projects", icon: FolderKanban },
    { id: "nav-case-studies", label: "Case Studies", description: "Open case studies", group: "Navigation", href: "/case-studies", icon: BookOpen },
    { id: "nav-pmo", label: "PMO Follow-up", description: "Open PMO follow-up", group: "Navigation", href: "/pmo", icon: ClipboardCheck },
    { id: "nav-notes", label: "Notes", description: "Open notes", group: "Navigation", href: "/notes", icon: StickyNote },
    { id: "nav-team", label: "Team", description: "Open the team directory", group: "Navigation", href: "/team", icon: Users },
    { id: "nav-leave", label: "Leave", description: "Open leave requests", group: "Navigation", href: "/leave", icon: Calendar },
    { id: "nav-kpis", label: "KPIs", description: "Open department KPIs", group: "Navigation", href: "/kpis", icon: Target },
    { id: "nav-reports", label: "Reports", description: "Open reports", group: "Navigation", href: "/reports", icon: BarChart3 },
    { id: "nav-settings", label: "Settings", description: "Manage your preferences", group: "Navigation", href: "/settings", icon: Settings },
    { id: "nav-admin", label: "Admin", description: "Open administration", group: "Navigation", href: "/admin", icon: Settings, adminOnly: true },

    { id: "new-task", label: "New task", description: "Create a task", group: "Quick actions", href: "/tasks/new", icon: CheckSquare, keywords: ["create", "add"] },
    { id: "new-project", label: "New project", description: "Create a project", group: "Quick actions", href: "/projects/new", icon: FolderKanban, keywords: ["create", "add"] },
    { id: "new-note", label: "New note", description: "Create a note", group: "Quick actions", href: "/notes/new", icon: StickyNote, keywords: ["create", "add"] },

    { id: "tasks-list", label: "Tasks: list view", description: "Show tasks as a list", group: "Views", href: "/tasks?view=list", icon: List, keywords: ["tasks", "list"] },
    { id: "tasks-board", label: "Tasks: board view", description: "Show tasks as a board", group: "Views", href: "/tasks?view=board", icon: LayoutGrid, keywords: ["tasks", "kanban", "board"] },
    { id: "planner", label: "Planner", description: "Open the workload planner", group: "Views", href: "/planner", icon: CalendarDays, keywords: ["workload", "schedule"] },
    { id: "timeline", label: "Timeline", description: "Open the timeline", group: "Views", href: "/timeline", icon: BarChart3, keywords: ["roadmap", "gantt"] },

    { id: "toggle-theme", label: "Toggle theme", description: "Switch between light and dark mode", group: "Appearance", action: "toggle-theme", icon: Sun, keywords: ["dark", "light", "appearance"] },
];

/**
 * Match every term against the command's searchable text. Keeping this pure
 * makes command discovery deterministic in the palette and in unit tests.
 */
export function filterCommands(
    commands: readonly CommandDefinition[],
    query: string,
): CommandDefinition[] {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return Array.from(commands);

    return commands.filter((command) => {
        const searchableParts = [command.label, command.description ?? "", command.group ?? ""];
        if (command.keywords) {
            command.keywords.forEach((keyword) => searchableParts.push(keyword));
        }
        const searchableText = searchableParts.join(" ").toLowerCase();
        return terms.every((term) => searchableText.includes(term));
    });
}
