/**
 * Synthetic demo seed — generic data only, safe to ship in an open-source repo.
 *
 * Safety contract:
 * - Opt-in only: refuses to run unless WORKOPS_DEMO_SEED=1 (or "true").
 * - Refuses non-local DATABASE_URL hosts (allowed: localhost, 127.0.0.1, ::1, db).
 *   The connection string itself is never printed (it contains credentials).
 * - Refuses to run before the first-admin bootstrap (`npm run setup:admin`):
 *   it reuses the earliest verified, active ADMIN as the demo owner and never
 *   creates an admin, never touches that account's password/role/email/state.
 * - Additional demo users get unpredictable random passwords (bcrypt cost 12).
 *   Neither plaintext nor hashes are ever logged or written anywhere else, so
 *   nobody can sign in as them; sign in as the existing admin instead.
 * - All names, emails and content are synthetic; emails use example.test only.
 * - Idempotent: stable explicit demo IDs ("demo-*", "DEMO-1xx/2xx"), upsert-only.
 *   It never deletes or modifies rows outside the demo namespace.
 */

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { readDatabaseUrl } from "../scripts/assert-local-database";
import { loadSetupEnvironment } from "../scripts/setup/lib/environment";

let prisma: PrismaClient;

let DEMO_WORKSPACE_ID = "demo-workspace";
let DEMO_WORKSPACE_SLUG = "demo";
let DEMO_WORKSPACE_NAME = "Demo Workspace";
const DEMO_DEPARTMENT_ID = "demo-department";
const DEMO_DEPARTMENT_NAME = "Demo Operations";

const MANAGER_USER_ID = "demo-user-manager";

