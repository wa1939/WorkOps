import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export const maxDuration = 60;

async function generateWeeklyReport() {
    const now = new Date();
        const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const weekEnd = now;
        const nextWeekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        // Gather comprehensive data
        const completedTasks = await prisma.task.findMany({
            where: {
                status: "DONE",
                doneAt: { gte: weekStart, lte: weekEnd },
            },
            include: {
                project: true,
                caseStudy: true,
                assignments: { include: { user: true } },
                comments: { orderBy: { createdAt: "desc" }, take: 1 },
            },
            orderBy: { priority: "desc" },
        });

        const inProgressTasks = await prisma.task.findMany({
            where: {
                status: "DOING",
            },
            include: {
                project: true,
                caseStudy: true,
                assignments: { include: { user: true } },
                comments: { orderBy: { createdAt: "desc" }, take: 1 },
            },
            orderBy: { priority: "desc" },
        });

        const blockedTasks = await prisma.task.findMany({
            where: {
                status: { in: ["BLOCKED", "WAITING"] },
            },
            include: {
                project: true,
                assignments: { include: { user: true } },
            },
        });

        const overdueTasks = await prisma.task.findMany({
            where: {
                status: { notIn: ["DONE", "CANCELED"] },
                dueAt: { lt: now },
            },
            include: {
                project: true,
                assignments: { include: { user: true } },
            },
            orderBy: { dueAt: "asc" },
        });

        const upcomingTasks = await prisma.task.findMany({
            where: {
                status: { notIn: ["DONE", "CANCELED"] },
                dueAt: { gte: now, lte: nextWeekEnd },
            },
            include: {
                project: true,
                assignments: { include: { user: true } },
            },
            orderBy: { dueAt: "asc" },
        });

        // Project progress with detailed insights
        const projects = await prisma.project.findMany({
            where: { status: { not: "Done" } },
            include: {
                tasks: {
                    include: {
                        assignments: { include: { user: true } },
                    }
                },
                owner: true,
            },
        });

        const projectsWithProgress = projects.map(p => {
            const allTasks = p.tasks.filter(t => t.status !== "CANCELED");
            const total = allTasks.length;
            const done = allTasks.filter(t => t.status === "DONE").length;
            const inProgress = allTasks.filter(t => t.status === "DOING").length;
            const blocked = allTasks.filter(t => t.status === "BLOCKED" || t.status === "WAITING").length;
            const progress = total > 0 ? Math.round((done / total) * 100) : 0;

            const teamMembers = new Set(
                allTasks.flatMap(t => t.assignments.map(a => a.user.name))
            );

            return {
                name: p.name,
                progress,
                owner: p.owner?.name,
                total,
                done,
                inProgress,
                blocked,
                teamMembers: Array.from(teamMembers),
            };
        });

        const kpisAtRisk = await prisma.kPI.findMany({
            where: { status: { in: ["AT_RISK", "OFF_TRACK"] } },
            include: { owner: true },
        });

        const leaves = await prisma.leaveRequest.findMany({
            where: {
                OR: [
                    { startAt: { gte: weekStart, lte: nextWeekEnd } },
                    { endAt: { gte: weekStart, lte: nextWeekEnd } },
                ],
            },
            include: { user: true, delegate: true },
        });

        // Build MAXIMUM DETAIL report
        const formatDate = (d: Date) => d.toLocaleDateString("ar-SA", { day: "numeric", month: "long" });

        let reportBody = `# التقرير الأسبوعي
**الفترة:** ${formatDate(weekStart)} إلى ${formatDate(weekEnd)}

---

## 📊 الإنجازات المكتملة (${completedTasks.length})

`;

        // Group completed tasks by project
        const completedByProject = new Map<string, typeof completedTasks>();
        const completedNoProject: typeof completedTasks = [];

        completedTasks.forEach(task => {
            const projectName = task.project?.name || task.caseStudy?.name;
            if (projectName) {
                if (!completedByProject.has(projectName)) {
                    completedByProject.set(projectName, []);
                }
                completedByProject.get(projectName)!.push(task);
            } else {
                completedNoProject.push(task);
            }
        });

        // Display completed tasks by project
        completedByProject.forEach((tasks, projectName) => {
            reportBody += `### ${projectName}\n`;
            tasks.forEach(t => {
                const assignees = t.assignments.map(a => a.user.name).join("، ");
                const desc = t.description ? `\n  - ${t.description.substring(0, 150)}${t.description.length > 150 ? "..." : ""}` : "";
                const lastComment = t.comments[0]?.body ? `\n  - آخر تحديث: ${t.comments[0].body.substring(0, 100)}` : "";
                reportBody += `- ✅ **${t.title}**${assignees ? ` - ${assignees}` : ""}${desc}${lastComment}\n`;
            });
            reportBody += "\n";
        });

        if (completedNoProject.length > 0) {
            reportBody += `### مهام عامة\n`;
            completedNoProject.forEach(t => {
                const assignees = t.assignments.map(a => a.user.name).join("، ");
                const desc = t.description ? `\n  - ${t.description.substring(0, 150)}` : "";
                reportBody += `- ✅ **${t.title}**${assignees ? ` - ${assignees}` : ""}${desc}\n`;
            });
            reportBody += "\n";
        }

        if (completedTasks.length === 0) {
            reportBody += "لا توجد مهام مكتملة هذا الأسبوع\n\n";
        }

        reportBody += `---

## 🔄 المهام قيد التنفيذ (${inProgressTasks.length})

`;

        inProgressTasks.forEach(t => {
            const assignees = t.assignments.map(a => a.user.name).join("، ");
            const project = t.project?.name || t.caseStudy?.name;
            const desc = t.description ? `\n  - ${t.description.substring(0, 150)}` : "";
            const lastComment = t.comments[0]?.body ? `\n  - آخر تحديث: ${t.comments[0].body.substring(0, 100)}` : "";
            const dueInfo = t.dueAt ? `\n  - الموعد المستهدف: ${formatDate(t.dueAt)}` : "";

            reportBody += `- 🔄 **${t.title}**${project ? ` (${project})` : ""}${assignees ? `\n  - المسؤول: ${assignees}` : ""}${desc}${lastComment}${dueInfo}\n\n`;
        });

        if (inProgressTasks.length === 0) {
            reportBody += "لا توجد مهام قيد التنفيذ حالياً\n\n";
        }

        reportBody += `---

## ⚠️ يحتاج انتباه

### 🔴 مهام متأخرة (${overdueTasks.length})

`;

        overdueTasks.forEach(t => {
            const assignees = t.assignments.map(a => a.user.name).join("، ");
            const project = t.project?.name;
            const daysOverdue = Math.floor((now.getTime() - (t.dueAt?.getTime() || now.getTime())) / (1000 * 60 * 60 * 24));

            reportBody += `- ⚠️ **${t.title}**${project ? ` (${project})` : ""}\n  - متأخر ${daysOverdue} يوم${assignees ? `\n  - المسؤول: ${assignees}` : ""}\n`;
        });

        if (overdueTasks.length === 0) {
            reportBody += "✅ لا توجد مهام متأخرة\n";
        }

        reportBody += `\n### 🚫 مهام معلقة/محظورة (${blockedTasks.length})\n\n`;

        blockedTasks.forEach(t => {
            const assignees = t.assignments.map(a => a.user.name).join("، ");
            const project = t.project?.name;
            reportBody += `- 🚫 **${t.title}** (${t.status})${project ? ` - ${project}` : ""}${assignees ? `\n  - ${assignees}` : ""}\n`;
        });

        if (blockedTasks.length === 0) {
            reportBody += "لا توجد مهام معلقة\n";
        }

        reportBody += `\n### 📈 مؤشرات أداء تحتاج متابعة (${kpisAtRisk.length})\n\n`;

        kpisAtRisk.forEach(k => {
            reportBody += `- 📉 **${k.name}** (${k.status})${k.owner ? ` - ${k.owner.name}` : ""}\n`;
        });

        if (kpisAtRisk.length === 0) {
            reportBody += "✅ جميع المؤشرات في المسار الصحيح\n";
        }

        reportBody += `\n---

## 📁 تقدم المشاريع

`;

        if (projectsWithProgress.length > 0) {
            projectsWithProgress.forEach(p => {
                const statusBar = "█".repeat(Math.floor(p.progress / 10)) + "░".repeat(10 - Math.floor(p.progress / 10));
                reportBody += `### ${p.name}
- **التقدم:** ${statusBar} ${p.progress}%
- **المهام:** ${p.done} مكتملة / ${p.inProgress} قيد العمل / ${p.blocked} معلقة / ${p.total} إجمالي
- **المسؤول:** ${p.owner || "غير محدد"}
- **الفريق:** ${p.teamMembers.join("، ") || "غير محدد"}

`;
            });
        } else {
            reportBody += "لا توجد مشاريع نشطة\n\n";
        }

        reportBody += `---

## 📅 الأسبوع القادم

### المهام المستحقة (${upcomingTasks.length})

`;

        upcomingTasks.forEach(t => {
            const assignees = t.assignments.map(a => a.user.name).join("، ");
            const project = t.project?.name;
            const dueDate = t.dueAt ? formatDate(t.dueAt) : "";

            reportBody += `- 📌 **${t.title}**${project ? ` (${project})` : ""}\n  - الموعد: ${dueDate}${assignees ? `\n  - ${assignees}` : ""}\n`;
        });

        if (upcomingTasks.length === 0) {
            reportBody += "لا توجد مهام مستحقة الأسبوع القادم\n";
        }

        reportBody += `\n---

## 👥 ملاحظات الفريق

`;

        if (leaves.length > 0) {
            leaves.forEach(l => {
                const duration = Math.ceil((l.endAt.getTime() - l.startAt.getTime()) / (1000 * 60 * 60 * 24));
                reportBody += `- 🏝️ **${l.user.name}**: إجازة ${duration} يوم (${formatDate(l.startAt)} - ${formatDate(l.endAt)})${l.delegate ? `\n  - التفويض: ${l.delegate.name}` : ""}\n`;
            });
        } else {
            reportBody += "لا توجد إجازات مجدولة\n";
        }

        reportBody += `\n---

## 📊 إحصائيات الأسبوع

- **إجمالي المهام المكتملة:** ${completedTasks.length}
- **معدل الإنجاز:** ${completedTasks.length > 0 ? Math.round((completedTasks.length / (completedTasks.length + inProgressTasks.length + overdueTasks.length)) * 100) : 0}%
- **المهام النشطة:** ${inProgressTasks.length}
- **المهام المتأخرة:** ${overdueTasks.length}
- **المشاريع النشطة:** ${projectsWithProgress.length}
- **متوسط تقدم المشاريع:** ${projectsWithProgress.length > 0 ? Math.round(projectsWithProgress.reduce((sum, p) => sum + p.progress, 0) / projectsWithProgress.length) : 0}%

---

*تم إنشاء التقرير تلقائياً في ${new Date().toLocaleString("ar-SA")}*
`;

        // Save the report
        const report = await prisma.weeklyReport.create({
            data: {
                weekStart,
                weekEnd,
                title: `التقرير الأسبوعي - ${formatDate(weekStart)}`,
                body: reportBody,
            },
        });

        return {
            id: report.id,
            title: report.title,
            body: reportBody,
        };
}

export async function GET(request: Request) {
    try {
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const report = await generateWeeklyReport();
        return NextResponse.json({ success: true, report });
    } catch (error) {
        console.error("GET /api/cron/weekly-summary error:", error);
        return NextResponse.json({ error: "Failed to generate summary" }, { status: 500 });
    }
}

export async function POST() {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const report = await generateWeeklyReport();
        return NextResponse.json({ success: true, report });
    } catch (error) {
        console.error("POST /api/cron/weekly-summary error:", error);
        return NextResponse.json({ error: "Failed to generate summary" }, { status: 500 });
    }
}
