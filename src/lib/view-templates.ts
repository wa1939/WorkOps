import type { Block } from "@/components/view-blocks/block-editor";

export interface ViewTemplate {
    id: string;
    name: string;
    description: string;
    icon: string;
    color: string;
    cover: string;
    previewEmoji: string;
    tagline: string;
    blocks: Block[];
}

const id = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

export const SABAH_VIEW_ICON = "sabah";

export const VIEW_TEMPLATES: ViewTemplate[] = [
    {
        id: "executive-dashboard",
        name: "Executive Dashboard",
        description: "Weekly leadership pulse — stats, trends, and a team snapshot at a glance.",
        icon: "📊",
        color: "purple",
        cover: "grad-violet",
        previewEmoji: "📊",
        tagline: "Leadership pulse check",
        blocks: [
            { id: id("h"), type: "header", content: "Executive Dashboard", size: "h1", width: "full" },
            {
                id: id("c"),
                type: "callout",
                variant: "info",
                content: "**Weekly pulse check.** Add a key takeaway from the week.",
                width: "full",
            },
            { id: id("st"), type: "statTile", metric: "team-done-week", tone: "emerald", label: "Done this week", width: "third" },
            { id: id("st"), type: "statTile", metric: "team-overdue", tone: "rose", label: "Team overdue", width: "third" },
            { id: id("st"), type: "statTile", metric: "on-track-kpis", tone: "violet", label: "On-track KPIs", width: "third" },
            { id: id("ch"), type: "chart", chartKind: "task-completion-trend", title: "Completion trend — last 14 days", width: "half" },
            { id: id("ch"), type: "chart", chartKind: "kpi-by-perspective", title: "KPIs by perspective", width: "half" },
            { id: id("h"), type: "header", content: "Needs Attention", size: "h2", width: "full" },
            {
                id: id("t"),
                type: "taskView",
                viewType: "table",
                dueRange: "overdue",
                groupBy: "assignee",
                sortBy: "priority",
                sortDir: "desc",
                width: "full",
            },
        ],
    },
    {
        id: "project-war-room",
        name: "Project War Room",
        description: "Command center for a single critical project — choose the project first, then review status, blockers, board, and timeline.",
        icon: "🎯",
        color: "orange",
        cover: "grad-sunset",
        previewEmoji: "🚀",
        tagline: "Mission control for one project",
        blocks: [
            { id: id("h"), type: "header", content: "Project War Room", size: "h1", width: "full" },
            {
                id: id("c"),
                type: "callout",
                variant: "warning",
                content: "**Active status:** write the current health here (on track / at risk / blocked) with one line of context.",
                width: "full",
            },
            { id: id("st"), type: "statTile", metric: "active-projects", tone: "amber", label: "Active projects", width: "third" },
            { id: id("st"), type: "statTile", metric: "team-overdue", tone: "rose", label: "Overdue", width: "third" },
            { id: id("st"), type: "statTile", metric: "team-done-week", tone: "emerald", label: "Done this week", width: "third" },
            { id: id("h"), type: "header", content: "Kanban Board", size: "h2", width: "full" },
            {
                id: id("t"),
                type: "taskView",
                viewType: "board",
                groupBy: "status",
                projectSelectionRequired: true,
                width: "full",
            },
            { id: id("h"), type: "header", content: "Risks & Blockers", size: "h2", width: "full" },
            {
                id: id("tog"),
                type: "toggle",
                title: "Risk register",
                content: "- Risk 1 — owner, likelihood, mitigation\n- Risk 2 — owner, likelihood, mitigation\n- Risk 3 — owner, likelihood, mitigation",
                width: "full",
            },
            {
                id: id("tod"),
                type: "todo",
                items: [
                    { id: "i1", text: "Confirm scope with stakeholders", done: false },
                    { id: "i2", text: "Lock delivery date", done: false },
                    { id: "i3", text: "Identify critical path tasks", done: false },
                ],
                width: "half",
            },
            {
                id: id("q"),
                type: "quote",
                content: "The critical path is the team's single source of truth.",
                attribution: "War Room rule #1",
                width: "half",
            },
        ],
    },
    {
        id: "team-okrs",
        name: "Team OKRs & KPIs",
        description: "Quarterly objectives with live KPI progress and contributing tasks.",
        icon: "🎖️",
        color: "green",
        cover: "grad-forest",
        previewEmoji: "🎖️",
        tagline: "Objectives that actually move",
        blocks: [
            { id: id("h"), type: "header", content: "Team OKRs", size: "h1", width: "full" },
            {
                id: id("c"),
                type: "callout",
                variant: "tip",
                content: "**North star:** write your quarterly objective in one sentence. Edit this block.",
                width: "full",
            },
            { id: id("st"), type: "statTile", metric: "on-track-kpis", tone: "emerald", label: "On-track KPIs", width: "half" },
            { id: id("st"), type: "statTile", metric: "at-risk-kpis", tone: "rose", label: "Need attention", width: "half" },
            { id: id("ch"), type: "chart", chartKind: "kpi-status", title: "KPI status distribution", width: "full" },
            { id: id("h"), type: "header", content: "Key KPIs", size: "h2", width: "full" },
            { id: id("k"), type: "kpiSnapshot", width: "third" },
            { id: id("k"), type: "kpiSnapshot", width: "third" },
            { id: id("k"), type: "kpiSnapshot", width: "third" },
            { id: id("h"), type: "header", content: "Contributing Work", size: "h2", width: "full" },
            {
                id: id("t"),
                type: "taskView",
                viewType: "table",
                groupBy: "status",
                sortBy: "dueDate",
                width: "full",
            },
        ],
    },
    {
        id: "daily-standup",
        name: "My Daily Standup",
        description: "Your morning dashboard — yesterday, today, this week, and what matters most.",
        icon: "☀️",
        color: "cyan",
        cover: "grad-sunrise",
        previewEmoji: "☀️",
        tagline: "Start your day with clarity",
        blocks: [
            { id: id("h"), type: "header", content: "Good morning 👋", size: "h1", width: "full" },
            {
                id: id("c"),
                type: "callout",
                variant: "info",
                content: "**Today's focus:** one sentence — what will make today a win? (click to edit)",
                width: "full",
            },
            { id: id("st"), type: "statTile", metric: "my-open", tone: "violet", label: "My open tasks", width: "third" },
            { id: id("st"), type: "statTile", metric: "my-due-today", tone: "amber", label: "Due today", width: "third" },
            { id: id("st"), type: "statTile", metric: "my-overdue", tone: "rose", label: "Overdue", width: "third" },
            { id: id("h"), type: "header", content: "Today", size: "h2", width: "full" },
            {
                id: id("t"),
                type: "taskView",
                viewType: "board",
                assigneeIds: ["@me"],
                dueRange: "today",
                groupBy: "priority",
                width: "full",
            },
            { id: id("h"), type: "header", content: "This Week", size: "h2", width: "full" },
            {
                id: id("t"),
                type: "taskView",
                viewType: "table",
                assigneeIds: ["@me"],
                dueRange: "this-week",
                sortBy: "dueDate",
                sortDir: "asc",
                width: "full",
            },
        ],
    },
    {
        id: "weekly-report",
        name: "Weekly Report Canvas",
        description: "Polished weekly report — charts, highlights, summary block, and workstreams.",
        icon: "📝",
        color: "pink",
        cover: "grad-rose",
        previewEmoji: "📝",
        tagline: "Ship a beautiful weekly update",
        blocks: [
            { id: id("h"), type: "header", content: "Weekly Report", size: "h1", width: "full" },
            {
                id: id("q"),
                type: "quote",
                content: "Write your headline insight of the week here — what moved, what slowed, what mattered.",
                attribution: "Team lead",
                width: "full",
            },
            { id: id("ch"), type: "chart", chartKind: "task-completion-trend", title: "Completion trend", width: "half" },
            { id: id("ch"), type: "chart", chartKind: "task-by-project", title: "By project", width: "half" },
            { id: id("h"), type: "header", content: "Highlights", size: "h2", width: "full" },
            {
                id: id("c"),
                type: "callout",
                variant: "success",
                content: "Add 4-7 tight bullets of what shipped, what slowed, and what mattered.",
                width: "full",
            },
            {
                id: id("tog"),
                type: "toggle",
                title: "Done this week",
                content: "List the completed workstreams.",
                width: "full",
            },
            {
                id: id("t"),
                type: "taskView",
                viewType: "table",
                sortBy: "dueDate",
                groupBy: "project",
                width: "full",
            },
            {
                id: id("tog"),
                type: "toggle",
                title: "Blockers & overdue",
                content: "Call out anything stuck or slipping, with an owner and a next action.",
                width: "full",
            },
        ],
    },
    {
        id: "sabah-workspace",
        name: "Sabah Workspace",
        description: "A calm daily work surface where Sabah helps you review priorities, blockers, and updates.",
        icon: SABAH_VIEW_ICON,
        color: "cyan",
        cover: "",
        previewEmoji: "sabah",
        tagline: "Daily work, with Sabah at the center",
        blocks: [
            {
                id: id("sabah"),
                type: "assistantWorkspace",
                assistantLayout: "context",
                assistantAccent: "sky",
                width: "full",
            },
        ],
    },
];

export const BLANK_TEMPLATE: ViewTemplate = {
    id: "blank",
    name: "Blank canvas",
    description: "Start from scratch and build whatever you imagine.",
    icon: "📄",
    color: "blue",
    cover: "",
    previewEmoji: "📄",
    tagline: "A blank page, infinite possibilities",
    blocks: [
        { id: id("h"), type: "header", content: "Your view", size: "h1", width: "full" },
        { id: id("t"), type: "text", content: "Click to start writing, or press **+ Add Block** below.", width: "full" },
    ],
};
