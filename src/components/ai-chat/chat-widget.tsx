"use client";

import { useState, useRef, useEffect, FormEvent, KeyboardEvent, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, X, Send, Loader2, Square, Search, Plus, ListChecks, CheckCircle2, Target, Folder, Users, BarChart3, History, ArrowLeft, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessageBubble, type ChatMessage } from "./chat-message";
import { ConversationList } from "./conversation-list";
import type { ChatToolCall, ChatStreamEvent } from "@/app/api/ai/chat/route";
import { useToast } from "@/hooks/use-toast";
import { collectVerifiedInternalHrefs } from "@/lib/ai/verified-links";

const ACTIVE_CONV_KEY = "sabah:activeConversation";

const INTRO_MESSAGE: ChatMessage = {
    id: "intro",
    role: "assistant",
    content:
        "مرحباً 👋 أنا **صباح** — مساعدك الذكي في WorkOps.\n\nأقدر أساعدك بـ:\n- إنشاء المهام وربطها بمشاريع و KPIs\n- عرض مهامك المفتوحة أو المتأخرة\n- البحث في المشاريع والفريق\n- تحديث حالة المهام اللي عندك\n\nجرّب تقول لي:\n- *أنشئ مهمة عالية الأولوية لمراجعة تقرير الربع الثاني، موعدها الجمعة*\n- *اعرض لي مهامي المفتوحة*\n- *كم مهمة عندي الآن؟*\n\n---\n\nHi, I'm **Sabah**. I can create tasks, check your workload, and search projects or KPIs. Try:\n- *Create a high priority task to review Q2 report, due Friday*\n- *Show my open tasks*\n- *How many tasks do I have?*",
};

type ApiMessage = {
    role: "user" | "assistant" | "tool";
    content: string | null;
    tool_call_id?: string;
    tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
};

const TOOL_PROGRESS_LABELS: Record<string, { icon: typeof Search; label: string }> = {
    createTask: { icon: Plus, label: "Creating task…" },
    createTasks: { icon: Plus, label: "Creating tasks…" },
    updateTaskStatus: { icon: CheckCircle2, label: "Updating status…" },
    listMyTasks: { icon: ListChecks, label: "Listing your tasks…" },
    searchTasks: { icon: Search, label: "Searching tasks…" },
    getTaskStats: { icon: BarChart3, label: "Counting tasks…" },
    listProjects: { icon: Folder, label: "Listing projects…" },
    listTeamMembers: { icon: Users, label: "Looking up team…" },
    listKpis: { icon: Target, label: "Listing KPIs…" },
    getTask: { icon: ListChecks, label: "Loading task…" },
    listPmoActions: { icon: ListChecks, label: "Checking PMO actions…" },
    getPmoAction: { icon: Search, label: "Loading PMO action…" },
    draftPmoFollowUp: { icon: Send, label: "Drafting follow-up…" },
    getIntakeRows: { icon: Search, label: "Reading uploaded file…" },
    listCapabilities: { icon: Search, label: "Discovering Sabah capabilities…" },
    getCapabilityDetails: { icon: Search, label: "Loading capability details…" },
};

const RECORD_WEEK_PREFILL = "أبي أسجل إنجازاتي لهذا الأسبوع:\n- ";

