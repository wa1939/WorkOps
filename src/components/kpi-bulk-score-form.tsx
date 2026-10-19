"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Loader2, Check, X } from "lucide-react";
import { SabahFormProvider } from "@/components/sabah/forms/form-context";
import { FormAssistMenu } from "@/components/sabah/forms/form-assist-menu";
import { FieldAssist } from "@/components/sabah/forms/field-assist";
import type { SabahFieldDescriptor } from "@/components/sabah/forms/contracts";

type Quarter = "Q1" | "Q2" | "Q3" | "Q4" | "ANNUAL";
const QUARTERS: Quarter[] = ["Q1", "Q2", "Q3", "Q4", "ANNUAL"];

interface KpiRow {
    id: string;
    name: string;
    perspective: string | null;
    unit: string | null;
    q1Target: number | null;
    q2Target: number | null;
    q3Target: number | null;
    q4Target: number | null;
    annualTarget: number | null;
    updatedAt: string;
    updates: { quarter: string | null; value: number | null }[];
}

function currentQuarter(): Quarter {
    const m = new Date().getMonth();
    if (m <= 2) return "Q1";
    if (m <= 5) return "Q2";
    if (m <= 8) return "Q3";
    return "Q4";
}

function targetFor(kpi: KpiRow, q: Quarter): number | null {
    switch (q) {
        case "Q1": return kpi.q1Target ?? kpi.annualTarget;
        case "Q2": return kpi.q2Target ?? kpi.annualTarget;
        case "Q3": return kpi.q3Target ?? kpi.annualTarget;
        case "Q4": return kpi.q4Target ?? kpi.annualTarget;
        case "ANNUAL": return kpi.annualTarget;
    }
}

type RowStatus = "idle" | "saving" | "saved" | "error";

