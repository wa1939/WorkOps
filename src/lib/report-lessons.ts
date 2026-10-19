/**
 * Pure helpers for the weekly-report learning loop.
 *
 * No Prisma, no GLM imports — so the prompt + normalization are cheaply
 * unit-checkable, mirroring the design of `executive-summary-prompt.ts`.
 * The runtime pieces (DB reads, the GLM call) live in the API routes that
 * import this module.
 */

export const STYLE_MEMO_KEY = "EXEC_STYLE_MEMO";
export const STYLE_MEMO_MAX_CHARS = 2200;
export const REPORT_HISTORY_EXAMPLE_KEY = "REPORT_STYLE_HISTORY_EXAMPLE";

export type ReportStyleExample = {
    content: string;
    date: string;
    sourceId: string;
    checksum: string;
    sourceUpdatedAt: string;
    provenance: "USER_PROVIDED" | "IMPORTED" | "GENERATED" | "SYSTEM";
};

type BootstrapMemoExample = string | { date: string; content: string };

interface LessonsInput {
    /** The current accumulated style memo, or null on the first submission. */
    currentMemo: string | null;
    /** The AI-generated draft that the manager started from. */
    aiSummary: string;
    /** The manager's edited final — what was actually submitted to management. */
    finalBody: string;
}

/**
 * Build the GLM prompt that distills DURABLE editorial lessons by comparing
 * the AI draft against the manager's submitted final, then merges them with
 * the existing memo. Deterministic and pure.
 */
export function buildLessonsPrompt(input: LessonsInput): string {
    return `أنت محرر خبير. مهمتك استخلاص "قواعد دائمة" يتبعها مدير الإدارة في تحديثه الأسبوعي، بمقارنة المسودة التي كتبها الذكاء الاصطناعي مع النسخة النهائية التي اعتمدها المدير وأرسلها فعليًا للقيادة.

استخرج نوعين من القواعد الدائمة القابلة لإعادة الاستخدام في الأسابيع القادمة:
1) قواعد الصياغة: بنية الجملة، أفعال البداية (تم/جارٍ/مع استمرار)، دمج المهام المترابطة، النبرة، الطول.
2) قواعد الانتقاء: أنواع الأعمال التي يُبقيها المدير في التحديث (مثل التنسيق مع جهات خارجية، الجوائز، أبحاث الزمالة)، وأنواع الأعمال التي يحذفها دائمًا (مثل المهام الصغيرة الداخلية، الأعداد والنِسَب)، وما يُدمج في سطر واحد مقابل ما يبقى سطرًا مستقلًا.

لا تستخرج أي معلومة خاصة بهذا الأسبوع تحديدًا (أسماء مهام، تواريخ، تفاصيل مشاريع بعينها) — فقط الأنماط المتكررة.

ادمج القواعد المستخلصة مع "الذاكرة الحالية" أدناه: احذف المكرر، واحذف أي قاعدة ناقضها التعديل الأحدث، وأبقِ القائمة موجزة.

أعِد **فقط** الذاكرة المحدثة: من 8 إلى 14 سطرًا نصيًا عاديًا، كل سطر قاعدة واحدة تبدأ بكلمة "صياغة:" أو "انتقاء:"، بدون ترقيم أو رموز أو ماركداون، وبحد أقصى 2000 حرف.

الذاكرة الحالية:
${input.currentMemo?.trim() || "لا يوجد"}

مسودة الذكاء الاصطناعي:
${input.aiSummary.trim()}

النسخة النهائية التي اعتمدها المدير:
${input.finalBody.trim()}

عقد الإخراج الملزم: اكتب عشر قواعد موجزة، ست قواعد تبدأ بـ صياغة: وأربع تبدأ بـ انتقاء:، دون ترقيم. لا تستخدم أي علامات اقتباس حتى حول أمثلة الأفعال أو علامات الترقيم. لا تنقل أسماء أو تواريخ أو مقتطفات من المصادر. استخدم تعبير الموضوع أو الأعمال لوصف الأنماط العامة بدل تسمية كيان مفرد. لا تجعل موضوعات التقارير التاريخية بنودًا إلزامية؛ طبّق قواعد الانتقاء فقط عند وجود أدلة حالية مصرح بها. لا يتجاوز السطر الواحد مئة وثمانين حرفًا.

اكتب الذاكرة المحدثة الآن:`;
}

/**
 * Bootstrap variant: no AI drafts exist yet — distill both rule groups from the
 * manager's actually-submitted finals alone. Same output contract as
 * buildLessonsPrompt so validateMemo applies unchanged. Pure.
 */
