import type { ProposedWorkflow } from "@/lib/sabah/workflows/schemas";

/** Stable, production-ID-free acceptance fixture for the approved EVP scenario. */
export const evpProjectFixture = {
    name: "قياس وتعزيز الصورة الذهنية للمؤسسة في السوق وتحسين عرض القيمة للموظفين (EVP)",
    responsibleAdministration: "الثقافة وتجربة الموظف",
    managerName: "Demo Manager",
    managerEmail: "manager@example.test",
    sponsorStatus: "APPROVED" as const,
    sponsorName: "Demo Manager",
    sponsorEmail: "manager@example.test",
    startAt: "2026-11-01T00:00:00.000Z",
    dueAt: "2027-04-30T23:59:59.999Z",
    objective: "تصميم وتأسيس منظومة مؤسسية لقياس وتطوير الصورة الذهنية للمؤسسة كجهة عمل وعرض القيمة للموظفين، وتنفيذ خط أساس وتحليل الفجوات وبناء خطة التحسين والمتابعة وإعادة القياس.",
    scope: "يشمل نطاق العمل قياس الوضع الراهن، تحديد الفجوات والأولويات، تصميم وتحسين عرض القيمة للموظفين، تنفيذ المبادرات، متابعة الأثر، والتصعيد وإعادة القياس.",
    successCriteria: "اعتماد خط الأساس، إغلاق الفجوات ذات الأولوية، ورفع نتائج إعادة القياس والتوصيات.",
    outputs: [
        "إطار قياس الصورة الذهنية للمؤسسة في السوق",
        "خط أساس ونتائج القياس الأولي",
        "تحليل الفجوات والأولويات",
        "تصميم عرض القيمة للموظفين (EVP)",
        "خطة مبادرات التحسين والتنفيذ",
        "لوحة متابعة المؤشرات والتقدم",
        "تقرير المتابعة وإعادة القياس والتوصيات",
    ],
    stages: [
        { id: "baseline", name: "القياس وخط الأساس", order: 0 },
        { id: "gaps", name: "تحليل الفجوات والأولويات", order: 1 },
        { id: "evp", name: "تصميم وتحسين عرض القيمة", order: 2 },
        { id: "delivery", name: "تنفيذ مبادرات التحسين", order: 3 },
        { id: "remeasure", name: "المتابعة وإعادة القياس", order: 4 },
    ],
    plan: [
        { id: "define-baseline", stageId: "baseline", title: "اعتماد إطار القياس وخط الأساس", kpi: "الصورة الذهنية للمؤسسة في السوق" },
        { id: "analyze-gaps", stageId: "gaps", title: "تحليل الفجوات وتحديد الأولويات", kpi: "فجوة الصورة الذهنية" },
        { id: "design-evp", stageId: "evp", title: "تصميم عرض القيمة للموظفين", kpi: "مؤشر عرض القيمة للموظفين" },
        { id: "deliver-improvements", stageId: "delivery", title: "تنفيذ مبادرات تحسين عرض القيمة", kpi: "نسبة تنفيذ مبادرات التحسين" },
        { id: "remeasure-results", stageId: "remeasure", title: "إعادة القياس ورفع التوصيات", kpi: "تحسن الصورة الذهنية وعرض القيمة" },
    ],
} as const;

export type EvpDirectory = {
    users: ReadonlyArray<{ id: string; email: string; name: string }>;
    departments: ReadonlyArray<{ id: string; name: string }>;
    kpis: ReadonlyArray<{ id: string; name: string }>;
};

export type ResolvedEvpIds = {
    responsibleDepartmentId: string;
    managerId: string;
    sponsorId: string;
    kpiIds: Record<string, string>;
};