/** Allowed DB hosts for the demo seed. "db" covers docker-compose service names. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "db"]);

type DemoUser = {
    id: string;
    email: string;
    name: string;
    title: string;
    role: "MANAGER" | "MEMBER" | "VIEWER";
    workspaceRole: "ADMIN" | "MEMBER" | "VIEWER";
    managerId?: string;
};

const DEMO_USERS: DemoUser[] = [
    {
        id: MANAGER_USER_ID,
        email: "avery.quinn@example.test",
        name: "Avery Quinn (Demo)",
        title: "Delivery Manager",
        role: "MANAGER",
        workspaceRole: "ADMIN",
    },
    {
        id: "demo-user-riley",
        email: "riley.chen@example.test",
        name: "Riley Chen (Demo)",
        title: "Analyst",
        role: "MEMBER",
        workspaceRole: "MEMBER",
        managerId: MANAGER_USER_ID,
    },
    {
        id: "demo-user-jordan",
        email: "jordan.patel@example.test",
        name: "Jordan Patel (Demo)",
        title: "Coordinator",
        role: "MEMBER",
        workspaceRole: "MEMBER",
        managerId: MANAGER_USER_ID,
    },
    {
        id: "demo-user-casey",
        email: "casey.morgan@example.test",
        name: "Casey Morgan (Demo)",
        title: "Reviewer",
        role: "VIEWER",
        workspaceRole: "VIEWER",
        managerId: MANAGER_USER_ID,
    },
];

function fail(message: string): never {
    console.error(`[demo-seed] REFUSED: ${message}`);
    process.exit(1);
}

function assertDemoSafety(): string {
    const flag = process.env.WORKOPS_DEMO_SEED;
    if (flag !== "1" && flag !== "true") {
        fail("Demo seed is opt-in. Re-run with WORKOPS_DEMO_SEED=1.");
    }

    const rawUrl = readDatabaseUrl();
    if (!rawUrl) {
        fail("DATABASE_URL is not configured (checked env, .env.local, .env).");
    }
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        fail("DATABASE_URL is invalid.");
    }
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
        fail("DATABASE_URL must use PostgreSQL.");
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!LOCAL_HOSTS.has(host)) {
        fail(
            `database host "${host}" is not local. Allowed hosts: localhost, 127.0.0.1, ::1, db.`,
        );
    }
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    console.log(`[demo-seed] local database accepted: ${host}/${databaseName}`);
    return rawUrl;
}

async function findDemoOwner() {
    const admin = await prisma.user.findFirst({
        where: { role: "ADMIN", isActive: true, emailVerified: { not: null } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!admin) {
        fail(
            "no verified active ADMIN user exists yet. " +
                "Run `npm run setup:admin` (first-admin bootstrap) before seeding the demo; " +
                "the demo reuses that admin as its owner.",
        );
    }
    return admin;
}

function daysFromNow(days: number): Date {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function seedWorkspaceAndDepartment(): Promise<void> {
    await prisma.workspace.upsert({
        where: { slug: DEMO_WORKSPACE_SLUG },
        create: {
            id: DEMO_WORKSPACE_ID,
            slug: DEMO_WORKSPACE_SLUG,
            name: DEMO_WORKSPACE_NAME,
            timezone: "UTC",
        },
        update: {},
    });

    await prisma.department.upsert({
        where: { name: DEMO_DEPARTMENT_NAME },
        create: {
            id: DEMO_DEPARTMENT_ID,
            name: DEMO_DEPARTMENT_NAME,
            workspaceId: DEMO_WORKSPACE_ID,
        },
        update: {},
    });
}

async function seedDemoUsers(): Promise<void> {
    for (const user of DEMO_USERS) {
        // Unpredictable password, hashed and never logged or persisted anywhere
        // else. Only applied on create; re-runs never touch existing passwords.
        const passwordHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 12);
        await prisma.user.upsert({
            where: { email: user.email },
            create: {
                id: user.id,
                email: user.email,
                name: user.name,
                title: user.title,
                role: user.role,
                isActive: true,
                emailVerified: new Date(),
                password: passwordHash,
                managerId: user.managerId,
            },
            update: {},
        });

        await prisma.workspaceMember.upsert({
            where: {
                workspaceId_userId: { workspaceId: DEMO_WORKSPACE_ID, userId: user.id },
            },
            create: {
                workspaceId: DEMO_WORKSPACE_ID,
                userId: user.id,
                role: user.workspaceRole,
                active: true,
            },
            update: { active: true },
        });

        await prisma.userDepartment.upsert({
            where: {
                userId_departmentId: { userId: user.id, departmentId: DEMO_DEPARTMENT_ID },
            },
            create: { userId: user.id, departmentId: DEMO_DEPARTMENT_ID },
            update: {},
        });
    }
}

type DemoStage = {
    id: string;
    projectId: string;
    name: string;
    order: number;
    color: string;
    status: "PLANNED" | "ACTIVE" | "COMPLETE";
    startAt: Date;
    dueAt: Date;
};

const DEMO_STAGES: DemoStage[] = [
    {
        id: "demo-stage-alpha-1",
        projectId: "demo-project-alpha",
        name: "Discovery",
        order: 1,
        color: "#6366f1",
        status: "COMPLETE",
        startAt: daysFromNow(-30),
        dueAt: daysFromNow(-18),
    },
    {
        id: "demo-stage-alpha-2",
        projectId: "demo-project-alpha",
        name: "Build",
        order: 2,
        color: "#0ea5e9",
        status: "ACTIVE",
        startAt: daysFromNow(-17),
        dueAt: daysFromNow(14),
    },
    {
        id: "demo-stage-alpha-3",
        projectId: "demo-project-alpha",
        name: "Launch",
        order: 3,
        color: "#22c55e",
        status: "PLANNED",
        startAt: daysFromNow(15),
        dueAt: daysFromNow(45),
    },
    {
        id: "demo-stage-beta-1",
        projectId: "demo-project-beta",
        name: "Design",
        order: 1,
        color: "#a855f7",
        status: "COMPLETE",
        startAt: daysFromNow(-28),
        dueAt: daysFromNow(-12),
    },
    {
        id: "demo-stage-beta-2",
        projectId: "demo-project-beta",
        name: "Implement",
        order: 2,
        color: "#f59e0b",
        status: "ACTIVE",
        startAt: daysFromNow(-11),
        dueAt: daysFromNow(10),
    },
    {
        id: "demo-stage-beta-3",
        projectId: "demo-project-beta",
        name: "Rollout",
        order: 3,
        color: "#ef4444",
        status: "PLANNED",
        startAt: daysFromNow(11),
        dueAt: daysFromNow(40),
    },
];

async function seedProjectsAndStages(ownerId: string, managerId: string): Promise<void> {
    const projects = [
        {
            id: "demo-project-alpha",
            name: "Onboarding Portal Revamp (Demo)",
            description:
                "Synthetic project: refresh the new-hire onboarding portal content and workflow.",
            priority: "HIGH" as const,
            health: "ON_TRACK" as const,
            objective: "Give every new joiner a single, current onboarding path.",
            successCriteria: "All onboarding steps completed within the first two weeks.",
            dueAt: daysFromNow(45),
        },
        {
            id: "demo-project-beta",
            name: "Quarterly Reporting Automation (Demo)",
            description:
                "Synthetic project: automate the recurring quarterly status report production.",
            priority: "MEDIUM" as const,
            health: "AT_RISK" as const,
            objective: "Reduce manual report assembly to near zero.",
            successCriteria: "Quarterly reports generated from live data without manual edits.",
            dueAt: daysFromNow(60),
        },
    ];

    for (const project of projects) {
        await prisma.project.upsert({
            where: { id: project.id },
            create: {
                id: project.id,
                name: project.name,
                description: project.description,
                status: "Active",
                startAt: daysFromNow(-30),
                dueAt: project.dueAt,
                ownerId,
                managerId,
                responsibleDepartmentId: DEMO_DEPARTMENT_ID,
                workspaceId: DEMO_WORKSPACE_ID,
                priority: project.priority,
                health: project.health,
                objective: project.objective,
                successCriteria: project.successCriteria,
                projectType: "Internal",
            },
            update: {
                ownerId,
                managerId,
                responsibleDepartmentId: DEMO_DEPARTMENT_ID,
                workspaceId: DEMO_WORKSPACE_ID,
            },
        });
    }

    for (const stage of DEMO_STAGES) {
        await prisma.projectStage.upsert({
            where: { id: stage.id },
            create: {
                id: stage.id,
                projectId: stage.projectId,
                name: stage.name,
                order: stage.order,
                color: stage.color,
                status: stage.status,
                startAt: stage.startAt,
                dueAt: stage.dueAt,
            },
            update: {},
        });
    }
}

type DemoTask = {
    key: string;
    title: string;
    description: string;
    status: "TODO" | "DOING" | "BLOCKED" | "WAITING" | "DONE" | "CANCELED";
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    projectId: string;
    stageId: string;
    assignees: { userId: string; plannedShare: number }[];
    dueInDays: number;
    progress?: number;
    estimateMinutes?: number;
};

const DEMO_TASKS: DemoTask[] = [
    {
        key: "DEMO-101",
        title: "Draft onboarding checklist template",
        description: "Synthetic task: produce the standard checklist used for all new joiners.",
        status: "TODO",
        priority: "MEDIUM",
        projectId: "demo-project-alpha",
        stageId: "demo-stage-alpha-2",
        assignees: [{ userId: "demo-user-riley", plannedShare: 1 }],
        dueInDays: 7,
        estimateMinutes: 240,
    },
    {
        key: "DEMO-102",
        title: "Interview stakeholders about current process",
        description: "Synthetic task: capture how onboarding works today before the revamp.",
        status: "DONE",
        priority: "HIGH",
        projectId: "demo-project-alpha",
        stageId: "demo-stage-alpha-1",
        assignees: [{ userId: "demo-user-riley", plannedShare: 1 }],
        dueInDays: -5,
        progress: 100,
        estimateMinutes: 180,
    },
    {
        key: "DEMO-103",
        title: "Map the approval workflow",
        description: "Synthetic task: draw the target-state approval flow for portal requests.",
        status: "DOING",
        priority: "HIGH",
        projectId: "demo-project-alpha",
        stageId: "demo-stage-alpha-2",
        assignees: [
            { userId: "demo-user-riley", plannedShare: 0.6 },
            { userId: "demo-user-jordan", plannedShare: 0.4 },
        ],
        dueInDays: 2,
        progress: 60,
        estimateMinutes: 300,
    },
    {
        key: "DEMO-104",
        title: "Resolve sample data export blocker",
        description: "Synthetic task: waiting on a sanitized sample dataset to continue testing.",
        status: "BLOCKED",
        priority: "URGENT",
        projectId: "demo-project-alpha",
        stageId: "demo-stage-alpha-2",
        assignees: [{ userId: "demo-user-jordan", plannedShare: 1 }],
        dueInDays: -1,
        progress: 30,
        estimateMinutes: 120,
    },
    {
        key: "DEMO-105",
        title: "Draft launch communications plan",
        description: "Synthetic task: outline announcements for the portal go-live.",
        status: "TODO",
        priority: "LOW",
        projectId: "demo-project-alpha",
        stageId: "demo-stage-alpha-3",
        assignees: [{ userId: MANAGER_USER_ID, plannedShare: 1 }],
        dueInDays: 14,
        estimateMinutes: 90,
    },
    {
        key: "DEMO-106",
        title: "Pilot the checklist with a test group",
        description: "Synthetic task: run the new onboarding path with a small pilot cohort.",
        status: "WAITING",
        priority: "MEDIUM",
        projectId: "demo-project-alpha",
        stageId: "demo-stage-alpha-3",
        assignees: [{ userId: "demo-user-riley", plannedShare: 1 }],
        dueInDays: 10,
        estimateMinutes: 150,
    },
    {
        key: "DEMO-201",
        title: "Automate the weekly status report",
        description: "Synthetic task: replace manual copy-paste assembly with a generated draft.",
        status: "DOING",
        priority: "URGENT",
        projectId: "demo-project-beta",
        stageId: "demo-stage-beta-2",
        assignees: [{ userId: MANAGER_USER_ID, plannedShare: 1 }],
        dueInDays: 0,
        progress: 45,
        estimateMinutes: 480,
    },
    {
        key: "DEMO-202",
        title: "Define report templates",
        description: "Synthetic task: agree the standard sections for the quarterly report.",
        status: "DONE",
        priority: "MEDIUM",
        projectId: "demo-project-beta",
        stageId: "demo-stage-beta-1",
        assignees: [{ userId: "demo-user-jordan", plannedShare: 1 }],
        dueInDays: -12,
        progress: 100,
        estimateMinutes: 240,
    },
    {
        key: "DEMO-203",
        title: "Set up data connectors",
        description: "Synthetic task: wire reporting sources into the automation pipeline.",
        status: "TODO",
        priority: "HIGH",
        projectId: "demo-project-beta",
        stageId: "demo-stage-beta-2",
        assignees: [{ userId: "demo-user-riley", plannedShare: 1 }],
        dueInDays: 5,
        estimateMinutes: 360,
    },
    {
        key: "DEMO-204",
        title: "QA checklist for report outputs",
        description: "Synthetic task: verify generated numbers against the source data.",
        status: "TODO",
        priority: "MEDIUM",
        projectId: "demo-project-beta",
        stageId: "demo-stage-beta-3",
        assignees: [{ userId: "demo-user-casey", plannedShare: 1 }],
        dueInDays: 21,
        estimateMinutes: 120,
    },
    {
        key: "DEMO-205",
        title: "Retire the legacy spreadsheet workflow",
        description: "Synthetic task: decommission the old manual reporting spreadsheet.",
        status: "CANCELED",
        priority: "LOW",
        projectId: "demo-project-beta",
        stageId: "demo-stage-beta-3",
        assignees: [{ userId: MANAGER_USER_ID, plannedShare: 1 }],
        dueInDays: 30,
    },
    {
        key: "DEMO-206",
        title: "Train the team on the new reporting flow",
        description: "Synthetic task: short walkthrough session for the automated flow.",
        status: "TODO",
        priority: "HIGH",
        projectId: "demo-project-beta",
        stageId: "demo-stage-beta-3",
        assignees: [{ userId: "demo-user-jordan", plannedShare: 1 }],
        dueInDays: 3,
        estimateMinutes: 60,
    },
];

async function seedTasks(createdById: string): Promise<void> {
    for (const task of DEMO_TASKS) {
        const done = task.status === "DONE";
        const dueAt = daysFromNow(task.dueInDays);
        const taskKey = task.key;
        const existing = await prisma.task.upsert({
            where: { taskKey },
            create: {
                id: `demo-task-${taskKey.slice(5).toLowerCase()}`,
                taskKey,
                title: task.title,
                description: task.description,
                status: task.status,
                priority: task.priority,
                projectId: task.projectId,
                stageId: task.stageId,
                workspaceId: DEMO_WORKSPACE_ID,
                createdById,
                startAt: daysFromNow(Math.min(-3, task.dueInDays - 7)),
                dueAt,
                estimateMinutes: task.estimateMinutes,
                progressMode: "manual",
                manualProgress: task.progress ?? (done ? 100 : null),
                doneAt: done ? daysFromNow(task.dueInDays) : null,
                actualHours: done ? Math.round(((task.estimateMinutes ?? 120) / 60) * 10) / 10 : null,
                effortHours: task.estimateMinutes ? task.estimateMinutes / 60 : null,
            },
            update: {},
        });

        const assignees = ["DEMO-101", "DEMO-201"].includes(task.key)
            ? [{ userId: createdById, plannedShare: 1 }]
            : task.assignees;
        for (const assignee of assignees) {
            await prisma.taskAssignment.upsert({
                where: {
                    taskId_userId: { taskId: existing.id, userId: assignee.userId },
                },
                create: {
                    taskId: existing.id,
                    userId: assignee.userId,
                    plannedShare: assignee.plannedShare,
                },
                update: { plannedShare: assignee.plannedShare },
            });
        }
    }

    // Keep the per-project task sequence consistent with the demo keys.
    for (const projectId of ["demo-project-alpha", "demo-project-beta"]) {
        const count = await prisma.task.count({ where: { projectId } });
        await prisma.project.update({ where: { id: projectId }, data: { taskSeq: count } });
    }
}

async function seedKpis(createdById: string): Promise<void> {
    const kpis = [
        {
            id: "demo-kpi-1",
            perspective: "Delivery",
            objective: "Deliver committed work predictably",
            name: "On-time task completion rate",
            definition: "Share of demo tasks finished on or before their due date.",
            formula: "Tasks done by due date / tasks due in period",
            unit: "Percentage (%)",
            weight: 0.3,
            annualTarget: 85,
            status: "ON_TRACK" as const,
        },
        {
            id: "demo-kpi-2",
            perspective: "Delivery",
            objective: "Shorten feedback loops",
            name: "Average task cycle time",
            definition: "Mean days from task start to done in the demo workspace.",
            formula: "Sum(days open) / tasks completed",
            unit: "Days (#)",
            weight: 0.2,
            annualTarget: 7,
            status: "AT_RISK" as const,
        },
        {
            id: "demo-kpi-3",
            perspective: "People",
            objective: "Keep workload sustainable",
            name: "Average team utilization",
            definition: "Assigned hours versus available capacity for the demo team.",
            formula: "Assigned hours / capacity hours",
            unit: "Percentage (%)",
            weight: 0.25,
            annualTarget: 75,
            status: "ON_TRACK" as const,
        },
        {
            id: "demo-kpi-4",
            perspective: "Quality",
            objective: "Maintain stakeholder confidence",
            name: "Stakeholder satisfaction (survey)",
            definition: "Synthetic survey score from demo stakeholders.",
            formula: "Average survey score",
            unit: "Score (1-5)",
            weight: 0.25,
            annualTarget: 4,
            status: "ON_TRACK" as const,
        },
    ];

    for (const kpi of kpis) {
        await prisma.kPI.upsert({
            where: { id: kpi.id },
            create: {
                id: kpi.id,
                perspective: kpi.perspective,
                objective: kpi.objective,
                name: kpi.name,
                definition: kpi.definition,
                formula: kpi.formula,
                metric: "KPI",
                unit: kpi.unit,
                weight: kpi.weight,
                annualTarget: kpi.annualTarget,
                calculationType: "Non-Accumulative",
                trackingPeriod: "ANNUAL",
                status: kpi.status,
                workspaceId: DEMO_WORKSPACE_ID,
                // Department-level: deliberately no ownerId.
            },
            update: { workspaceId: DEMO_WORKSPACE_ID },
        });
    }

    const updates = [
        {
            id: "demo-kpi-update-1",
            kpiId: "demo-kpi-1",
            quarter: "Q1",
            value: 78,
            score: 4,
            achievementPercent: 92,
            note: "Demo Q1 update: most tasks closed on time.",
        },
        {
            id: "demo-kpi-update-2",
            kpiId: "demo-kpi-2",
            quarter: "Q1",
            value: 9,
            score: 3,
            achievementPercent: 78,
            note: "Demo Q1 update: cycle time above target, at risk.",
        },
        {
            id: "demo-kpi-update-3",
            kpiId: "demo-kpi-3",
            quarter: "Q1",
            value: 71,
            score: 4,
            achievementPercent: 95,
            note: "Demo Q1 update: utilization slightly under target.",
        },
    ];

    for (const update of updates) {
        await prisma.kPIUpdate.upsert({
            where: { id: update.id },
            create: { ...update, createdById },
            update: {},
        });
    }
}

async function main(): Promise<void> {
    loadSetupEnvironment();
    const databaseUrl = assertDemoSafety();
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const owner = await findDemoOwner();
    const nonDemoCounts = await Promise.all([
        prisma.task.count({ where: { NOT: { id: { startsWith: "demo-" } } } }),
        prisma.project.count({ where: { NOT: { id: { startsWith: "demo-" } } } }),
        prisma.kPI.count({ where: { NOT: { id: { startsWith: "demo-" } } } }),
    ]);
    if (nonDemoCounts.some((count) => count > 0)) fail("The target contains non-demo work. Use a fresh isolated local installation.");
    const memberships = await prisma.workspaceMember.findMany({
        where: { userId: owner.id, active: true, workspace: { archivedAt: null } },
        select: { workspace: { select: { id: true, slug: true, name: true } } },
    });
    if (memberships.length > 1) fail("The owner has multiple workspaces. Use a fresh isolated installation for the demo.");
    if (memberships.length === 1) {
        DEMO_WORKSPACE_ID = memberships[0].workspace.id;
        DEMO_WORKSPACE_SLUG = memberships[0].workspace.slug;
        DEMO_WORKSPACE_NAME = memberships[0].workspace.name;
    }
    console.log(`[demo-seed] reusing existing first admin as demo owner: ${owner.email}`);

    await seedWorkspaceAndDepartment();
    await seedDemoUsers();

    // Scoped app visibility: without a membership the app resolves no workspace
    // (NO_WORKSPACE). Attach the existing admin to the demo workspace/department.
    await prisma.workspaceMember.upsert({
        where: {
            workspaceId_userId: { workspaceId: DEMO_WORKSPACE_ID, userId: owner.id },
        },
        create: {
            workspaceId: DEMO_WORKSPACE_ID,
            userId: owner.id,
            role: "OWNER",
            active: true,
        },
        update: { active: true },
    });
    await prisma.userDepartment.upsert({
        where: {
            userId_departmentId: { userId: owner.id, departmentId: DEMO_DEPARTMENT_ID },
        },
        create: { userId: owner.id, departmentId: DEMO_DEPARTMENT_ID },
        update: {},
    });

    const otherMemberships = await prisma.workspaceMember.count({
        where: { userId: owner.id, active: true, workspaceId: { not: DEMO_WORKSPACE_ID } },
    });
    if (otherMemberships > 0) {
        console.warn(
            "[demo-seed] note: the demo owner has other active workspace memberships; " +
                "the app will ask which workspace to open (supported selection flow).",
        );
    }

    await seedProjectsAndStages(owner.id, MANAGER_USER_ID);
    await seedTasks(owner.id);
    await seedKpis(owner.id);

    console.log("[demo-seed] done. Synthetic demo data is ready:");
    console.log(`  workspace:  ${DEMO_WORKSPACE_NAME} (slug: ${DEMO_WORKSPACE_SLUG})`);
    console.log(`  department: ${DEMO_DEPARTMENT_NAME}`);
    console.log(`  users:      ${DEMO_USERS.length} synthetic users (${DEMO_USERS.map((u) => u.email).join(", ")})`);
    console.log(`  projects:   2 with ${DEMO_STAGES.length} stages; tasks: ${DEMO_TASKS.length}; KPIs: 4`);
    console.log(
        "[demo-seed] demo-user passwords are random and were discarded (never logged). " +
            "Sign in as the existing admin to view the demo data.",
    );
}

main()
    .catch((error) => {
        console.error("[demo-seed] failed:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma?.$disconnect();
    });
