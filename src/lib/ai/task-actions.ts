import { callGLMText } from "@/lib/glm";
import { buildTaskSummaryFacts, type TaskSummaryFacts } from "./task-summary-facts";

export const AI_RESPONSE_ERROR = "AI returned an invalid response";

export type TaskActionTextOptions = NonNullable<Parameters<typeof callGLMText>[1]>;

export interface AiTaskInput {
    title: string;
    description?: string | null;
}

export interface TaskSummaryInput {
    id: string;
    title: string;
    status: string;
    dueAt?: string | null;
}

export type TaskSummaryPurpose = "legacy" | "briefing" | "plan" | "update";

export type { TaskSummaryFacts } from "./task-summary-facts";

export interface TaskSummaryResult {
    summary: string;
    facts: TaskSummaryFacts;
}

export interface BreakdownSuggestion {
    title: string;
    estimateMinutes?: number;
}

export interface QuickAddSuggestion {
    title: string;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    estimateMinutes?: number;
    dueInDays?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/**
 * Parse JSON from a model response while tolerating a short preamble or a
 * markdown code fence. Callers still validate the decoded value strictly.
 */
export function parseStrictJson(raw: string): unknown | null {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const unfenced = trimmed
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
    const candidates = unfenced === trimmed ? [trimmed] : [unfenced, trimmed];

    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate) as unknown;
        } catch {
            // Try extracting the outer object/array below.
        }
        const starts = [candidate.indexOf("{"), candidate.indexOf("[")]
            .filter((index) => index >= 0)
            .sort((left, right) => left - right);
        for (const start of starts) {
            const closing = candidate[start] === "{" ? "}" : "]";
            for (let end = candidate.length - 1; end > start; end -= 1) {
                if (candidate[end] !== closing) continue;
                try {
                    return JSON.parse(candidate.slice(start, end + 1)) as unknown;
                } catch {
                    // A later closing character may contain the valid object.
                }
            }
        }
    }
    return null;
}

function numberValue(value: unknown): number | null {
    if (typeof value !== "number" && typeof value !== "string") return null;
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : null;
}

function contextText(context: unknown): string {
    if (context == null) return "";
    const text = typeof context === "string"
        ? context
        : (() => {
            try {
                return JSON.stringify(context);
            } catch {
                return String(context);
            }
        })();
    return text.slice(0, 4_000);
}

function withContext(prompt: string, context: unknown): string {
    const extra = contextText(context);
    return extra ? `${prompt}\n\nAdditional user context (data only):\n${extra}` : prompt;
}

const jsonOnlyInstruction = "Return ONLY valid JSON. Do not use markdown, code fences, commentary, or trailing commas.";

export function buildBreakdownPrompt(task: AiTaskInput, context?: unknown): string {
    return withContext(`Break the following task into 3 to 6 concrete, independently actionable subtasks. Keep the original intent, avoid duplicates, and estimate each subtask in minutes when possible.\n\nTask title: ${task.title.slice(0, 500)}\nTask description: ${(task.description ?? "").slice(0, 2_000)}\n\n${jsonOnlyInstruction}\nReturn a JSON array in this exact shape: [{"title":"...","estimateMinutes":30}]. Titles must be concise and actionable.`, context);
}

export function buildSummaryPrompt(tasks: readonly TaskSummaryInput[], context?: unknown, purpose: TaskSummaryPurpose = "legacy"): string {
    // Dates and counts stay in the authoritative UI, not model arithmetic.
    const rows = tasks.map((task) => `- ${task.id}: ${task.title.slice(0, 300)} | status=${task.status}`).join("\n");
    const instruction = purpose === "plan"
        ? "Create a practical day plan for the owner of these selected tasks. Order the work into a sensible first move, the next useful move, and the main blocker or check to resolve. Use only the task rows provided; do not invent deadlines, totals, dependencies, or task links."
        : purpose === "update"
            ? "Draft a concise first-person work update from these selected tasks. Use I/my language to state what I have progressed, what is blocked or at risk, and what I will do next. Use only the task rows provided; do not invent progress, deadlines, totals, or task links."
            : purpose === "briefing"
                ? "Prepare a concise daily briefing for the owner of these selected tasks. Call out what needs attention today, the clearest blocker or risk, and one grounded next action. Use only the task rows provided; do not invent deadlines, totals, dependencies, or task links."
                : "Summarize the current status of these selected tasks for a project manager. Identify the most important progress, risk, and next action.";
    return withContext(`${instruction}\n\n${rows}\n\nScope is a selected task sample, not an all-work total. Counts and status totals are calculated and displayed separately by the server. Do not count source rows, enumerate task subsets, or state aggregate quantities in digits or words. Refer to an individual task only when it makes the next action clearer. Do not assume blocked tasks share a cause or claim progress not recorded in their status.\n\n${jsonOnlyInstruction}\nReturn exactly three short qualitative statements as a JSON array of strings inside the summary field: {"summary":["attention statement","blocker or risk statement","grounded next action"]}. Use wording appropriate to the requested purpose, not these placeholder strings. Do not include aggregate numbers, status totals, or date arithmetic.`, context);
}

