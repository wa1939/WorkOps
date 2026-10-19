import { describe, it, expect } from "vitest";
import { buildExecutivePrompt, type SummaryContext } from "./executive-summary-prompt";

const baseCtx: SummaryContext = {
    done: [{ title: "مهمة منجزة" }],
    doing: [{ title: "مهمة جارية", updatedThisWeek: false }],
    overdue: [],
    upcoming: [{ title: "مهمة قادمة" }],
    kpiRisk: [],
};
const unsafeMemo = [
    "صياغة: يذكر إنجاز سارة في مشروع أطلس بتاريخ 2026-08-16.",
    "صياغة: يدمج الأعمال المترابطة.",
    "صياغة: يحافظ على نبرة رسمية.",
    "صياغة: يذكر الأثر باختصار.",
    "انتقاء: يركز على الأعمال الجوهرية.",
    "انتقاء: يجمع التفاصيل المتقاربة.",
    "انتقاء: يستبعد التفاصيل الداخلية الصغيرة.",
    "انتقاء: لا يعيد إنجازات الأسابيع السابقة.",
].join("\n");
const validStyleMemo = unsafeMemo.replace("صياغة: يذكر إنجاز سارة في مشروع أطلس بتاريخ 2026-08-16.", "صياغة: يذكر الأثر باختصار.");

describe("buildExecutivePrompt", () => {
    it("renders the static exemplar and no memo/last-week blocks with no extras (backward compat)", () => {
        const p = buildExecutivePrompt(baseCtx);
        expect(p).toContain("تم الانتهاء من تحليل تجربة المنتقلين"); // static exemplar present
        expect(p).not.toContain("توجيهات المدير المستخلصة");
        expect(p).not.toContain("تحديث الأسبوع الماضي كما أُرسل فعليًا");
    });

    it("uses only the approved abstract memo and never injects raw historical examples", () => {
        const p = buildExecutivePrompt(baseCtx, {
            styleMemo: validStyleMemo,
        });
        expect(p).toContain("توجيهات المدير المستخلصة");
        expect(p).toContain(validStyleMemo);
        expect(p).not.toContain("historical facts");
        expect(p).toContain("تم الانتهاء من تحليل تجربة المنتقلين");
    });

    it("does not embed an unsafe historical memo supplied by a direct caller", () => {
        const p = buildExecutivePrompt(baseCtx, { styleMemo: unsafeMemo });
        expect(p).not.toContain("سارة");
        expect(p).not.toContain("توجيهات المدير المستخلصة");
    });

    it("marks stale (no-activity) doing tasks", () => {
        const p = buildExecutivePrompt(baseCtx);
        expect(p).toContain("لم يستجد عليه شيء هذا الأسبوع");
    });
});
