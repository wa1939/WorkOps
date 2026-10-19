import { describe, it, expect } from "vitest";
import {
    buildLessonsPrompt,
    buildBootstrapMemoPrompt,
    normalizeMemo,
    validateMemo,
    STYLE_MEMO_MAX_CHARS,
    STYLE_MEMO_KEY,
} from "./report-lessons";

const validGenericMemo = [
    "صياغة: يبدأ السطر بفعل تنفيذي.",
    "صياغة: يدمج الأعمال المترابطة.",
    "صياغة: يحافظ على نبرة رسمية.",
    "صياغة: يذكر الأثر باختصار.",
    "انتقاء: يركز على الأعمال الجوهرية.",
    "انتقاء: يجمع التفاصيل المتقاربة.",
    "انتقاء: يستبعد التفاصيل الداخلية الصغيرة.",
    "انتقاء: لا يعيد إنجازات الأسابيع السابقة.",
].join("\n");

describe("buildLessonsPrompt (v2)", () => {
    const prompt = buildLessonsPrompt({
        currentMemo: "قاعدة قديمة",
        aiSummary: "مسودة الذكاء",
        finalBody: "النسخة النهائية",
    });
    it("asks for BOTH rule groups: style and selection", () => {
        expect(prompt).toContain("قواعد الصياغة");
        expect(prompt).toContain("قواعد الانتقاء");
        expect(prompt).toContain("صياغة:");
        expect(prompt).toContain("انتقاء:");
    });
    it("embeds memo, draft, and final", () => {
        expect(prompt).toContain("قاعدة قديمة");
        expect(prompt).toContain("مسودة الذكاء");
        expect(prompt).toContain("النسخة النهائية");
    });
    it("falls back to 'لا يوجد' with no memo", () => {
        expect(buildLessonsPrompt({ currentMemo: null, aiSummary: "a", finalBody: "b" })).toContain("لا يوجد");
    });
});

describe("buildBootstrapMemoPrompt", () => {
    it("joins finals with separators and requests both groups", () => {
        const p = buildBootstrapMemoPrompt(["تقرير أول", "تقرير ثاني"], null);
        expect(p).toContain("تقرير أول");
        expect(p).toContain("تقرير ثاني");
        expect(p).toContain("---");
        expect(p).toContain("قواعد الصياغة");
        expect(p).toContain("قواعد الانتقاء");
        expect(p).toContain("لا يوجد");
    });
    it("embeds an existing memo for merging", () => {
        expect(buildBootstrapMemoPrompt(["x"], "ذاكرة موجودة")).toContain("ذاكرة موجودة");
    });
});

describe("memo prompt acceptance contract", () => {
    it("tells both generators to avoid quoted examples and historical topic obligations", () => {
        for (const prompt of [buildBootstrapMemoPrompt(["تقرير تاريخي"], null), buildLessonsPrompt({ currentMemo: null, aiSummary: "draft", finalBody: "final" })]) {
            expect(prompt).toContain("لا تستخدم أي علامات اقتباس");
            expect(prompt).toContain("أدلة حالية مصرح بها");
            expect(prompt).toContain("عشر قواعد");
        }
    });
});

describe("normalizeMemo cap", () => {
    it("caps at STYLE_MEMO_MAX_CHARS = 2200", () => {
        expect(STYLE_MEMO_MAX_CHARS).toBe(2200);
        expect(normalizeMemo("م".repeat(3000)).length).toBe(2200);
    });
});

describe("normalizeMemo", () => {
    it("strips leading list markers (-, •, 1), *) and drops blank lines across a multi-line input", () => {
        const out = normalizeMemo("- rule one\n   \n1) rule two\n• rule three\n* rule four");
        expect(out).toBe("rule one\nrule two\nrule three\nrule four");
    });

    it("returns empty string for empty/whitespace-only input", () => {
        expect(normalizeMemo("")).toBe("");
        expect(normalizeMemo("   \n  \n")).toBe("");
    });
});

describe("validateMemo source-free rule contract", () => {
    it("rejects a syntactically valid memo containing a dated achievement", () => {
        const memo = validGenericMemo.replace("صياغة: يذكر الأثر باختصار.", "صياغة: يذكر إنجاز سارة في مشروع أطلس بتاريخ 2026-08-16.");
        expect(validateMemo(memo)).toBeNull();
    });

    it("rejects a memo containing a source-quoted fact", () => {
        const memo = validGenericMemo.replace("صياغة: يذكر الأثر باختصار.", "صياغة: يقتبس العبارة «تم إطلاق مشروع أطلس». ");
        expect(validateMemo(memo)).toBeNull();
    });

    it("rejects a named entity slot even when the source did not include a date", () => {
        const memo = validGenericMemo.replace("صياغة: يذكر الأثر باختصار.", "صياغة: يذكر إنجاز مبادرة أطلس.");
        expect(validateMemo(memo)).toBeNull();
    });

    it("accepts a generic entity alternative but still rejects a named alternative", () => {
        const generic = validGenericMemo.replace("صياغة: يذكر الأثر باختصار.", "صياغة: عند وجود مشروع أو مبادرة باسم محدد ابدأ السطر باسمه.");
        expect(validateMemo(generic)).toBe(generic);
        const named = validGenericMemo.replace("صياغة: يذكر الأثر باختصار.", "صياغة: عند وجود مشروع أو مبادرة أطلس ابدأ السطر باسمه.");
        expect(validateMemo(named)).toBeNull();
        expect(validateMemo(named.replace("مبادرة أطلس", "مبادرة باسم أطلس"))).toBeNull();
    });

    it("rejects a malformed rule prefix", () => {
        const memo = validGenericMemo.replace("صياغة:", "صياغة -");
        expect(validateMemo(memo)).toBeNull();
    });

    it("accepts broad generic writing and selection rules", () => {
        expect(validateMemo(validGenericMemo)).toBe(validGenericMemo);
        const genericEnglish = validGenericMemo.replace("صياغة: يذكر الأثر باختصار.", "صياغة: keeps project delivery concise.");
        expect(validateMemo(genericEnglish)).toBe(genericEnglish);
    });
});

describe("STYLE_MEMO_KEY", () => {
    it("is a stable config key", () => {
        expect(STYLE_MEMO_KEY).toBe("EXEC_STYLE_MEMO");
    });
});
