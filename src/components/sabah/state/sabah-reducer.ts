import type { WorkflowSnapshot } from "@/lib/sabah/workflows/schemas";
import type { FieldSuggestion, SabahFormSnapshot } from "../forms/contracts";
import type { DuplicateCandidate } from "@/lib/sabah/intelligence/contracts";
import type { ContextEvidence } from "../context/context-view";

export type SabahShellMode = "CLOSED" | "COMPACT" | "PANEL" | "FULLSCREEN";
export type SabahTab = "CHAT" | "PLAN" | "CONTEXT" | "ACTIVITY";

export const MIN_PANEL_WIDTH = 360;
export const MAX_PANEL_WIDTH = 760;
export const DEFAULT_PANEL_WIDTH = 420;

export type SabahMessage = { id: string; role: "user" | "assistant"; content: string; createdAt?: string; streamingStatus?: "STREAMING" | "FINISHED" | "FAILED" | "STOPPED" };

export type LiveToolActivity = { id: string; assistantMessageId: string; name: string; summary: string; status: "RUNNING" | "SUCCEEDED" | "FAILED" | "INTERRUPTED" };
export type SabahStreamNoticeKind = "LIMIT_ITERATIONS" | "LIMIT_TOOL_CALLS" | "LIMIT_CONTEXT" | "COMPRESSION_PENDING" | "COMPRESSION_UNAVAILABLE";
export type LiveStreamNotice = { id: string; assistantMessageId: string; kind: SabahStreamNoticeKind };

export type ActivityItem = {
    id: string;
    kind: "CHECKED" | "PROPOSED" | "APPROVED" | "CHANGED" | "VERIFIED" | "FAILED" | "UNDONE" | "WAITING";
    summary: string;
    correlationId: string;
    occurredAt: string;
};

/** Keep recovery bounded while retaining every recent action in the chat. */
export const MAX_WORKFLOW_SNAPSHOTS = 20;

export type SabahState = {
    shell: { mode: SabahShellMode; width: number; activeTab: SabahTab };
    conversationId: string | null;
    workflow: WorkflowSnapshot | null;
    /** Assistant turn that proposed the current action, if known live. */
    workflowMessageId: string | null;
    /** Actor/conversation-scoped workflow cards retained by their server ID. */
    workflowSnapshots: Record<string, WorkflowSnapshot>;
    workflowMessageIds: Record<string, string | null>;
    formContext: SabahFormSnapshot | null;
    contextIntelligence: { evidence: ContextEvidence[]; duplicates: DuplicateCandidate[]; workflowId: string | null; stepId: string | null };
    fieldSuggestions: Record<string, FieldSuggestion>;
    activity: ActivityItem[];
    unreadActivity: number;
    messages: SabahMessage[];
    streamingAssistantId: string | null;
    streamingAssistantBytes: number;
    liveToolActivity: LiveToolActivity[];
    streamNotices: LiveStreamNotice[];
};

export type SabahAction =
    | { type: "SHELL_RESIZED"; width: number }
    | { type: "SHELL_MODE_CHANGED"; mode: SabahShellMode; width?: number }
    | { type: "TAB_CHANGED"; tab: SabahTab }
    | { type: "WORKFLOW_SNAPSHOT"; workflow: WorkflowSnapshot | null; assistantMessageId?: string | null; select?: boolean }
    | { type: "WORKFLOW_SELECTED"; workflowId: string }
    | { type: "FIELD_SUGGESTED"; suggestion: FieldSuggestion }
    | { type: "FIELD_SUGGESTION_RESOLVED"; fieldName: string; status: "APPLIED" | "REJECTED" }
    | { type: "ACTIVITY_APPENDED"; item: ActivityItem }
    | { type: "CONVERSATION_SWITCHED"; conversationId: string | null }
    | { type: "CONVERSATION_LOADED"; conversationId: string; messages: SabahMessage[] }
    | { type: "MESSAGES_APPENDED"; messages: SabahMessage[] }
    | { type: "MESSAGES_REPLACED"; messages: SabahMessage[] }
    | { type: "FORM_CONTEXT_REGISTERED"; formContext: SabahFormSnapshot }
    | { type: "FORM_CONTEXT_UNREGISTERED"; formId: string }
    | { type: "CONTEXT_INTELLIGENCE_SET"; evidence: ContextEvidence[]; duplicates: DuplicateCandidate[]; workflowId: string | null; stepId: string | null }
    | { type: "ASSISTANT_STREAM_STARTED"; messageId: string }
    | { type: "ASSISTANT_TOKEN_APPENDED"; messageId: string; token: string }
    | { type: "ASSISTANT_STREAM_FINISHED"; messageId: string }
    | { type: "ASSISTANT_STREAM_FAILED"; messageId: string }
    | { type: "ASSISTANT_STREAM_STOPPED"; messageId: string }
    | { type: "TOOL_STARTED"; assistantMessageId: string; toolId: string; name: string; summary?: string }
    | { type: "TOOL_RESULT"; assistantMessageId: string; toolId: string; status: "SUCCEEDED" | "FAILED"; summary?: string }
    | { type: "STREAM_NOTICE_ADDED"; assistantMessageId: string; kind: SabahStreamNoticeKind };

