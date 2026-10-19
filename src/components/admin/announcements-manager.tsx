"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArrowLeft, Eye, Loader2, Megaphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface DepartmentOption {
    id: string;
    name: string;
}

interface AudienceSelector {
    departments: string[];
    includeFutureMembers: boolean;
}

interface AnnouncementRow {
    id: string;
    title: string;
    body: string;
    variant: string;
    status?: string;
    isActive: boolean;
    createdAt: string;
    publishAt?: string | null;
    expiresAt?: string | null;
    ctaUrl?: string | null;
    audienceJson?: string | null;
    audienceVersion?: number;
    eligibleCount?: number | null;
    seenCount?: number | null;
    acknowledgedCount?: number | null;
    createdBy: { name: string } | null;
    _count?: { seenBy?: number };
}

interface AudiencePreview {
    count: number;
    audienceVersion?: number;
}

const VARIANT_DOT: Record<string, string> = {
    celebrate: "bg-primary",
    info: "bg-blue-500",
    warning: "bg-amber-500",
};

const EMPTY_AUDIENCE: AudienceSelector = {
    departments: [],
    includeFutureMembers: false,
};

function isSameOriginRelativeUrl(value: string): boolean {
    if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) {
        return false;
    }
    try {
        const parsed = new URL(value, "https://departmenthub.invalid");
        return parsed.origin === "https://departmenthub.invalid";
    } catch {
        return false;
    }
}

function parseAudienceJson(value: string | null | undefined): AudienceSelector {
    if (!value) return EMPTY_AUDIENCE;
    try {
        const parsed = JSON.parse(value) as Partial<AudienceSelector>;
        return {
            departments: Array.isArray(parsed.departments) ? parsed.departments.filter((id): id is string => typeof id === "string") : [],
            includeFutureMembers: parsed.includeFutureMembers === true,
        };
    } catch {
        return EMPTY_AUDIENCE;
    }
}

function normalizeRow(value: AnnouncementRow): AnnouncementRow {
    return {
        ...value,
        status: value.status ?? (value.isActive ? "PUBLISHED" : "ARCHIVED"),
        createdBy: value.createdBy ?? null,
    };
}

