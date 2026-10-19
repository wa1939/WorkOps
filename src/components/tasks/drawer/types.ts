export interface DrawerUser {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
}

export interface DrawerAssignment {
    id: string;
    userId: string;
    user: DrawerUser | null;
}

export interface DrawerSubscriber {
    id: string;
    userId: string;
    user: DrawerUser;
}

export interface DrawerParent {
    id: string;
    taskKey: string | null;
    title: string;
}

export interface DrawerSubtask {
    id: string;
    taskKey: string | null;
    title: string;
    status: string;
    priority: string;
    siblingOrder: number;
    assignments: DrawerAssignment[];
}

export interface DrawerDependency {
    id: string;
    taskId: string;
    dependsOnId: string;
    dependsOn?: { id: string; taskKey: string | null; title: string; status: string };
    task?: { id: string; taskKey: string | null; title: string; status: string };
}

export interface DrawerAttachment {
    id: string;
    type: string;
    filename: string | null;
    url: string;
    createdAt: string;
}

export interface DrawerCustomField {
    id: string;
    key: string;
    label: string;
    type: string;
    config: unknown;
    order: number;
}

export interface DrawerCustomFieldValue {
    id: string;
    fieldId: string;
    taskId: string;
    value: unknown;
    field: DrawerCustomField;
}

export interface DrawerAuditLog {
    id: string;
    action: string;
    metaJson: string | null;
    createdAt: string;
    actor: DrawerUser | null;
}

export interface DrawerProjectMember {
    id: string;
    userId: string;
    user: DrawerUser;
}

export interface DrawerProject {
    id: string;
    name: string;
    members?: DrawerProjectMember[];
    customFields?: DrawerCustomField[];
}

export interface DrawerRecurringRule {
    id: string;
    taskId: string;
    freq: string;
    interval: number;
    byDay: number[] | null;
    byMonthDay: number | null;
    nthWeek: number | null;
    weekday: number | null;
    mode: string;
    targetStatus: string | null;
    active: boolean;
    lastRunAt: string | null;
    nextRunAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface TaskDrawerPayload {
    id: string;
    taskKey: string | null;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    progressMode: string;
    manualProgress: number | null;
    estimateMinutes: number | null;
    startAt: string | null;
    dueAt: string | null;
    dueAtEnd: string | null;
    updatedAt: string;
    parentTaskId: string | null;
    project: DrawerProject | null;
    recurringRule: DrawerRecurringRule | null;
    parents: DrawerParent[];
    assignments: DrawerAssignment[];
    subscribers: DrawerSubscriber[];
    subtasks: DrawerSubtask[];
    dependencies: DrawerDependency[];
    blockers: DrawerDependency[];
    attachments: DrawerAttachment[];
    customFieldValues: DrawerCustomFieldValue[];
    comments: Array<{ id: string; body: string; createdAt: string; author: DrawerUser | null }>;
    auditLogs: DrawerAuditLog[];
}

export type TaskDrawerPatch = Partial<Pick<
    TaskDrawerPayload,
    "title" | "status" | "priority" | "progressMode" | "manualProgress" | "estimateMinutes" | "startAt" | "dueAt" | "dueAtEnd" | "description"
>> & { assigneeIds?: string[] };