const STORAGE_KEY = "sabah.shell";
const MAX_STREAM_TEXT = 64 * 1024;
const MAX_LIVE_TOOLS = 20;
const MAX_STREAM_NOTICES = 20;
const MAX_TOOL_NAME = 128;
const MAX_TOOL_SUMMARY = 512;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const utf8Encoder = new TextEncoder();

function validId(value: unknown): value is string {
    return typeof value === "string" && SAFE_ID.test(value);
}

function isWellFormedUtf16(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (next < 0xdc00 || next > 0xdfff) return false;
            index += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            return false;
        }
    }
    return true;
}

function utf8Prefix(value: string, maxBytes: number): string {
    let result = "";
    let bytes = 0;
    for (const character of value) {
        const characterBytes = utf8Encoder.encode(character).byteLength;
        if (bytes + characterBytes > maxBytes) break;
        result += character;
        bytes += characterBytes;
    }
    return result;
}

function boundedToolString(value: unknown, fallback: string, maxBytes: number): string {
    return typeof value === "string" && value.trim().length > 0 ? utf8Prefix(value, maxBytes) : fallback;
}

function clampWidth(width: number): number {
    return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(width)));
}

function loadPersistedShell(): { width: number; activeTab: SabahTab } {
    if (typeof window === "undefined") {
        return { width: DEFAULT_PANEL_WIDTH, activeTab: "CHAT" };
    }
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return { width: DEFAULT_PANEL_WIDTH, activeTab: "CHAT" };
        }
        const parsed = JSON.parse(raw) as { width?: unknown; activeTab?: unknown };
        return {
            width: typeof parsed.width === "number" ? clampWidth(parsed.width) : DEFAULT_PANEL_WIDTH,
            activeTab: parsed.activeTab === "CONTEXT" || parsed.activeTab === "ACTIVITY" ? parsed.activeTab : "CHAT",
        };
    } catch {
        return { width: DEFAULT_PANEL_WIDTH, activeTab: "CHAT" };
    }
}

export function createInitialSabahState(): SabahState {
    const persisted = loadPersistedShell();
    return {
        shell: { mode: "CLOSED", width: persisted.width, activeTab: persisted.activeTab },
        conversationId: null,
        workflow: null,
        workflowMessageId: null,
        workflowSnapshots: {},
        workflowMessageIds: {},
        formContext: null,
        contextIntelligence: { evidence: [], duplicates: [], workflowId: null, stepId: null },
        fieldSuggestions: {},
        activity: [],
        unreadActivity: 0,
        messages: [],
        streamingAssistantId: null,
        streamingAssistantBytes: 0,
        liveToolActivity: [],
        streamNotices: [],
    };
}

function persistShell(state: SabahState): void {
    if (typeof window === "undefined") {
        return;
    }
    try {
        // Only shell width and active tab are ever persisted — never form values or messages.
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ width: state.shell.width, activeTab: state.shell.activeTab }));
    } catch {
        // localStorage unavailable (private mode/quota) — persistence is best-effort.
    }
}

// The committed WorkflowSnapshot carries no events array (events are fetched
// separately via the activity stream), so snapshots replace wholesale and
// in-place identity is preserved by returning the same object when the
// snapshot is byte-identical (prevents redundant re-renders).
function sameSnapshot(a: WorkflowSnapshot | null, b: WorkflowSnapshot | null): boolean {
    return a === b || (a != null && b != null && JSON.stringify(a) === JSON.stringify(b));
}

