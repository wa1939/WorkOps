import type { PlaybookDraftInput, PlaybookRecord } from "./contracts";
import { playbookChecksum } from "./contracts";

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
};
const make = (playbookId: string, name: string, en: string[], ar: string[], context: string[], capabilities: string[], approvals: string[], expected: string): PlaybookRecord => {
  const input: PlaybookDraftInput = { playbookId, version: 1, name, description: name, scope: "WORKSPACE", ownerId: "system", departmentId: null,
    triggers: { en, ar }, requiredContext: context, allowedCapabilities: capabilities, requiredApprovals: approvals,
    outputSchema: { type: "object", properties: { result: { type: "string" } } }, evaluationCases: [{ input: en[0], expected }] };
  const record = { id: `builtin-${playbookId}`, ...input, state: "APPROVED" as const, builtin: true,
    checksum: playbookChecksum(input), createdAt: new Date(0), updatedAt: new Date(0) };
  return deepFreeze(record);
};

export const BUILTIN_PLAYBOOKS: readonly PlaybookRecord[] = Object.freeze([
  make("strategic-project-launch", "Strategic project launch", ["launch a strategic project", "start strategic project"], ["إطلاق مشروع استراتيجي", "بدء مشروع استراتيجي"], ["objective", "sponsor", "success criteria"], ["projects.create", "tasks.create"], ["lead", "explicit-write"], "approved project plan"),
  make("weekly-report-preparation", "Weekly report preparation", ["prepare weekly report", "create weekly report"], ["إعداد التقرير الأسبوعي", "إنشاء التقرير الأسبوعي"], ["reporting period", "kpi data", "highlights"], ["kpis.search", "reports.generateDraft"], ["lead"], "weekly report"),
  make("meeting-minutes-to-actions", "Meeting minutes to actions", ["turn meeting minutes into actions", "extract meeting action items"], ["تحويل محضر الاجتماع إلى إجراءات", "استخراج إجراءات الاجتماع"], ["meeting minutes", "attendees", "due dates"], ["notes.get", "tasks.create"], ["lead", "explicit-write"], "action list"),
  make("kpi-recovery-plan", "KPI recovery plan", ["create a KPI recovery plan", "recover an underperforming KPI"], ["إنشاء خطة تعافي لمؤشر", "معالجة تراجع المؤشر"], ["kpi", "baseline", "target", "root cause"], ["kpis.get", "kpis.update", "tasks.create"], ["lead", "explicit-write"], "recovery plan"),
  make("leave-handover", "Leave handover", ["prepare leave handover", "handover before leave"], ["إعداد تسليم الإجازة", "التسليم قبل الإجازة"], ["leave dates", "open tasks", "handover owner"], ["leave.getMine", "tasks.read", "tasks.update"], ["lead", "explicit-write"], "handover checklist"),
]);