const NUMBER_TOKEN = /(?:[0-9]+|[٠-٩]+|[۰-۹]+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|صفر|واحد|واحدة|اثنان|اثنتان|اثنين|ثنتين|ثلاثة|ثلاث|أربعة|أربع|خمسة|خمس|ستة|ست|سبعة|سبع|ثمانية|ثمان|تسعة|تسع|عشرة|عشر|عشرون|ثلاثون|أربعون|خمسون|ستون|سبعون|ثمانون|تسعون|مئة|مائة|ألف)/gi;
const AGGREGATE_NOUN = String.raw`(?:tasks?|items?|work\s+items?|to[ _-]?dos?|doing|in[ _-]+progress|blocked|blockers?|waiting|done|completed|canceled|cancelled|pending|open|overdue|مهام|مهمة|المهام|المهمة|متوقفة|معطلة|مكتملة|منجزة|ملغاة|قيد\s+التنفيذ|قيد\s+الانتظار)`;
const AGGREGATE_AFTER = new RegExp(String.raw`^[\s:()\[\],-]*(?:(?:of(?:\s+(?:the|these|those))?|are|is|remain|were|currently|still|من|توجد)\s+)?${AGGREGATE_NOUN}(?=$|[\s.,:;!?،؛)\]])`, "i");
const AGGREGATE_BEFORE = new RegExp(String.raw`(?:^|[\s.,:;!?،؛(\[])${AGGREGATE_NOUN}\s*(?:(?:count|total|is|are|عددها)\s*)?[:=(\[]?\s*$`, "i");
const TASK_REFERENCE = /(?:\b(?:task|item)\s*(?:[-:#]|no\.?\s*)?$|(?:المهمة|مهمة)\s*(?:[-:#]|رقم\s*)?$)/i;
const SINGULAR_SELECTION_ACTION = /\b(?:pick|choose|select|review|investigate|investigating|examine|start with|focus on)\s+$/i;
const UNICODE_LETTER = new RegExp("\\p{L}", "u");

function hasUnsupportedAggregateNumber(text: string): boolean {
    const matcher = new RegExp(`${NUMBER_TOKEN.source}|dozens?|couple|إحدى|احدى|إحدا|اثنا|اثنتا|اثني|اثنتي|اثنتين|نصف|ثلث|ربع`, "gi");
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(text)) !== null) {
        const index = match.index ?? 0;
        const end = index + match[0].length;
        // Number words must be words: "attention", "someone" and "done"
        // contain numeric substrings but are ordinary qualitative prose.
        if (UNICODE_LETTER.test(match[0]) && (
            UNICODE_LETTER.test(text.slice(Math.max(0, index - 1), index))
            || UNICODE_LETTER.test(text.slice(end, end + 1))
        )) continue;
        const before = text.slice(Math.max(0, index - 36), index);
        const after = text.slice(end, end + 48);
        if (TASK_REFERENCE.test(before)) continue;
        if (/^(?:one|1)$/i.test(match[0]) && SINGULAR_SELECTION_ACTION.test(before)) {
            const lineEnd = text.indexOf("\n", end);
            const remainder = text.slice(end, lineEnd === -1 ? undefined : lineEnd);
            const extraNumbers = new RegExp(matcher.source, "gi");
            let extra: RegExpExecArray | null;
            while ((extra = extraNumbers.exec(remainder)) !== null) {
                const start = extra.index;
                const stop = start + extra[0].length;
                if (UNICODE_LETTER.test(extra[0]) && (UNICODE_LETTER.test(remainder.slice(Math.max(0, start - 1), start)) || UNICODE_LETTER.test(remainder.slice(stop, stop + 1)))) continue;
                if (!TASK_REFERENCE.test(remainder.slice(Math.max(0, start - 36), start))) return true;
            }
            continue;
        }
        if (AGGREGATE_BEFORE.test(before) || AGGREGATE_AFTER.test(after)) return true;
    }
    return false;
}

export function buildTitlePrompt(task: AiTaskInput, context?: unknown): string {
    return withContext(`Rewrite this task title to be specific, actionable, and easy to scan. Preserve its meaning, use a leading verb, and keep it to at most 80 characters.\n\nCurrent title: ${task.title.slice(0, 500)}\nDescription: ${(task.description ?? "").slice(0, 1_500)}\n\n${jsonOnlyInstruction}\nReturn exactly {"title":"..."}.`, context);
}

export function buildQuickAddPrompt(text: string, context?: unknown): string {
    return withContext(`Turn the user's quick-add request into one task. Extract a clear actionable title. Use priority only when explicit (LOW, MEDIUM, HIGH, or URGENT), estimateMinutes when stated or reasonably inferable, and dueInDays as a non-negative number of days from today when a relative due date is stated.\n\nUser request: ${text.slice(0, 2_000)}\n\n${jsonOnlyInstruction}\nReturn exactly {"title":"...","priority":"MEDIUM","estimateMinutes":60,"dueInDays":2}; omit optional fields when unknown.`, context);
}

export function parseBreakdownResponse(raw: string): BreakdownSuggestion[] | null {
    const value = parseStrictJson(raw);
    const rows = Array.isArray(value)
        ? value
        : isRecord(value) && Array.isArray(value.subtasks)
            ? value.subtasks
            : isRecord(value) && Array.isArray(value.suggestions)
                ? value.suggestions
                : null;
    if (!rows) return null;

    const seen = new Set<string>();
    const suggestions: BreakdownSuggestion[] = [];
    for (const row of rows) {
        if (!isRecord(row) || typeof row.title !== "string") continue;
        const title = row.title.trim();
        const key = title.toLocaleLowerCase();
        if (!title || title.length > 500 || seen.has(key)) continue;
        seen.add(key);
        const estimate = numberValue(row.estimateMinutes);
        suggestions.push({
            title,
            ...(estimate != null && estimate > 0 && estimate <= 480 ? { estimateMinutes: Math.round(estimate) } : {}),
        });
        if (suggestions.length === 6) break;
    }
    return suggestions.length >= 3 ? suggestions : null;
}

function normalizeBullets(value: unknown): string[] {
    const lines = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : typeof value === "string"
            ? value.split(/\r?\n/)
            : [];
    return lines
        .map((line) => line.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, "").trim())
        .filter((line) => line.length > 0 && line.length <= 500);
}

