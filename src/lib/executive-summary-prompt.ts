/**
 * Pure prompt construction for the GM-style weekly executive update.
 *
 * This file deliberately has NO runtime dependencies (no Prisma, no GLM) so the
 * style rules can be unit-checked cheaply (scripts/preview-executive-prompt.ts)
 * and so `buildExecutivePrompt` stays a pure function. `executive-summary.ts`
 * re-exports everything here and adds the data-gathering + GLM call.
 *
 * The style below is the department manager's own settled weekly-update voice,
 * distilled from his editing sessions: 6–9 formal Arabic sentences, workstreams
 * merged, no names, تم/جارٍ verbs, and a closing "next week" line.
 *
 * The optional `PromptExtras` feed the learning loop (plan 021): a style memo
 * distilled from the manager's past edits, his last few submitted finals used
 * as few-shot, and last week's actually-sent update so the model stops
 * repeating it verbatim.
 */

import { validateMemo } from "./report-lessons";

export interface SummaryItem {
    title: string;
    project?: string; // project or case-study name
    detail?: string; // description or latest comment, already truncated
    /** False when the task had no activity this week (so it isn't re-summarized as if new). */
    updatedThisWeek?: boolean;
}

export interface SummaryContext {
    done: SummaryItem[];
    doing: SummaryItem[];
    overdue: SummaryItem[];
    upcoming: SummaryItem[];
    kpiRisk: string[];
}

export interface PromptExtras {
    styleMemo?: string | null; // durable editing rules distilled from past edits
    /** Historical report bodies are intentionally not accepted as prompt input. */
}

/** One activity item per line: "title (project) - detail". Skips absent parts. */
function serialize(items: SummaryItem[]): string {
    if (items.length === 0) return "—";
    return items
        .map((i) => {
            let line = i.title.trim();
            if (i.project) line += ` (${i.project.trim()})`;
            if (i.detail) line += ` - ${i.detail.trim()}`;
            if (i.updatedThisWeek === false) line += ` [لم يستجد عليه شيء هذا الأسبوع]`;
            return line;
        })
        .join("\n");
}

/** Accepted outputs the manager has approved — used as few-shot, not copied. */
const STYLE_EXEMPLAR = [
    "تم الانتهاء من تحليل تجربة المنتقلين ورصد أبرز الملاحظات والفرص المرتبطة بتجربتهم، تمهيدًا لتحويل النتائج إلى إجراءات تحسين واضحة.",
    "برنامج الأبحاث: جارٍ تنظيم مكتبة الأبحاث من خلال مراجعة الملفات وإعادة تسميتها وتصنيفها حسب المجالات البحثية.",
    "مشروع الاندماج: تم إرسال تقارير الاندماج التفصيلية للإدارات المعنية وتنفيذ جلسة آلية قراءة التقارير، بالإضافة إلى إرسال دعوة استعراض التقرير التفصيلي بالموعد الجديد.",
    "الأسبوع القادم سيتم التركيز على مراجعة مشاريع الوحدة، وتطوير خطط سد الفجوات للمؤشرات المنخفضة، واعتماد محتويات مكتبة الأبحاث.",
].join("\n");

/**
 * Build the full GLM prompt from a gathered week context. Pure and
 * deterministic — the same (context, extras) always yields the same prompt.
 * `extras` is optional; omitting it reproduces the original static-exemplar
 * behavior so existing callers are unaffected.
 */
export function buildExecutivePrompt(ctx: SummaryContext, extras?: PromptExtras): string {
    const approvedStyleMemo = extras?.styleMemo ? validateMemo(extras.styleMemo) : null;
    const memoBlock = approvedStyleMemo
        ? `توجيهات المدير المستخلصة من تعديلاته السابقة (التزم بها حرفيًا):\n${approvedStyleMemo}\n\n`
        : "";

    return `أنت مساعد تنفيذي تكتب "التحديث الأسبوعي" لمدير إدارة ليشاركه مع القيادة العليا.

اللغة: إذا كانت أغلب المهام بالعربية فاكتب بالعربية الفصحى؛ وإلا فبالإنجليزية بنفس القواعد.

اكتب من 6 إلى 9 أسطر فقط.

قواعد إلزامية:
- كل سطر جملة واحدة مكتملة تنتهي بنقطة، بدون ترقيم أو رموز أو إيموجي أو تنسيق ماركداون.
- ابدأ الإنجازات المكتملة بـ"تم" أو "تمت"، والأعمال الجارية بـ"جارٍ"، والمستمرة بـ"مع استمرار" أو "استكمال".
- ادمج المهام المترابطة في سطر واحد لكل مسار عمل، ولا تكتب سطرًا لكل مهمة.
- إذا كان المسار مشروعًا مسمى فابدأ السطر باسمه متبوعًا بنقطتين، مثل: "مشروع الاندماج: تم …".
- أضف عند الإمكان عبارة أثر قصيرة مثل "بما يدعم…" أو "لضمان…" أو "تمهيدًا لـ…".
- لا تذكر أسماء الموظفين إطلاقًا، ولا أعداد المهام، ولا النسب المئوية.
- المهام الجارية المعلَّمة بـ[لم يستجد عليه شيء هذا الأسبوع] لا تُفرد لها أسطر؛ اجمعها كلها في سطر واحد على الأكثر يبدأ بـ"مع استمرار العمل على…"، أو أسقطها إذا سبق ذكرها في تحديث الأسبوع الماضي.
- اجعل السطر الأخير: "الأسبوع القادم سيتم التركيز على …" يلخص أهم محورين أو ثلاثة من المهام القادمة والمتأخرة المهمة.
- الأمثلة العامة أدناه مرجع للأسلوب فقط؛ لا تعتبر إنجازات حالية ولا تنسبها إلى هذا الأسبوع.

${memoBlock}أمثلة عامة على الأسلوب المطلوب (حاكِ الصياغة ولا تنسخها):
${STYLE_EXEMPLAR}

البيانات:
المنجز هذا الأسبوع:
${serialize(ctx.done)}
قيد التنفيذ:
${serialize(ctx.doing)}
متأخر:
${serialize(ctx.overdue)}
الأسبوع القادم:
${serialize(ctx.upcoming)}
مؤشرات تحتاج متابعة:
${ctx.kpiRisk.length ? ctx.kpiRisk.join("، ") : "—"}

اكتب التحديث الآن:`;
}

/**
 * Normalize a raw GLM completion into 3–9 clean sentence lines: strip any list
 * markers the model may have added, drop empties, cap at 9.
 */
export function normalizeSummaryLines(raw: string): string[] {
    return raw
        .split(/\r?\n+/)
        .map((line) => line.replace(/^[\s\-*•\d.)]+/, "").trim())
        .filter((line) => line.length > 0)
        .slice(0, 9);
}