function retainWorkflowSnapshots(
    snapshots: Record<string, WorkflowSnapshot>,
    messageIds: Record<string, string | null>,
    selectedId: string | null,
): { snapshots: Record<string, WorkflowSnapshot>; messageIds: Record<string, string | null> } {
    const orderedIds = Object.entries(snapshots)
        .sort(([, left], [, right]) => {
            const leftTime = Date.parse(left.updatedAt);
            const rightTime = Date.parse(right.updatedAt);
            if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return rightTime - leftTime;
            return 0;
        })
        .map(([id]) => id);
    const retainedIds = orderedIds.slice(0, MAX_WORKFLOW_SNAPSHOTS);
    if (selectedId && snapshots[selectedId] && !retainedIds.includes(selectedId)) {
        retainedIds[retainedIds.length - 1] = selectedId;
    }
    const nextSnapshots: Record<string, WorkflowSnapshot> = {};
    const nextMessageIds: Record<string, string | null> = {};
    for (const id of retainedIds) {
        const snapshot = snapshots[id];
        if (!snapshot) continue;
        nextSnapshots[id] = snapshot;
        nextMessageIds[id] = messageIds[id] ?? null;
    }
    return { snapshots: nextSnapshots, messageIds: nextMessageIds };
}

function sameWorkflowMaps(
    leftSnapshots: Record<string, WorkflowSnapshot>,
    leftMessageIds: Record<string, string | null>,
    rightSnapshots: Record<string, WorkflowSnapshot>,
    rightMessageIds: Record<string, string | null>,
): boolean {
    const leftIds = Object.keys(leftSnapshots);
    const rightIds = Object.keys(rightSnapshots);
    if (leftIds.length !== rightIds.length) return false;
    return leftIds.every((id) => id in rightSnapshots && sameSnapshot(leftSnapshots[id], rightSnapshots[id]) && leftMessageIds[id] === rightMessageIds[id]);
}