export function ChatWidget() {
    const router = useRouter();
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([INTRO_MESSAGE]);
    const verifiedHrefs = useMemo(() => new Set(collectVerifiedInternalHrefs(messages.flatMap((message) => message.toolCalls ?? []))), [messages]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [activeTool, setActiveTool] = useState<string | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
    const [loadingConv, setLoadingConv] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const apiHistoryRef = useRef<ApiMessage[]>([]);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        const saved = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_CONV_KEY) : null;
        if (saved) setConversationId(saved);
    }, []);

    // Nudge deep link: /?sabah=record-week opens the widget pre-filled with the
    // record-my-week starter. Draft only — the user completes and sends it.
    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        if (params.get("sabah") !== "record-week") return;
        setOpen(true);
        setInput(RECORD_WEEK_PREFILL);
        params.delete("sabah");
        const qs = params.toString();
        router.replace(`${window.location.pathname}${qs ? `?${qs}` : ""}`);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (conversationId) {
            localStorage.setItem(ACTIVE_CONV_KEY, conversationId);
        } else {
            localStorage.removeItem(ACTIVE_CONV_KEY);
        }
    }, [conversationId]);

    const loadConversation = useCallback(async (id: string) => {
        setLoadingConv(true);
        try {
            const resp = await fetch(`/api/ai/conversations/${id}`);
            if (!resp.ok) {
                setConversationId(null);
                setMessages([INTRO_MESSAGE]);
                apiHistoryRef.current = [];
                return;
            }
            const data = (await resp.json()) as {
                id: string;
                messages: Array<{ id: string; role: string; content: string | null; toolCalls: ChatToolCall[] | null; toolCallId: string | null }>;
            };
            const mapped: ChatMessage[] = data.messages
                .filter((m) => m.role === "user" || m.role === "assistant")
                .map((m) => ({
                    id: m.id,
                    role: m.role as "user" | "assistant",
                    content: m.content ?? "",
                    toolCalls: m.toolCalls ?? undefined,
                }));
            setMessages(mapped.length > 0 ? mapped : [INTRO_MESSAGE]);
            apiHistoryRef.current = mapped.map((m) => ({
                role: m.role,
                content: m.content,
            }));
            setConversationId(id);
        } catch (err) {
            console.error("Failed to load conversation", err);
        } finally {
            setLoadingConv(false);
        }
    }, []);

    useEffect(() => {
        if (open && conversationId && messages.length <= 1) {
            loadConversation(conversationId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const handleNewChat = useCallback(() => {
        setMessages([INTRO_MESSAGE]);
        apiHistoryRef.current = [];
        setConversationId(null);
        setShowHistory(false);
    }, []);

    const handleSelectConversation = useCallback(
        async (id: string) => {
            await loadConversation(id);
            setShowHistory(false);
        },
        [loadConversation],
    );

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, loading, activeTool]);

    useEffect(() => {
        if (open) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [open]);

    const toggleOpen = useCallback(() => setOpen((o) => !o), []);

    useEffect(() => {
        const handler = (e: globalThis.KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
                e.preventDefault();
                toggleOpen();
            } else if (e.key === "Escape" && open) {
                setOpen(false);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [toggleOpen, open]);

    async function sendMessage(text: string) {
        const userMsg: ChatMessage = {
            id: `u-${Date.now()}`,
            role: "user",
            content: text,
        };
        const aiMsgId = `a-${Date.now()}`;
        const aiMsg: ChatMessage = {
            id: aiMsgId,
            role: "assistant",
            content: "",
            toolCalls: [],
        };
        setMessages((prev) => [...prev, userMsg, aiMsg]);
        setLoading(true);
        setActiveTool(null);

        const controller = new AbortController();
        abortRef.current = controller;

        const historyForApi: ApiMessage[] = apiHistoryRef.current.slice(-12);
        let refreshNeeded = false;
        let hitError = false;
        let fullText = "";
        const finalToolCalls: ChatToolCall[] = [];

        try {
            const resp = await fetch("/api/ai/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text,
                    history: historyForApi,
                    conversationId: conversationId ?? undefined,
                }),
                signal: controller.signal,
            });

            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({ error: "Request failed" }));
                throw new Error(errData.error ?? `HTTP ${resp.status}`);
            }

            if (!resp.body) throw new Error("No response stream");

            const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
            let buffer = "";

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += value;

                let idx: number;
                while ((idx = buffer.indexOf("\n\n")) !== -1) {
                    const frame = buffer.substring(0, idx).trim();
                    buffer = buffer.substring(idx + 2);
                    if (!frame.startsWith("data:")) continue;

                    let event: ChatStreamEvent;
                    try {
                        event = JSON.parse(frame.substring(5).trim());
                    } catch {
                        continue;
                    }

                    if (event.type === "conversation") {
                        setConversationId(event.id);
                    } else if (event.type === "token") {
                        fullText += event.delta;
                        setMessages((prev) =>
                            prev.map((m) => (m.id === aiMsgId ? { ...m, content: m.content + event.delta } : m)),
                        );
                    } else if (event.type === "tool_start") {
                        setActiveTool(event.name);
                    } else if (event.type === "tool_result") {
                        const tc: ChatToolCall = {
                            name: event.name,
                            params: event.params,
                            result: event.result,
                        };
                        finalToolCalls.push(tc);
                        setMessages((prev) =>
                            prev.map((m) =>
                                m.id === aiMsgId
                                    ? { ...m, toolCalls: [...(m.toolCalls ?? []), tc] }
                                    : m,
                            ),
                        );
                        if (
                            (event.name === "createTask" ||
                                event.name === "createTasks" ||
                                event.name === "updateTaskStatus") &&
                            event.result.ok
                        ) {
                            refreshNeeded = true;
                        }
                        setActiveTool(null);
                    } else if (event.type === "limit") {
                        const msg =
                            event.reason === "iterations"
                                ? "\n\n_(Hit reasoning step limit — ask me to continue if needed.)_"
                                : event.reason === "tool_calls"
                                    ? "\n\n_(Hit tool-call limit for this turn.)_"
                                    : "\n\n_(Conversation got too long — consider starting fresh.)_";
                        fullText += msg;
                        setMessages((prev) =>
                            prev.map((m) => (m.id === aiMsgId ? { ...m, content: m.content + msg } : m)),
                        );
                    } else if (event.type === "error") {
                        hitError = true;
                        const msg = `\n\n_Sabah hit an error: ${event.message}_`;
                        fullText += msg;
                        setMessages((prev) =>
                            prev.map((m) => (m.id === aiMsgId ? { ...m, content: m.content + msg } : m)),
                        );
                    } else if (event.type === "done") {
                        break;
                    }
                }
            }

            apiHistoryRef.current = [
                ...apiHistoryRef.current,
                { role: "user", content: text },
                { role: "assistant", content: fullText || "" },
            ];

            if (refreshNeeded) router.refresh();
            setHistoryRefreshKey((k) => k + 1);
        } catch (err) {
            const aborted = (err as Error).name === "AbortError";
            if (aborted) {
                setMessages((prev) =>
                    prev.map((m) =>
                        m.id === aiMsgId
                            ? { ...m, content: (m.content || "").trim() + "\n\n_(cancelled)_" }
                            : m,
                    ),
                );
            } else {
                const message = err instanceof Error ? err.message : "Something went wrong";
                if (!hitError) {
                    toast({ title: "Sabah hit an error", description: message, variant: "destructive" });
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === aiMsgId
                                ? { ...m, content: `Sorry, I hit an error: ${message}` }
                                : m,
                        ),
                    );
                }
            }
        } finally {
            setLoading(false);
            setActiveTool(null);
            abortRef.current = null;
            // Suppress unused warnings
            void finalToolCalls;
        }
    }

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const text = input.trim();
        if (!text || loading) return;
        setInput("");
        sendMessage(text);
    }

    function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e as unknown as FormEvent);
        }
    }

    function handleStop() {
        abortRef.current?.abort();
    }

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label="Open Sabah (Cmd+J)"
                title="Open Sabah (Cmd+J)"
                className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/30 transition-all hover:scale-105 hover:shadow-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:ring-offset-2 focus:ring-offset-background"
            >
                <span className="absolute inset-0 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-400 opacity-60 blur-md animate-pulse" />
                <Sparkles className="relative h-6 w-6" />
            </button>
        );
    }

    async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        e.target.value = ""; // allow re-picking the same file
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            toast({ title: "File too large", description: "Max 2 MB.", variant: "destructive" });
            return;
        }
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append("file", file);
            const res = await fetch("/api/ai/intake", { method: "POST", body: fd });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            const cols = (data.headers || []).join(", ").slice(0, 200);
            const msg =
                data.kind === "rows"
                    ? `Uploaded "${data.filename}" (intake ${data.intakeId}): ${data.rowCount} rows — columns: ${cols}. Review it and propose tasks.`
                    : `Uploaded "${data.filename}" (intake ${data.intakeId}): document, ${data.total} chars. Extract the action items and propose tasks.`;
            await sendMessage(msg);
        } catch (err) {
            toast({ title: "Upload failed", description: (err as Error).message, variant: "destructive" });
        } finally {
            setUploading(false);
        }
    }

    const activeProgress = activeTool ? TOOL_PROGRESS_LABELS[activeTool] : null;
    const ActiveIcon = activeProgress?.icon;

    return (
        <div className="fixed bottom-6 right-6 z-40 flex h-[min(600px,calc(100vh-3rem))] w-[min(420px,calc(100vw-3rem))] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl shadow-violet-500/10 animate-in fade-in slide-in-from-bottom-4 duration-200">
            <header className="flex items-center justify-between border-b border-border bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 px-4 py-3">
                <div className="flex items-center gap-2">
                    {showHistory ? (
                        <button
                            type="button"
                            onClick={() => setShowHistory(false)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted hover:bg-accent transition-colors"
                            aria-label="Back"
                            title="Back"
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </button>
                    ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500">
                            <Sparkles className="h-4 w-4 text-white" />
                        </div>
                    )}
                    <div>
                        <p className="text-sm font-semibold">{showHistory ? "Conversations" : "Sabah · صباح"}</p>
                        <p className="text-[10px] text-muted-foreground">
                            {showHistory ? "Your past chats" : "Your WorkOps assistant"}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    {!showHistory && (
                        <>
                            <button
                                type="button"
                                onClick={handleNewChat}
                                aria-label="New chat"
                                title="New chat"
                                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <Plus className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowHistory(true)}
                                aria-label="History"
                                title="History"
                                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <History className="h-3.5 w-3.5" />
                            </button>
                        </>
                    )}
                    <button
                        type="button"
                        onClick={() => setOpen(false)}
                        aria-label="Close Sabah (Cmd+J or Esc)"
                        title="Close (Cmd+J or Esc)"
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            </header>

            {showHistory ? (
                <ConversationList
                    activeId={conversationId}
                    onSelect={handleSelectConversation}
                    onNew={handleNewChat}
                    refreshKey={historyRefreshKey}
                />
            ) : (
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                    {loadingConv ? (
                        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Loading conversation…
                        </div>
                    ) : (
                        messages.map((m) => <ChatMessageBubble key={m.id} message={m} verifiedHrefs={verifiedHrefs} />)
                    )}
                    {loading && activeProgress && ActiveIcon && (
                        <div className="flex items-center gap-2 text-xs text-violet-400 pl-9 animate-pulse">
                            <ActiveIcon className="h-3 w-3" />
                            <span>{activeProgress.label}</span>
                        </div>
                    )}
                    {loading && !activeProgress && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground pl-9">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>Thinking…</span>
                        </div>
                    )}
                </div>
            )}

            {!showHistory && <form onSubmit={handleSubmit} className="border-t border-border p-3">
                <div className="flex items-end gap-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls,.csv,.txt,.md,.docx"
                        className="hidden"
                        onChange={handleFileUpload}
                    />
                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={loading || uploading}
                        onClick={() => fileInputRef.current?.click()}
                        title="Upload Excel / CSV / MoM"
                        aria-label="Upload a file"
                        className="h-9 w-9 flex-shrink-0"
                    >
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                    </Button>
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="اكتب لصباح… أو Ask Sabah to create a task, list your work…"
                        rows={1}
                        disabled={loading}
                        className="flex-1 resize-none rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50 max-h-24"
                        style={{ minHeight: "36px" }}
                    />
                    {loading ? (
                        <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            onClick={handleStop}
                            title="Stop"
                            aria-label="Stop"
                            className="h-9 w-9 flex-shrink-0"
                        >
                            <Square className="h-3.5 w-3.5 fill-current" />
                        </Button>
                    ) : (
                        <Button
                            type="submit"
                            size="icon"
                            disabled={!input.trim()}
                            className="h-9 w-9 flex-shrink-0 bg-gradient-to-br from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600"
                        >
                            <Send className="h-4 w-4" />
                        </Button>
                    )}
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground/70">
                    Sabah can create and update your tasks — cannot delete anything. ⌘J to toggle.
                </p>
            </form>}
        </div>
    );
}