export function buildBootstrapMemoPrompt(finals: BootstrapMemoExample[], currentMemo: string | null): string {
    const joined = finals.map((entry) => {
        if (typeof entry === "string") return entry.trim();
        return `مثال تاريخي مؤرخ ${entry.date} (مرجع للأسلوب والانتقاء فقط، وليس إنجازًا حاليًا):\n${entry.content}`;
    }).join("\n---\n");
    return `أنت محرر خبير. أمامك آخر التحديثات الأسبوعية التي كتبها مدير الإدارة بنفسه وأرسلها فعليًا للقيادة العليا. استخلص منها "قواعد دائمة" تصف طريقته حتى يحاكيها الذكاء الاصطناعي في المسودات القادمة.

استخرج نوعين من القواعد الدائمة:
1) قواعد الصياغة: بنية الجملة، أفعال البداية (تم/جارٍ/مع استمرار/استكمال)، دمج المهام المترابطة في سطر واحد، بدء سطر المشروع المسمى باسمه متبوعًا بنقطتين، النبرة، الطول.
2) قواعد الانتقاء: أنواع الأعمال التي يذكرها دائمًا (مثل التنسيق مع الجهات واللجان، الجوائز، أبحاث الزمالة، جمع البيانات من الشركات التابعة)، ومستوى التفصيل الذي يقف عنده، وما يجمعه في سطر واحد مقابل ما يفرد له سطرًا.

لا تذكر أي معلومة خاصة بأسبوع بعينه (أسماء مهام، تواريخ، أسماء أشخاص) — فقط الأنماط المتكررة عبر التقارير. الأمثلة المؤرخة أدناه provenance/style فقط؛ لا تحول نصها إلى إنجاز حالي.

ادمج ما تستخلصه مع "الذاكرة الحالية" أدناه إن وجدت: احذف المكرر وأبقِ القائمة موجزة.

أعِد **فقط** الذاكرة المحدثة: من 8 إلى 14 سطرًا نصيًا عاديًا، كل سطر قاعدة واحدة تبدأ بكلمة "صياغة:" أو "انتقاء:"، بدون ترقيم أو رموز أو ماركداون، وبحد أقصى 2000 حرف.

الذاكرة الحالية:
${currentMemo?.trim() || "لا يوجد"}

التحديثات المرسلة فعليًا (الأحدث أولًا، للاستدلال على الأسلوب فقط):
${joined}

عقد الإخراج الملزم: اكتب عشر قواعد موجزة، ست قواعد تبدأ بـ صياغة: وأربع تبدأ بـ انتقاء:، دون ترقيم. لا تستخدم أي علامات اقتباس حتى حول أمثلة الأفعال أو علامات الترقيم. لا تنقل أسماء أو تواريخ أو مقتطفات من المصادر. استخدم تعبير الموضوع أو الأعمال لوصف الأنماط العامة بدل تسمية كيان مفرد. لا تجعل موضوعات التقارير التاريخية بنودًا إلزامية؛ طبّق قواعد الانتقاء فقط عند وجود أدلة حالية مصرح بها. لا يتجاوز السطر الواحد مئة وثمانين حرفًا.

اكتب الذاكرة المحدثة الآن:`;
}

/**
 * Normalize a raw GLM memo completion into clean lines: strip any list markers
 * the model added, drop blank lines, and hard-cap the total length. Reuses the
 * same leading-marker strip as `normalizeSummaryLines`.
 */
export function normalizeMemo(raw: string): string {
    const cleaned = raw
        .split(/\r?\n+/)
        .map((line) => line.replace(/^[\s\-*•\d.)]+/, "").trim())
        .filter((line) => line.length > 0)
        .join("\n");
    return cleaned.length > STYLE_MEMO_MAX_CHARS ? cleaned.slice(0, STYLE_MEMO_MAX_CHARS) : cleaned;
}