function toIsoOrNull(value: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function AnnouncementsManager() {
    const { toast } = useToast();
    const [rows, setRows] = useState<AnnouncementRow[]>([]);
    const [departments, setDepartments] = useState<DepartmentOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [variant, setVariant] = useState("celebrate");
    const [ctaUrl, setCtaUrl] = useState("");
    const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
    const [includeFutureMembers, setIncludeFutureMembers] = useState(false);
    const [expiresAt, setExpiresAt] = useState("");
    const [scheduledAt, setScheduledAt] = useState("");

    const [step, setStep] = useState<"editor" | "preview">("editor");
    const [preview, setPreview] = useState<AudiencePreview | null>(null);
    const [audienceConfirmed, setAudienceConfirmed] = useState(false);
    const [authoringError, setAuthoringError] = useState<string | null>(null);

    const audience = useMemo<AudienceSelector>(() => ({
        departments: selectedDepartments,
        includeFutureMembers,
    }), [includeFutureMembers, selectedDepartments]);

    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/announcements");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setRows(Array.isArray(data.announcements) ? data.announcements.map(normalizeRow) : []);
        } catch (err) {
            toast({ title: "Couldn't load announcements", description: (err as Error).message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        void load();
        void fetch("/api/admin/departments")
            .then((res) => res.ok ? res.json() : [])
            .then((data: unknown) => {
                if (Array.isArray(data)) setDepartments(data.filter((item): item is DepartmentOption => Boolean(item && typeof item === "object" && "id" in item && "name" in item)));
            })
            .catch(() => undefined);
    }, [load]);

    const resetEditor = () => {
        setTitle("");
        setBody("");
        setVariant("celebrate");
        setCtaUrl("");
        setSelectedDepartments([]);
        setIncludeFutureMembers(false);
        setExpiresAt("");
        setScheduledAt("");
        setStep("editor");
        setPreview(null);
        setAudienceConfirmed(false);
        setAuthoringError(null);
    };

    const invalidateAudiencePreview = () => {
        setPreview(null);
        setAudienceConfirmed(false);
        setAuthoringError(null);
    };

    const validateEditor = (): boolean => {
        if (!title.trim() || !body.trim()) {
            setAuthoringError("Add a title and a message before continuing.");
            return false;
        }
        if (ctaUrl.trim() && !isSameOriginRelativeUrl(ctaUrl.trim())) {
            setAuthoringError("CTA link must be a same-origin relative URL such as /tasks.");
            return false;
        }
        return true;
    };

    const previewAudience = async () => {
        if (!validateEditor()) return;
        setSaving(true);
        setAuthoringError(null);
        try {
            const query = new URLSearchParams({
                preview: "1",
                departments: selectedDepartments.join(","),
                includeFutureMembers: String(includeFutureMembers),
            });
            const res = await fetch(`/api/announcements?${query.toString()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const count = Number(data.audienceCount ?? data.eligibleCount ?? 0);
            setPreview({
                count: Number.isFinite(count) ? count : 0,
                audienceVersion: typeof data.audienceVersion === "number" ? data.audienceVersion : undefined,
            });
            setAudienceConfirmed(false);
            setStep("preview");
        } catch (err) {
            setAuthoringError(`Audience preview failed: ${(err as Error).message}`);
        } finally {
            setSaving(false);
        }
    };

    const buildPayload = (status: "DRAFT" | "PUBLISHED" | "SCHEDULED") => ({
        title: title.trim(),
        body: body.trim(),
        variant,
        ctaUrl: ctaUrl.trim() || null,
        audienceJson: JSON.stringify(audience),
        audienceVersion: preview?.audienceVersion,
        status,
        publishAt: status === "PUBLISHED" ? new Date().toISOString() : status === "SCHEDULED" ? toIsoOrNull(scheduledAt) : null,
        expiresAt: toIsoOrNull(expiresAt),
    });

    const createAnnouncement = async (status: "DRAFT" | "PUBLISHED" | "SCHEDULED") => {
        if (!validateEditor()) return;
        if (status !== "DRAFT" && (!preview || !audienceConfirmed)) {
            setAuthoringError("Confirm the audience preview before publishing.");
            setStep("preview");
            return;
        }
        if (status === "SCHEDULED") {
            const publishAt = toIsoOrNull(scheduledAt);
            if (!publishAt) {
                setAuthoringError("Choose a future date and time before scheduling.");
                return;
            }
            if (new Date(publishAt).getTime() <= Date.now()) {
                setAuthoringError("Choose a future date and time before scheduling.");
                return;
            }
        }

        setSaving(true);
        setAuthoringError(null);
        try {
            const res = await fetch("/api/announcements", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildPayload(status)),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            toast({
                title: status === "DRAFT" ? "Draft saved" : status === "SCHEDULED" ? "Announcement scheduled" : "Announcement published",
            });
            resetEditor();
            await load();
        } catch (err) {
            setAuthoringError(`${status === "DRAFT" ? "Saving draft" : "Publishing announcement"} failed: ${(err as Error).message}`);
        } finally {
            setSaving(false);
        }
    };

    const archive = async (row: AnnouncementRow) => {
        setSaving(true);
        try {
            const res = await fetch(`/api/announcements/${row.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "ARCHIVED" }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json().catch(() => ({}));
            const archived = normalizeRow({
                ...row,
                ...(data.announcement ?? {}),
                status: "ARCHIVED",
                isActive: false,
            });
            setRows((current) => current.map((item) => item.id === row.id ? archived : item));
            toast({ title: "Announcement archived" });
        } catch (err) {
            toast({ title: "Archive failed", description: (err as Error).message, variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const toggleDepartment = (id: string, checked: boolean) => {
        invalidateAudiencePreview();
        setSelectedDepartments((current) => checked ? current.includes(id) ? current : [...current, id] : current.filter((value) => value !== id));
    };

    const archivedRows = rows.filter((row) => row.status === "ARCHIVED");
    const currentRows = rows.filter((row) => row.status !== "ARCHIVED");

    const renderRow = (row: AnnouncementRow) => {
        const status = row.status ?? "PUBLISHED";
        const eligibleCount = typeof row.eligibleCount === "number" ? row.eligibleCount : 0;
        const seenCount = typeof row.seenCount === "number" ? row.seenCount : row._count?.seenBy ?? 0;
        const acknowledgedCount = typeof row.acknowledgedCount === "number" ? row.acknowledgedCount : 0;
        return (
            <div key={row.id} className="flex items-start gap-3 rounded-lg border p-4">
                <div className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", VARIANT_DOT[row.variant] ?? "bg-primary")} />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{row.title}</p>
                        <Badge variant={status === "ARCHIVED" ? "secondary" : "outline"}>{status === "ARCHIVED" ? "Archived" : status}</Badge>
                    </div>
                    <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-sm text-muted-foreground">{row.body}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1" title="Seen count over the eligible audience snapshot">
                            <Eye className="h-3 w-3" /> Seen by {seenCount}/{eligibleCount}
                        </span>
                        <span>·</span>
                        <span>Acknowledged {acknowledgedCount}/{eligibleCount}</span>
                        <span>·</span>
                        <span>{new Date(row.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span>
                        {row.createdBy?.name && <span>· by {row.createdBy.name.split(" ")[0]}</span>}
                    </div>
                </div>
                {status !== "ARCHIVED" && (
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={saving}
                        onClick={() => void archive(row)}
                        aria-label={`Archive ${row.title}`}
                    >
                        <Archive className="mr-2 h-4 w-4" />
                        Archive
                    </Button>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                        <Megaphone className="h-5 w-5 text-primary" />
                        Author an announcement
                    </CardTitle>
                    <CardDescription>
                        Write a targeted announcement, preview its eligible audience, then save it as a draft, publish it now, or schedule it.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {step === "editor" ? (
                        <>
                            <div className="space-y-1.5">
                                <Label htmlFor="ann-title">Title</Label>
                                <Input id="ann-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What's new in the workspace?" maxLength={120} />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="ann-body">Message</Label>
                                <Textarea id="ann-body" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Share the update with the right audience." rows={7} maxLength={4000} />
                                <p className="text-xs text-muted-foreground">Line breaks are preserved.</p>
                            </div>
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label htmlFor="ann-variant">Style</Label>
                                    <select id="ann-variant" value={variant} onChange={(event) => setVariant(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                                        <option value="celebrate">Celebrate</option>
                                        <option value="info">Info</option>
                                        <option value="warning">Heads-up</option>
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="ann-cta">CTA link (optional)</Label>
                                    <Input id="ann-cta" value={ctaUrl} onChange={(event) => setCtaUrl(event.target.value)} placeholder="/tasks" />
                                </div>
                            </div>
                            <fieldset className="space-y-2 rounded-lg border p-4">
                                <legend className="px-1 text-sm font-medium">Audience</legend>
                                <p className="text-xs text-muted-foreground">Leave departments empty to target all active members.</p>
                                <div className="grid gap-2 sm:grid-cols-2">
                                    {departments.length > 0 ? departments.map((department) => (
                                        <label key={department.id} className="flex items-center gap-2 text-sm">
                                            <Checkbox
                                                checked={selectedDepartments.includes(department.id)}
                                                onCheckedChange={(checked) => toggleDepartment(department.id, checked === true)}
                                                aria-label={department.name}
                                            />
                                            {department.name}
                                        </label>
                                    )) : <span className="text-sm text-muted-foreground">No departments available.</span>}
                                </div>
                                <label className="flex items-center gap-2 text-sm">
                                    <Checkbox
                                        checked={includeFutureMembers}
                                        onCheckedChange={(checked) => {
                                            invalidateAudiencePreview();
                                            setIncludeFutureMembers(checked === true);
                                        }}
                                        aria-label="Include future members"
                                    />
                                    Include future members added after publishing
                                </label>
                            </fieldset>
                            <div className="space-y-1.5">
                                <Label htmlFor="ann-expires">Expiry (optional)</Label>
                                <Input id="ann-expires" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
                            </div>
                            {authoringError && <p role="alert" className="text-sm text-destructive">{authoringError}</p>}
                            <div className="flex flex-wrap justify-end gap-2">
                                <Button variant="outline" onClick={() => void createAnnouncement("DRAFT")} disabled={saving}>
                                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    Save draft
                                </Button>
                                <Button onClick={() => void previewAudience()} disabled={saving}>
                                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                                    Preview audience
                                </Button>
                            </div>
                        </>
                    ) : (
                        <div className="space-y-4">
                            <Button variant="ghost" onClick={() => { setStep("editor"); setAuthoringError(null); }}>
                                <ArrowLeft className="mr-2 h-4 w-4" /> Back to editor
                            </Button>
                            <div className="rounded-lg border bg-muted/20 p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-medium">Preview audience</p>
                                        <p className="text-2xl font-semibold">{preview?.count ?? 0} eligible members</p>
                                    </div>
                                    <Badge variant={audienceConfirmed ? "default" : "outline"}>
                                        {audienceConfirmed ? "Audience confirmed" : "Confirmation required"}
                                    </Badge>
                                </div>
                                <p className="mt-2 text-sm text-muted-foreground">
                                    This count is the eligible snapshot for the selected departments and future-member setting.
                                </p>
                            </div>
                            <div className="rounded-lg border p-4">
                                <p className="font-medium">{title}</p>
                                <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{body}</p>
                                {ctaUrl && <p className="mt-2 text-xs text-muted-foreground">CTA: {ctaUrl}</p>}
                            </div>
                            {!audienceConfirmed && (
                                <Button variant="outline" onClick={() => { setAudienceConfirmed(true); setAuthoringError(null); }}>
                                    Confirm audience ({preview?.count ?? 0})
                                </Button>
                            )}
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label htmlFor="ann-schedule">Schedule for later (optional)</Label>
                                    <Input id="ann-schedule" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
                                </div>
                                <div className="flex items-end justify-end gap-2">
                                    <Button variant="outline" onClick={() => void createAnnouncement("SCHEDULED")} disabled={saving || !audienceConfirmed}>
                                        Schedule
                                    </Button>
                                    <Button onClick={() => void createAnnouncement("PUBLISHED")} disabled={saving}>
                                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Megaphone className="mr-2 h-4 w-4" />}
                                        Publish now
                                    </Button>
                                </div>
                            </div>
                            {authoringError && <p role="alert" className="text-sm text-destructive">{authoringError}</p>}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Announcement archive</CardTitle>
                    <CardDescription>Archived announcements remain available for audit. Counts use the eligible audience snapshot.</CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                    ) : rows.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">No announcements yet.</p>
                    ) : (
                        <div className="space-y-5">
                            {currentRows.length > 0 && <div className="space-y-3">{currentRows.map(renderRow)}</div>}
                            {archivedRows.length > 0 && (
                                <section aria-labelledby="archived-announcements-heading" className="space-y-3">
                                    <h3 id="archived-announcements-heading" className="text-sm font-semibold text-muted-foreground">Archived</h3>
                                    {archivedRows.map(renderRow)}
                                </section>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