/** Resolve the production-ID-free fixture through stable business identifiers. */
export function resolveEvpFixture(directory: EvpDirectory): ResolvedEvpIds {
    const findUser = (email: string, name: string) => {
        const user = directory.users.find((candidate) => candidate.email === email && candidate.name === name);
        if (!user) throw new Error(`EVP user resolution failed for ${email}`);
        return user.id;
    };
    const department = directory.departments.find((candidate) => candidate.name === evpProjectFixture.responsibleAdministration);
    if (!department) throw new Error(`EVP department resolution failed for ${evpProjectFixture.responsibleAdministration}`);
    const kpiIds = Object.fromEntries(evpProjectFixture.plan.map((item) => {
        const kpi = directory.kpis.find((candidate) => candidate.name === item.kpi);
        if (!kpi) throw new Error(`EVP KPI resolution failed for ${item.kpi}`);
        return [item.kpi, kpi.id];
    }));
    const managerId = findUser(evpProjectFixture.managerEmail, evpProjectFixture.managerName);
    const sponsorId = findUser(evpProjectFixture.sponsorEmail, evpProjectFixture.sponsorName);
    return { responsibleDepartmentId: department.id, managerId, sponsorId, kpiIds };
}

export function buildEvpWorkflow(ids: ResolvedEvpIds): ProposedWorkflow {
    const projectArgs = {
        name: evpProjectFixture.name,
        description: evpProjectFixture.scope,
        status: "Active",
        startAt: evpProjectFixture.startAt,
        dueAt: evpProjectFixture.dueAt,
        managerId: ids.managerId,
        responsibleDepartmentId: ids.responsibleDepartmentId,
        sponsorId: ids.sponsorId,
        sponsorStatus: evpProjectFixture.sponsorStatus,
        objective: evpProjectFixture.objective,
        scope: evpProjectFixture.scope,
        successCriteria: evpProjectFixture.successCriteria,
        projectType: "STRATEGIC",
        priority: "HIGH",
        health: "NOT_SET",
        memberIds: [],
        objectives: evpProjectFixture.plan.map((item, order) => ({
            statement: item.title,
            measure: item.kpi,
            target: "اعتماد وقياس الأثر",
            kpiId: ids.kpiIds[item.kpi],
            order,
        })),
        outputs: evpProjectFixture.outputs.map((title, order) => ({ title, description: title, order })),
        risks: [],
        stages: [],
        metadata: { methodology: "EVP", measurementCadence: "شهري" },
    };

    const steps: ProposedWorkflow["steps"] = [
        { clientStepId: "project-create", capability: "projects.create", args: projectArgs, dependsOn: [], confidence: 1, inferredFields: [], evidenceRefs: ["approved-evp-brief"] },
        { clientStepId: "stages-initialize", capability: "projects.initializeStages", args: { id: { from: "project-create", path: "id" }, stageNames: evpProjectFixture.stages.map((stage) => stage.name) }, dependsOn: ["project-create"], confidence: 1, inferredFields: [], evidenceRefs: ["approved-evp-brief"] },
        ...evpProjectFixture.plan.map((item) => ({
            clientStepId: `task-${item.id}`,
            capability: "tasks.create",
            args: { title: item.title, description: item.kpi, projectId: { from: "project-create", path: "id" }, stageId: { from: "stages-initialize", path: "stages", index: evpProjectFixture.stages.findIndex((stage) => stage.id === item.stageId) }, kpiId: ids.kpiIds[item.kpi], startAt: evpProjectFixture.startAt, dueAt: evpProjectFixture.dueAt },
            dependsOn: ["stages-initialize"], confidence: 1, inferredFields: [], evidenceRefs: ["approved-evp-brief"],
        })),
        ...evpProjectFixture.plan.map((item) => ({
            clientStepId: `kpi-link-${item.id}`,
            capability: "kpis.linkProjectObjective",
            args: { kpiId: ids.kpiIds[item.kpi], projectObjectiveId: { from: "project-create", path: "objectives", index: evpProjectFixture.plan.findIndex((candidate) => candidate.id === item.id) }, expectedUpdatedAt: "2026-11-01T00:00:00.000Z" },
            dependsOn: ["project-create"], confidence: 1, inferredFields: [], evidenceRefs: ["approved-evp-brief"],
        })),
    ];
    return { goal: evpProjectFixture.name, steps };
}