export function KpiBulkScoreForm({ kpis }: { kpis: KpiRow[] }) {
    const router = useRouter();
    const { toast } = useToast();
    const [quarter, setQuarter] = useState<Quarter>(currentQuarter());
    const [values, setValues] = useState<Record<string, string>>({});
    const [notes, setNotes] = useState<Record<string, string>>({});
    const [status, setStatus] = useState<Record<string, RowStatus>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [savingAll, setSavingAll] = useState(false);
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
    const fields = useMemo<SabahFieldDescriptor[]>(() => kpis.flatMap((kpi) => ["value", "note"].map((kind) => {
        const name = `score:${kpi.id}:${kind}`;
        return {
            name,
            label: `${kpi.name} ${kind}`,
            value: kind === "value" ? values[kpi.id] ?? "" : notes[kpi.id] ?? "",
            empty: kind === "value" ? !(values[kpi.id] ?? "").trim() : !(notes[kpi.id] ?? "").trim(),
            protected: false,
            risk: "SENSITIVE_WRITE" as const,
            actions: ["SUGGEST"] as const,
            validate: async (proposed: unknown) => kind === "value" && Number.isNaN(Number(proposed))
                ? { ok: false as const, message: "Not a number" }
                : { ok: true as const, value: proposed },
            setValue: (value: unknown) => {
                if (kind === "value") setValues((current) => ({ ...current, [kpi.id]: String(value ?? "") }));
                else setNotes((current) => ({ ...current, [kpi.id]: String(value ?? "") }));
            },
        };
    })), [kpis, notes, values]);

    // Reset dirty state when quarter changes
    const groups = useMemo(() => {
        const byPersp = new Map<string, KpiRow[]>();
        for (const k of kpis) {
            const p = k.perspective || "Other";
            if (!byPersp.has(p)) byPersp.set(p, []);
            byPersp.get(p)!.push(k);
        }
        return Array.from(byPersp.entries());
    }, [kpis]);

    const existingValue = (kpi: KpiRow): number | null => {
        const u = kpi.updates.find((x) => x.quarter === quarter);
        return u?.value ?? null;
    };

    const dirtyIds = Object.entries(values)
        .filter(([, v]) => v.trim() !== "")
        .map(([id]) => id);

    const changeQuarter = (q: Quarter) => {
        setQuarter(q);
        setValues({});
        setNotes({});
        setStatus({});
        setErrors({});
    };

    const saveRow = async (kpi: KpiRow): Promise<boolean> => {
        const raw = values[kpi.id];
        if (!raw || raw.trim() === "") return true; // nothing to save
        const num = Number(raw);
        if (Number.isNaN(num)) {
            setStatus((s) => ({ ...s, [kpi.id]: "error" }));
            setErrors((e) => ({ ...e, [kpi.id]: "Not a number" }));
            return false;
        }
        setStatus((s) => ({ ...s, [kpi.id]: "saving" }));
        try {
            const res = await fetch(`/api/kpis/${kpi.id}/update`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ value: num, quarter, period: quarter, note: notes[kpi.id] || undefined, expectedUpdatedAt: kpi.updatedAt }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `HTTP ${res.status}`);
            }
            setStatus((s) => ({ ...s, [kpi.id]: "saved" }));
            return true;
        } catch (err) {
            setStatus((s) => ({ ...s, [kpi.id]: "error" }));
            setErrors((e) => ({ ...e, [kpi.id]: (err as Error).message }));
            return false;
        }
    };

    const saveAll = async () => {
        setSavingAll(true);
        let ok = 0;
        let fail = 0;
        for (const kpi of kpis) {
            if (!values[kpi.id] || values[kpi.id].trim() === "") continue;
            const success = await saveRow(kpi);
            if (success) ok++;
            else fail++;
        }
        setSavingAll(false);
        if (ok > 0 && fail === 0) {
            toast({ title: "Scores saved", description: `${ok} KPI${ok === 1 ? "" : "s"} updated for ${quarter}.` });
        } else if (ok > 0) {
            toast({ variant: "destructive", title: "Partly saved", description: `${ok} saved, ${fail} failed. Check the highlighted rows.` });
        } else if (fail > 0) {
            toast({ variant: "destructive", title: "Nothing saved", description: `${fail} row${fail === 1 ? "" : "s"} failed.` });
        }
        // Clear saved values so they show as "already scored" on refresh
        router.refresh();
    };

    let rowIndex = -1;

    return (
        <SabahFormProvider formId="kpi-score" entityType="kpi" entityId={null} recordVersion={null} fields={fields} suggestions={{}}>
        <div className="space-y-6 pb-24">
            <div className="flex items-center gap-2"><FormAssistMenu />{kpis[0] && <FieldAssist fieldName={`score:${kpis[0].id}:value`} />}</div>
            {/* Quarter selector */}
            <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground mr-1">Quarter:</span>
                {QUARTERS.map((q) => (
                    <Button
                        key={q}
                        variant={quarter === q ? "default" : "outline"}
                        size="sm"
                        onClick={() => changeQuarter(q)}
                    >
                        {q === "ANNUAL" ? "Annual" : q}
                    </Button>
                ))}
            </div>

            {groups.map(([perspective, rows]) => (
                <div key={perspective} className="space-y-1.5">
                    <h2 className="text-sm font-semibold text-muted-foreground">{perspective}</h2>
                    <div className="rounded-lg border divide-y">
                        {rows.map((kpi) => {
                            rowIndex++;
                            const idx = rowIndex;
                            const target = targetFor(kpi, quarter);
                            const existing = existingValue(kpi);
                            const st = status[kpi.id] || "idle";
                            return (
                                <div
                                    key={kpi.id}
                                    className={cn(
                                        "grid grid-cols-[1fr_auto_120px_1fr_auto] items-center gap-3 px-3 py-2 text-sm",
                                        st === "saved" && "bg-emerald-500/5",
                                        st === "error" && "bg-red-500/5",
                                    )}
                                >
                                    <Link href={`/kpis/${kpi.id}`} className="truncate hover:text-primary transition-colors" title={kpi.name}>
                                        {kpi.name}
                                    </Link>
                                    <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                                        target {target ?? "—"}{kpi.unit ? ` ${kpi.unit}` : ""}
                                    </span>
                                    <div className="flex items-center gap-1">
                                    <Input
                                        ref={(el) => { inputRefs.current[idx] = el; }}
                                        data-row-index={idx}
                                        type="number"
                                        step="any"
                                        placeholder={existing !== null ? `was ${existing}` : "value"}
                                        value={values[kpi.id] ?? ""}
                                        onChange={(e) => setValues((v) => ({ ...v, [kpi.id]: e.target.value }))}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                const next = inputRefs.current[idx + 1];
                                                if (next) next.focus();
                                            }
                                        }}
                                        className="h-8"
                                    />
                                    <FieldAssist fieldName={`score:${kpi.id}:value`} />
                                    </div>
                                    <Input
                                        placeholder="note (optional)"
                                        value={notes[kpi.id] ?? ""}
                                        onChange={(e) => setNotes((n) => ({ ...n, [kpi.id]: e.target.value }))}
                                        className="h-8 text-xs"
                                    />
                                    <span className="w-16 flex justify-end">
                                        {st === "saving" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                                        {st === "saved" && <Check className="h-4 w-4 text-emerald-500" />}
                                        {st === "error" && (
                                            <span title={errors[kpi.id]}>
                                                <X className="h-4 w-4 text-red-500" />
                                            </span>
                                        )}
                                        {st === "idle" && existing !== null && (
                                            <span className="text-[10px] text-muted-foreground">scored</span>
                                        )}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}

            {/* Sticky save footer */}
            <div className="fixed bottom-0 left-0 right-0 sm:left-64 border-t bg-background/95 backdrop-blur px-6 py-3 flex items-center justify-between z-40">
                <span className="text-sm text-muted-foreground">
                    {dirtyIds.length > 0
                        ? `${dirtyIds.length} unsaved ${dirtyIds.length === 1 ? "entry" : "entries"} for ${quarter}`
                        : "Enter values above, then Save all."}
                </span>
                <Button onClick={saveAll} disabled={savingAll || dirtyIds.length === 0}>
                    {savingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                    Save all
                </Button>
            </div>
        </div>
        </SabahFormProvider>
    );
}
