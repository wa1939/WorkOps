import { prisma } from "@/lib/prisma";
import { callGLMText } from "@/lib/glm";
import { resolveOperationalAiTarget } from "./provider-resolution";

export const MIN_AI_EFFORT = 0.5;
export const MAX_AI_EFFORT = 40;

export interface EffortRow {
    id: string;
    title: string;
    description?: string | null;
    project?: string | null;
}

/** Pure prompt: numbered task list in, strict {"<id>": hours} JSON out. */
export function buildEffortPrompt(rows: EffortRow[]): string {
    const list = rows
        .map((r) => {
            let line = `- id: ${r.id} | ${r.title}`;
            if (r.project) line += ` (مشروع: ${r.project})`;
            if (r.description) line += ` — ${r.description.slice(0, 200)}`;
            return line;
        })
        .join("\n");
    return `أنت مدير عمليات خبير في إدارة "الثقافة وتجربة الموظف". قدّر ساعات العمل الفعلية التي تحتاجها كل مهمة أدناه لموظف واحد (اجتماعات، إعداد، مراجعات). أغلب المهام بين 1 و 8 ساعات؛ الدراسات والتقارير الكبيرة قد تصل 40 ساعة.

المهام:
${list}

أعد فقط كائن JSON واحد بلا أي نص آخر، مفاتيحه معرفات المهام وقيمه أرقام الساعات (بين ${MIN_AI_EFFORT} و ${MAX_AI_EFFORT}):
{"<id>": <hours>, ...}`;
}

/** Pure parser: tolerate code fences/preambles, keep valid ids, clamp, drop junk. */
export function parseEffortEstimates(raw: string, validIds: Set<string>): Map<string, number> {
    const out = new Map<string, number>();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return out;
    let obj: Record<string, unknown>;
    try {
        obj = JSON.parse(match[0]);
    } catch {
        return out;
    }
    for (const [id, value] of Object.entries(obj)) {
        if (!validIds.has(id)) continue;
        const num = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(num) || num <= 0) continue;
        out.set(id, Math.min(Math.max(num, MIN_AI_EFFORT), MAX_AI_EFFORT));
    }
    return out;
}

export interface EffortEstimateResult {
    candidates: number;
    estimated: number;
}

/**
 * Estimate open tasks that have neither a human nor a cached AI estimate.
 * ONE batched operational-AI call per run (<= limit tasks). Conditional writes
 * protect a manual estimate entered after task selection from being overwritten.
 */
export async function estimateMissingEfforts(limit = 40): Promise<EffortEstimateResult> {
    const tasks = await prisma.task.findMany({
        where: {
            status: { notIn: ["DONE", "CANCELED"] },
            effortHours: null,
            aiEffortHours: null,
        },
        select: { id: true, title: true, description: true, project: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: limit,
    });
    if (tasks.length === 0) return { candidates: 0, estimated: 0 };

    const rows: EffortRow[] = tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        project: t.project?.name ?? null,
    }));
    const target = await resolveOperationalAiTarget();
    const raw = await callGLMText(buildEffortPrompt(rows), {
        provider: target.provider,
        model: target.model,
        fallbacks: target.fallbacks,
        credentials: target.credentials,
        // Bound the entire provider/fallback chain, leaving time for the load
        // snapshots within the native schedule caller's 55-second deadline.
        signal: AbortSignal.timeout(30_000),
        temperature: 0.2,
        max_tokens: 1500,
        thinking: "disabled",
    });
    const estimates = parseEffortEstimates(raw, new Set(tasks.map((t) => t.id)));
    if (estimates.size === 0) return { candidates: tasks.length, estimated: 0 };

    const now = new Date();
    const writes = await prisma.$transaction(
        Array.from(estimates.entries()).map(([id, hours]) =>
            prisma.task.updateMany({
                // A user-entered manual value or another worker's cached value
                // wins if it appeared after the selection query.
                where: { id, effortHours: null, aiEffortHours: null },
                data: { aiEffortHours: hours, aiEffortAt: now },
            }),
        ),
    );
    const estimated = writes.reduce((count, write) => count + write.count, 0);
    return { candidates: tasks.length, estimated };
}
