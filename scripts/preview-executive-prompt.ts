/**
 * No-API-cost gate on the executive-summary style rules. Builds the prompt from
 * a fixed sample context, prints it, and fails (exit 1) if any load-bearing
 * style instruction went missing. Run: `npx tsx scripts/preview-executive-prompt.ts`
 */
import { buildExecutivePrompt, type SummaryContext } from "../src/lib/executive-summary-prompt";

const ctx: SummaryContext = {
    done: [
        { title: "تحديث سجل القرارات لتكامل ثقة", project: "تكامل ثقة وعلم", detail: "تم الاعتماد" },
        { title: "دراسة ثقافة علم 2026", detail: "مقارنة وتحليل مفصل" },
        { title: "إرسال تقارير الاندماج التفصيلية", project: "مشروع الاندماج" },
    ],
    doing: [
        { title: "خطة الاندماج لعام 2026", project: "مشروع الاندماج" },
        { title: "تنظيم مكتبة الأبحاث", project: "برنامج الأبحاث" },
    ],
    overdue: [{ title: "كتيب الإدارة" }],
    upcoming: [
        { title: "مراجعة مشاريع الوحدة" },
        { title: "اعتماد محتويات مكتبة الأبحاث", project: "برنامج الأبحاث" },
    ],
    kpiRisk: ["مؤشر رضا الموظفين"],
};

const prompt = buildExecutivePrompt(ctx);
console.log(prompt);
console.log("\n----------------------------------------\n");

const required = ["من 6 إلى 9", "تمهيدًا", "الأسبوع القادم سيتم التركيز", "مكتبة الأبحاث"];
const missing = required.filter((r) => !prompt.includes(r));

if (missing.length > 0) {
    console.error("FAIL — missing style rules:", missing);
    process.exit(1);
}

console.log("OK — all style rules present in prompt.");