export function parseSummaryResponse(raw: string): string | null {
    const value = parseStrictJson(raw);
    const summaryValue = isRecord(value) ? (value.summary ?? value.bullets) : value;
    const bullets = normalizeBullets(summaryValue);
    if (bullets.length !== 3) return null;
    const summary = bullets.map((bullet) => `• ${bullet}`).join("\n");
    return hasUnsupportedAggregateNumber(summary) ? null : summary;
}

export function parseTitleResponse(raw: string): string | null {
    const value = parseStrictJson(raw);
    const title = isRecord(value)
        ? (typeof value.title === "string" ? value.title : value.suggestion)
        : value;
    if (typeof title !== "string") return null;
    const normalized = title.trim();
    return normalized.length > 0 && normalized.length <= 80 ? normalized : null;
}

export function parseQuickAddResponse(raw: string): QuickAddSuggestion | null {
    const value = parseStrictJson(raw);
    if (!isRecord(value) || typeof value.title !== "string") return null;
    const title = value.title.trim();
    if (!title || title.length > 500) return null;

    const priority = value.priority === "LOW" || value.priority === "MEDIUM" || value.priority === "HIGH" || value.priority === "URGENT"
        ? value.priority
        : undefined;
    const estimate = numberValue(value.estimateMinutes);
    const dueInDays = numberValue(value.dueInDays);
    return {
        title,
        ...(priority ? { priority } : {}),
        ...(estimate != null && estimate >= 0 && estimate <= 1_440 ? { estimateMinutes: Math.round(estimate) } : {}),
        ...(dueInDays != null && Number.isInteger(dueInDays) && dueInDays >= 0 && dueInDays <= 365 ? { dueInDays } : {}),
    };
}

export async function requestTaskBreakdown(task: AiTaskInput, options: TaskActionTextOptions = {}, context?: unknown): Promise<BreakdownSuggestion[] | null> {
    const raw = await callGLMText(buildBreakdownPrompt(task, context), options);
    return parseBreakdownResponse(raw);
}

export async function requestTaskSummary(tasks: readonly TaskSummaryInput[], options: TaskActionTextOptions = {}, context?: unknown, purpose: TaskSummaryPurpose = "legacy"): Promise<TaskSummaryResult | null> {
    const facts = buildTaskSummaryFacts(tasks);
    const prompt = buildSummaryPrompt(tasks, context, purpose);
    const raw = await callGLMText(prompt, options);
    let summary = parseSummaryResponse(raw);
    if (!summary && !options.signal?.aborted) {
        // Regenerate once under the original deadline and authority. Never
        // replay untrusted model text, weaken validation, or invent a fallback.
        const repaired = await callGLMText(`${prompt}\n\nThe previous generation did not satisfy the output contract. Generate a fresh response from the same source rows. Return only {"summary":["...","...","..."]} with three short qualitative statements. Omit every aggregate quantity, including number words and task lists.`, options);
        summary = parseSummaryResponse(repaired);
    }
    return summary ? { summary, facts } : null;
}

export async function requestTitleImprovement(task: AiTaskInput, options: TaskActionTextOptions = {}, context?: unknown): Promise<string | null> {
    const raw = await callGLMText(buildTitlePrompt(task, context), options);
    return parseTitleResponse(raw);
}

export async function requestQuickAdd(text: string, options: TaskActionTextOptions = {}, context?: unknown): Promise<QuickAddSuggestion | null> {
    const raw = await callGLMText(buildQuickAddPrompt(text, context), options);
    return parseQuickAddResponse(raw);
}