export function sabahReducer(state: SabahState, action: SabahAction): SabahState {
    switch (action.type) {
        case "SHELL_RESIZED": {
            const next: SabahState = { ...state, shell: { ...state.shell, width: clampWidth(action.width) } };
            persistShell(next);
            return next;
        }
        case "SHELL_MODE_CHANGED": {
            const shell = { ...state.shell, mode: action.mode };
            if (typeof action.width === "number") {
                shell.width = clampWidth(action.width);
            }
            const next: SabahState = { ...state, shell };
            persistShell(next);
            return next;
        }
        case "TAB_CHANGED": {
            const tab = action.tab === "PLAN" ? "CHAT" : action.tab;
            const next: SabahState = {
                ...state,
                shell: { ...state.shell, activeTab: tab },
                unreadActivity: tab === "ACTIVITY" ? 0 : state.unreadActivity,
            };
            persistShell(next);
            return next;
        }
        case "WORKFLOW_SNAPSHOT": {
            if (action.workflow === null) {
                if (state.workflow === null && state.workflowMessageId === null && Object.keys(state.workflowSnapshots).length === 0) return state;
                return { ...state, workflow: null, workflowMessageId: null, workflowSnapshots: {}, workflowMessageIds: {} };
            }

            const workflowId = action.workflow.id;
            const previousMessageId = state.workflowMessageIds[workflowId] ?? (state.workflow?.id === workflowId ? state.workflowMessageId : null);
            const workflowMessageId = action.assistantMessageId === undefined
                ? previousMessageId
                : action.assistantMessageId === null || validId(action.assistantMessageId)
                    ? action.assistantMessageId
                    : previousMessageId;
            const snapshots = { ...state.workflowSnapshots, [workflowId]: action.workflow };
            const messageIds = { ...state.workflowMessageIds, [workflowId]: workflowMessageId };
            const select = action.select !== false;
            const selectedWorkflow = select || state.workflow?.id === workflowId ? action.workflow : state.workflow;
            const selectedMessageId = select || state.workflow?.id === workflowId ? workflowMessageId : state.workflowMessageId;
            const retained = retainWorkflowSnapshots(snapshots, messageIds, selectedWorkflow?.id ?? null);
            if (sameSnapshot(state.workflow, selectedWorkflow) && selectedMessageId === state.workflowMessageId && sameWorkflowMaps(state.workflowSnapshots, state.workflowMessageIds, retained.snapshots, retained.messageIds)) {
                return state;
            }
            return { ...state, workflow: selectedWorkflow, workflowMessageId: selectedMessageId, workflowSnapshots: retained.snapshots, workflowMessageIds: retained.messageIds };
        }
        case "WORKFLOW_SELECTED": {
            const selectedWorkflow = state.workflowSnapshots[action.workflowId];
            if (!selectedWorkflow) return state;
            const workflowMessageId = state.workflowMessageIds[action.workflowId] ?? null;
            if (state.workflow?.id === action.workflowId && state.workflowMessageId === workflowMessageId) return state;
            return { ...state, workflow: selectedWorkflow, workflowMessageId };
        }
        case "FIELD_SUGGESTED": {
            // NEVER mutate formContext field values — suggestions are stored separately
            // and flagged CONFLICT when the live value has drifted from the base.
            const current = state.formContext?.fields[action.suggestion.fieldName]?.value;
            const drifted = state.formContext != null && current !== undefined && current !== action.suggestion.base;
            const suggestion: FieldSuggestion = { ...action.suggestion, status: drifted ? "CONFLICT" : action.suggestion.status };
            return { ...state, fieldSuggestions: { ...state.fieldSuggestions, [action.suggestion.fieldName]: suggestion } };
        }
        case "FIELD_SUGGESTION_RESOLVED": {
            if (!(action.fieldName in state.fieldSuggestions)) {
                return state;
            }
            const next = { ...state.fieldSuggestions };
            delete next[action.fieldName];
            return { ...state, fieldSuggestions: next };
        }
        case "ACTIVITY_APPENDED": {
            if (state.activity.some((a) => a.id === action.item.id)) {
                return state;
            }
            return {
                ...state,
                activity: [...state.activity, action.item],
                unreadActivity: state.shell.activeTab === "ACTIVITY" ? 0 : state.unreadActivity + 1,
            };
        }
        case "CONVERSATION_SWITCHED": {
            if (state.conversationId === action.conversationId) return state;
            return { ...state, conversationId: action.conversationId, workflow: null, workflowMessageId: null, workflowSnapshots: {}, workflowMessageIds: {} };
        }
        case "CONVERSATION_LOADED": {
            const sameConversation = state.conversationId === action.conversationId;
            return {
                ...state,
                conversationId: action.conversationId,
                workflow: sameConversation ? state.workflow : null,
                workflowMessageId: sameConversation ? state.workflowMessageId : null,
                workflowSnapshots: sameConversation ? state.workflowSnapshots : {},
                workflowMessageIds: sameConversation ? state.workflowMessageIds : {},
                messages: action.messages,
                streamingAssistantId: null,
                streamingAssistantBytes: 0,
                liveToolActivity: [],
                streamNotices: [],
            };
        }
        case "MESSAGES_APPENDED": {
            return { ...state, messages: [...state.messages, ...action.messages] };
        }
        case "MESSAGES_REPLACED": {
            return { ...state, messages: action.messages, streamingAssistantId: null, streamingAssistantBytes: 0, liveToolActivity: [], streamNotices: [] };
        }
        case "FORM_CONTEXT_REGISTERED": {
            return { ...state, formContext: action.formContext, fieldSuggestions: {} };
        }
        case "FORM_CONTEXT_UNREGISTERED": {
            if (state.formContext?.formId !== action.formId) {
                return state;
            }
            return { ...state, formContext: null, fieldSuggestions: {} };
        }
        case "CONTEXT_INTELLIGENCE_SET": {
            return { ...state, contextIntelligence: { evidence: action.evidence.slice(0, 20), duplicates: action.duplicates.slice(0, 20), workflowId: action.workflowId, stepId: action.stepId } };
        }
        case "ASSISTANT_STREAM_STARTED": {
            if (!validId(action.messageId) || state.streamingAssistantId !== null || state.messages.some((message) => message.id === action.messageId)) return state;
            return { ...state, streamingAssistantId: action.messageId, streamingAssistantBytes: 0, messages: [...state.messages, { id: action.messageId, role: "assistant", content: "", streamingStatus: "STREAMING" }] };
        }
        case "ASSISTANT_TOKEN_APPENDED": {
            if (!validId(action.messageId) || typeof action.token !== "string" || !isWellFormedUtf16(action.token) || state.streamingAssistantId !== action.messageId) return state;
            const tokenBytes = utf8Encoder.encode(action.token).byteLength;
            const remaining = MAX_STREAM_TEXT - state.streamingAssistantBytes;
            if (remaining <= 0) return state;
            const accepted = tokenBytes <= remaining ? action.token : utf8Prefix(action.token, remaining);
            const acceptedBytes = utf8Encoder.encode(accepted).byteLength;
            return { ...state, streamingAssistantBytes: state.streamingAssistantBytes + acceptedBytes, messages: state.messages.map((message) => message.id === action.messageId && message.role === "assistant" ? { ...message, content: message.content + accepted } : message) };
        }
        case "ASSISTANT_STREAM_FINISHED":
        case "ASSISTANT_STREAM_FAILED":
        case "ASSISTANT_STREAM_STOPPED": {
            if (!validId(action.messageId) || state.streamingAssistantId !== action.messageId) return state;
            const streamingStatus = action.type === "ASSISTANT_STREAM_FINISHED" ? "FINISHED" : action.type === "ASSISTANT_STREAM_STOPPED" ? "STOPPED" : "FAILED";
            const liveToolActivity = action.type === "ASSISTANT_STREAM_STOPPED" || action.type === "ASSISTANT_STREAM_FAILED"
                ? state.liveToolActivity.map((tool) => tool.assistantMessageId === action.messageId && tool.status === "RUNNING" ? { ...tool, status: "INTERRUPTED" as const } : tool)
                : state.liveToolActivity;
            return { ...state, streamingAssistantId: null, streamingAssistantBytes: 0, liveToolActivity, messages: state.messages.map((message) => message.id === action.messageId ? { ...message, streamingStatus } : message) };
        }
        case "TOOL_STARTED": {
            if (!validId(action.assistantMessageId) || !validId(action.toolId) || state.streamingAssistantId !== action.assistantMessageId) return state;
            const activity: LiveToolActivity = { id: action.toolId, assistantMessageId: state.streamingAssistantId, name: boundedToolString(action.name, "Unnamed tool", MAX_TOOL_NAME), summary: boundedToolString(action.summary, "No details", MAX_TOOL_SUMMARY), status: "RUNNING" };
            const existing = state.liveToolActivity.findIndex((tool) => tool.assistantMessageId === action.assistantMessageId && tool.id === action.toolId);
            if (existing >= 0) return { ...state, liveToolActivity: state.liveToolActivity.map((tool, index) => index === existing ? activity : tool) };
            return { ...state, liveToolActivity: [...state.liveToolActivity, activity].slice(-MAX_LIVE_TOOLS) };
        }
        case "TOOL_RESULT": {
            if (!validId(action.assistantMessageId) || !validId(action.toolId) || state.streamingAssistantId !== action.assistantMessageId || (action.status !== "SUCCEEDED" && action.status !== "FAILED")) return state;
            const existing = state.liveToolActivity.findIndex((tool) => tool.assistantMessageId === action.assistantMessageId && tool.id === action.toolId);
            if (existing < 0) return state;
            return { ...state, liveToolActivity: state.liveToolActivity.map((tool, index) => index === existing ? { ...tool, status: action.status, summary: boundedToolString(action.summary, tool.summary, MAX_TOOL_SUMMARY) } : tool) };
        }
        case "STREAM_NOTICE_ADDED": {
            if (!validId(action.assistantMessageId) || state.streamingAssistantId !== action.assistantMessageId || (action.kind !== "LIMIT_ITERATIONS" && action.kind !== "LIMIT_TOOL_CALLS" && action.kind !== "LIMIT_CONTEXT" && action.kind !== "COMPRESSION_PENDING" && action.kind !== "COMPRESSION_UNAVAILABLE")) return state;
            if (state.streamNotices.some((notice) => notice.assistantMessageId === action.assistantMessageId && notice.kind === action.kind)) return state;
            const notice: LiveStreamNotice = { id: `${action.assistantMessageId}-${action.kind}`, assistantMessageId: action.assistantMessageId, kind: action.kind };
            return { ...state, streamNotices: [...state.streamNotices, notice].slice(-MAX_STREAM_NOTICES) };
        }
        default:
            return state;
    }
}