const memoSecretPatterns = [/```/, /(?:api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]/i, /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/, /https?:\/\//i];

/**
 * A style memo is intentionally free-form after its two structured prefixes;
 * it is not reduced to a small allowlist of canned rules. These guards reject
 * syntax that carries source facts instead: dates, quoted excerpts, and
 * explicit named-entity slots. The entity check is deliberately structural
 * rather than a guess at people's names. It cannot prove that an arbitrary
 * paraphrase or an unlabelled Arabic proper name is historical without the
 * original source text, so those cases remain an explicit residual risk.
 */
const memoSourceDatePatterns = [
    /(?:^|[^A-Za-z\u0600-\u06ff0-9٠-٩])[0-9٠-٩]{4}(?![A-Za-z\u0600-\u06ff0-9٠-٩])/,
    /(?:^|[^A-Za-z\u0600-\u06ff0-9٠-٩])[0-9٠-٩]{1,2}[/.][0-9٠-٩]{1,2}(?:[/.][0-9٠-٩]{2,4})?(?![A-Za-z\u0600-\u06ff0-9٠-٩])/,
    /(?:^|[^A-Za-z\u0600-\u06ff0-9٠-٩])[0-9٠-٩]{1,2}-[0-9٠-٩]{1,2}-[0-9٠-٩]{2,4}(?![A-Za-z\u0600-\u06ff0-9٠-٩])/,
    /(?:^|[^A-Za-z\u0600-\u06ff0-9٠-٩])[0-9٠-٩]{1,2}\s+(?:يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)\s+[0-9٠-٩]{2,4}(?![A-Za-z\u0600-\u06ff0-9٠-٩])/i,
    /(?:^|[^A-Za-z\u0600-\u06ff0-9٠-٩])[0-9٠-٩]{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+[0-9٠-٩]{2,4}(?![A-Za-z\u0600-\u06ff0-9٠-٩])/i,
];

const memoQuotedTextPatterns = [
    /"[^"]+"/,
    /“[^”]+”/,
    /‘[^’]+’/,
    /«[^»]+»/,
    /‹[^›]+›/,
    /「[^」]+」/,
    /『[^』]+』/,
    /'[^']+'/,
    /`[^`]+`/,
];

const memoArabicEntityPattern = /(?:^|[\s(،,:؛-])(?:مشروع|برنامج|مبادرة|منصة|شركة|فريق|لجنة|جائزة|جامعة|مؤسسة|مركز|حملة)\s+(?:باسم\s+)?([^\s،؛:,.!?()[\]]+)/gi;
const memoEnglishEntityPattern = /(?:^|[\s(:;,\-])(?:project|program|initiative|platform|company|team|committee|award|university|center|campaign)\s+([A-Za-z][A-Za-z0-9'-]*)/g;
const genericEntityComplements = new Set([
    "أو",
    "العمل", "المشروع", "المسار", "المهام", "الأعمال", "المبادرات", "البرامج", "التقارير", "الجهات", "اللجان", "الأبحاث", "الفريق", "المؤسسة", "المركز", "رئيسي", "رئيسية", "مشترك", "مشتركة", "مسمى", "متبوعا", "متبوعًا", "محدد", "محددة", "معين", "معينة", "مناسب", "مناسبة", "واضح", "واضحة", "اسم", "مسار", "عمل", "واحد", "واحدة", "المناسب", "المناسبة",
    "work", "project", "track", "tasks", "workstreams", "reports", "teams", "committees", "main", "shared", "named", "single", "delivery", "updates", "writing", "format", "content", "details", "activity", "streams",
]);

function hasNamedEntitySlot(value: string): boolean {
    let match: RegExpExecArray | null;
    memoArabicEntityPattern.lastIndex = 0;
    while ((match = memoArabicEntityPattern.exec(value)) !== null) {
        const complement = match[1]?.replace(/[.،؛,:!?()[\]]+$/, "");
        if (complement && !genericEntityComplements.has(complement)) return true;
    }
    memoArabicEntityPattern.lastIndex = 0;
    memoEnglishEntityPattern.lastIndex = 0;
    while ((match = memoEnglishEntityPattern.exec(value)) !== null) {
        const rawComplement = match[1]?.replace(/[.,:!?()[\]]+$/, "");
        const complement = rawComplement?.toLowerCase();
        if (rawComplement && /^[A-Z]/.test(rawComplement) && !genericEntityComplements.has(complement ?? "")) return true;
    }
    memoEnglishEntityPattern.lastIndex = 0;
    return false;
}

function containsSourceDerivedMemoFact(value: string): boolean {
    return memoSourceDatePatterns.some((pattern) => pattern.test(value))
        || memoQuotedTextPatterns.some((pattern) => pattern.test(value))
        || hasNamedEntitySlot(value);
}


/**
 * Bounded candidate normalization for a human-review proposal. A proposal may
 * be incomplete; it is never retrieved as active memory until `validateMemo`
 * succeeds after explicit approval.
 */
export function validateMemoCandidate(raw: string): string | null {
    if (typeof raw !== "string" || memoSecretPatterns.some((pattern) => pattern.test(raw))) return null;
    const normalized = normalizeMemo(raw);
    return normalized.length > 0 ? normalized : null;
}

/**
 * Enforce the provider contract before a generated lesson can become approved
 * memory. A normalized string is not authoritative until it has both allowed
 * rule groups, bounded lines, and no provider prose or secret-like material.
 */
export function validateMemo(raw: string): string | null {
    const normalized = validateMemoCandidate(raw);
    if (!normalized || normalized.length > STYLE_MEMO_MAX_CHARS) return null;
    const lines = normalized.split("\n");
    if (lines.length < 8 || lines.length > 14) return null;
    if (lines.some((line) => line.length > 320 || !/^(صياغة|انتقاء):\s*\S/.test(line))) return null;
    if (!lines.some((line) => line.startsWith("صياغة:")) || !lines.some((line) => line.startsWith("انتقاء:"))) return null;
    if (lines.some(containsSourceDerivedMemoFact)) return null;
    return normalized;
}
