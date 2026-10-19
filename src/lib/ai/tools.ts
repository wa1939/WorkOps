import type { GLMTool } from "@/lib/glm";

export const AI_TOOLS: GLMTool[] = [
    {
        type: "function",
        function: {
            name: "createTask",
            description:
                "Create a SINGLE task. For multiple tasks in one request, ALWAYS prefer `createTasks` (plural) to save round-trips. The current user is automatically set as the creator.",
            parameters: {
                type: "object",
                properties: {
                    title: {
                        type: "string",
                        description: "Short, action-oriented task title (required)",
                    },
                    description: {
                        type: "string",
                        description: "Optional longer description or notes about the task",
                    },
                    priority: {
                        type: "string",
                        enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
                        description: "Task priority. Default MEDIUM.",
                    },
                    status: {
                        type: "string",
                        enum: ["TODO", "DOING", "BLOCKED", "WAITING", "DONE"],
                        description: "Initial status. Default TODO. Use DONE ONLY when recording already-finished work (تسجيل الأسبوع flow) — the server stamps doneAt.",
                    },
                    dueAt: {
                        type: "string",
                        description: "Due date as ISO-8601 string (e.g. 2026-04-25T17:00:00.000Z). Resolve relative dates using the current date from the system prompt.",
                    },
                    projectId: {
                        type: "string",
                        description: "ID of the project this task belongs to. Use listProjects first if unknown.",
                    },
                    kpiId: {
                        type: "string",
                        description: "ID of the KPI this task contributes to. Use listKpis first if unknown.",
                    },
                    assigneeIds: {
                        type: "array",
                        items: { type: "string" },
                        description:
                            "Array of user IDs to assign. Use the token '@me' for the current user. If omitted entirely, the server assigns the task to the current user automatically.",
                    },
                    effortHours: {
                        type: "number",
                        description: "Estimated effort in hours (optional)",
                    },
                },
                required: ["title"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "createTasks",
            description:
                "Create MULTIPLE tasks in one atomic batch by default. USE THIS whenever the user asks for more than one task. Set allowPartial=true only when an explicitly approved workflow permits partial completion; otherwise failures roll back the whole batch.",
            parameters: {
                type: "object",
                properties: {
                    tasks: {
                        type: "array",
                        minItems: 1,
                        maxItems: 100,
                        description: "Array of tasks to create. Each task has the same shape as createTask params. Up to 100 per batch — prefer one large batch over many small ones.",
                        items: {
                            type: "object",
                            properties: {
                                title: { type: "string", description: "Task title (required)" },
                                description: { type: "string" },
                                priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
                                status: { type: "string", enum: ["TODO", "DOING", "BLOCKED", "WAITING", "DONE"] },
                                dueAt: { type: "string", description: "ISO-8601 due date" },
                                projectId: { type: "string" },
                                kpiId: { type: "string" },
                                assigneeIds: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Use '@me' for current user; resolved user IDs otherwise. Omitted → auto-assigned to the current user.",
                                },
                                effortHours: { type: "number" },
                            },
                            required: ["title"],
                        },
                    },
                    allowPartial: { type: "boolean", description: "Optional workflow-approved partial mode. Omit or false for all-or-nothing atomic creation." },
                    sharedDueAt: {
                        type: "string",
                        description: "Optional. If all tasks share a due date, set it once here instead of on each task.",
                    },
                    sharedPriority: {
                        type: "string",
                        enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
                        description: "Optional shared priority applied to tasks that don't specify one.",
                    },
                    sharedProjectId: {
                        type: "string",
                        description: "Optional shared project id for tasks that don't specify one.",
                    },
                },
                required: ["tasks"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "cancelCreatedTasks",
            description: "Cancel standard tasks created by the current user. Unauthorized or external-action tasks are rejected.",
            parameters: { type: "object", properties: { taskIds: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } } }, required: ["taskIds"] },
        },
    },
    {
        type: "function",
        function: {
            name: "updateTaskStatus",
            description:
                "Change the status of an existing task. Only allowed if the current user is the task creator or an assignee. Returns 'forbidden' error otherwise.",
            parameters: {
                type: "object",
                properties: {
                    taskId: { type: "string", description: "The task ID" },
                    status: {
                        type: "string",
                        enum: ["TODO", "DOING", "BLOCKED", "WAITING", "DONE", "CANCELED"],
                        description: "The new status",
                    },
                },
                required: ["taskId", "status"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "listMyTasks",
            description: "List tasks assigned to the current user. Use to answer 'what are my tasks', 'show my work', etc.",
            parameters: {
                type: "object",
                properties: {
                    status: {
                        type: "string",
                        enum: ["TODO", "DOING", "BLOCKED", "WAITING", "DONE", "CANCELED"],
                        description: "Filter by a single status (optional)",
                    },
                    limit: {
                        type: "number",
                        description: "Max number of tasks to return (default 20, max 50)",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "searchTasks",
            description: "Search tasks by keyword in title or description. Returns up to 20 matches.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Keyword to search for (required)" },
                    limit: { type: "number", description: "Max matches to return (default 20, max 50)" },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "getTaskStats",
            description: "Get exact counts of ALL current-user assigned tasks by status and priority. openTotal/openByPriority exclude DONE and CANCELED; total/byPriority include them. Use these aggregates for totals, never estimates from bounded list/search samples.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "listProjects",
            description: "List active projects with basic info (id, name, status). Use to look up a projectId for createTask.",
            parameters: {
                type: "object",
                properties: {
                    limit: { type: "number", description: "Max to return (default 20)" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "listTeamMembers",
            description: "List active users with id, name, email. Use to resolve assignee names to user IDs before createTask.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Optional name/email substring to filter by",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "listKpis",
            description: "List KPIs with id, name, and perspective. Use to look up a kpiId for createTask.",
            parameters: {
                type: "object",
                properties: {
                    perspective: {
                        type: "string",
                        description: "Optional perspective filter (e.g. 'Financial', 'Customer', 'Process', 'Learning')",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "getTask",
            description: "Get full details of a single task by ID, including project, assignees, and status.",
            parameters: {
                type: "object",
                properties: {
                    taskId: { type: "string", description: "The task ID" },
                },
                required: ["taskId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "reassignTask",
            description:
                "Change who a task is assigned to. Pass the full list of assignee user IDs (or ['@me']); the tool replaces the assignment set. Use listTeamMembers first if the target user's id is unknown.",
            parameters: {
                type: "object",
                properties: {
                    taskId: { type: "string", description: "The task ID" },
                    assigneeIds: {
                        type: "array",
                        items: { type: "string" },
                        description: "User IDs (or '@me'). An empty array unassigns the task, sending it to the floating pool.",
                    },
                },
                required: ["taskId", "assigneeIds"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "updateTaskFields",
            description:
                "Update editable fields on an existing task (priority, dueAt, effortHours, projectId, isStarred). Only pass fields that need to change.",
            parameters: {
                type: "object",
                properties: {
                    taskId: { type: "string" },
                    priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
                    dueAt: {
                        type: "string",
                        description: "ISO-8601 date to set, or the literal string 'null' to clear the due date.",
                    },
                    effortHours: { type: "number", description: "Estimated hours (positive number)" },
                    projectId: { type: "string", description: "Project ID to associate the task with, or 'null' to detach." },
                    isStarred: { type: "boolean" },
                },
                required: ["taskId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "logKpiUpdate",
            description:
                "Record a KPI update for a specific quarter. Use listKpis first to find the kpiId. score should be 0-5 (out of 5), achievementPercent 0-100.",
            parameters: {
                type: "object",
                properties: {
                    kpiId: { type: "string" },
                    quarter: { type: "string", enum: ["Q1", "Q2", "Q3", "Q4", "ANNUAL"] },
                    value: { type: "number", description: "Raw measured value in the KPI's unit (optional)." },
                    score: { type: "number", description: "Score out of 5 (optional)." },
                    achievementPercent: { type: "number", description: "% of target achieved 0-100 (optional)." },
                    note: { type: "string", description: "Short context (optional)." },
                },
                required: ["kpiId", "quarter"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "whatShouldIWorkOnNext",
            description:
                "Suggest the current user's top 3 open tasks ranked by (priority × 1/days-until-due). Explains why each was picked. Use before answering 'what should I do next' or 'help me plan today'.",
            parameters: {
                type: "object",
                properties: {
                    limit: { type: "number", description: "How many to return, default 3 (max 8)." },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "listPmoActions",
            description:
                "Query the PMO external-action tracker (things other departments/companies owe us): open/overdue items, who owes what, next reminders. Use dueBucket 'overdue' to answer 'who hasn't replied?'. Non-managers only see their own actions.",
            parameters: {
                type: "object",
                properties: {
                    ownerId: { type: "string", description: "'me', 'all', or a user id. Default 'all' (managers only; others are auto-scoped to self)." },
                    status: { type: "string", description: "TODO | DOING | BLOCKED | WAITING | DONE | CANCELED" },
                    dueBucket: { type: "string", description: "'overdue', 'due7' (next 7 days), or 'due30'." },
                    workArea: { type: "string", description: "Work-area name to filter by." },
                    query: { type: "string", description: "Substring filter on title/contact/parent." },
                    limit: { type: "number", description: "Max actions to return, default 20 (max 30)." },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "getPmoAction",
            description: "Full detail of one PMO external action by its task id, including evidence and follow-up history.",
            parameters: {
                type: "object",
                properties: {
                    taskId: { type: "string", description: "The external-action task id" },
                },
                required: ["taskId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "draftPmoFollowUp",
            description:
                "Compose a follow-up email draft for a PMO action. The user must copy it and send it from their own email client, then mark it sent on /pmo — never claim it was sent.",
            parameters: {
                type: "object",
                properties: {
                    taskId: { type: "string", description: "The external-action task id" },
                },
                required: ["taskId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "getIntakeRows",
            description:
                "Read a file the user uploaded (Excel/CSV/MoM). Tabular files return headers + up to 60 rows per page; documents return a text chunk. Use offset to page. ALWAYS summarize a task proposal and get the user's explicit confirmation before calling createTasks.",
            parameters: {
                type: "object",
                properties: {
                    intakeId: { type: "string", description: "Intake id from the upload message" },
                    offset: { type: "number", description: "Row offset (rows) or char offset (text). Default 0." },
                },
                required: ["intakeId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "listCapabilities",
            description: "List registered Sabah capabilities available to the authenticated actor. Use this to discover operational actions before proposing a governed workflow.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Optional name, module, or description search." },
                    module: { type: "string", description: "Optional exact module filter." },
                    limit: { type: "number", description: "Maximum results, 1-100 (default 20)." },
                    offset: { type: "number", description: "Pagination offset (default 0)." },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "getCapabilityDetails",
            description: "Read the bounded input/output schemas and risk for one registered Sabah capability available to the authenticated actor.",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string", description: "Registered capability name." },
                    version: { type: "number", description: "Optional exact capability version." },
                },
                required: ["name"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "proposeWorkflow",
            description: "Persist a governed action proposal for the current conversation. This does not execute steps; the user reviews the preview and gives inline confirmation in chat.",
            parameters: {
                type: "object",
                properties: {
                    goal: { type: "string", minLength: 1, maxLength: 500 },
                    steps: {
                        type: "array",
                        minItems: 1,
                        maxItems: 50,
                        items: {
                            type: "object",
                            properties: {
                                clientStepId: { type: "string", minLength: 1, maxLength: 80 },
                                capability: { type: "string", description: "Registered capability name" },
                                version: { type: "number", minimum: 1 },
                                args: { type: "object" },
                                dependsOn: { type: "array", items: { type: "string" } },
                                confidence: { type: "number", minimum: 0, maximum: 1 },
                                inferredFields: { type: "array", items: { type: "string" } },
                                evidenceRefs: { type: "array", items: { type: "string" } },
                            },
                            required: ["clientStepId", "capability", "args", "dependsOn", "confidence"],
                        },
                    },
                    idempotencyKey: { type: "string", minLength: 1, maxLength: 160 },
                },
                required: ["goal", "steps"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "proposeMemoryOrPlaybookUpdate",
            description: "Forward a bounded memory or playbook proposal for human approval. This tool cannot approve, reject, or archive proposals.",
            parameters: {
                type: "object",
                properties: {
                    kind: { type: "string", enum: ["memory", "playbook"] },
                    proposal: { type: "object", description: "A complete source-backed memory or playbook proposal; approval decisions are not accepted." },
                },
                required: ["kind", "proposal"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "workspaceSearch",
            description: "Search the actor-authorized workspace and return bounded source-backed evidence. Actor, permissions, and result caps are server-controlled.",
            parameters: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 512 }, entityTypes: { type: "array", maxItems: 4, items: { type: "string", enum: ["PROJECT", "TASK", "KPI", "PMO_ACTION", "NOTE", "LEAVE", "CASE_STUDY", "REPORT", "SUPPORT_REQUEST"] } }, limit: { type: "number", maximum: 20 }, cursor: { type: "string", maxLength: 512 } }, required: ["query", "entityTypes"] },
        },
    },
];

export const AI_TOOL_NAMES = new Set(AI_TOOLS.map((t) => t.function.name));

export function isWhitelistedTool(name: string): boolean {
    return AI_TOOL_NAMES.has(name);
}
