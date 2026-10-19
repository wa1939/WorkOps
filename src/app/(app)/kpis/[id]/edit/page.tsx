"use client";

import { useMemo, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { SabahFormProvider } from "@/components/sabah/forms/form-context";
import { FormAssistMenu } from "@/components/sabah/forms/form-assist-menu";
import { FieldAssist } from "@/components/sabah/forms/field-assist";
import { createKpiFieldDescriptors, serializeKpiFormValues, updateKpiFormValue, type KpiFormValues } from "@/components/sabah/forms/kpi-fields";

interface KPI {
    id: string;
    perspective: string;
    objective: string;
    name: string;
    definition: string | null;
    unit: string | null;
    trackingPeriod: string;
    weight: number | null;
    annualTarget: number | null;
    q1Target: number | null;
    q2Target: number | null;
    q3Target: number | null;
    q4Target: number | null;
    ownerId: string | null;
    status: string;
    updatedAt: string;
}

export default function EditKPIPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(true);
    const [kpi, setKpi] = useState<KPI | null>(null);
    const [formValues, setFormValues] = useState<KpiFormValues>({});
    const fields = useMemo(() => createKpiFieldDescriptors(formValues, setFormValues, ["status"]), [formValues]);

    useEffect(() => {
        // Fetch KPI data
        fetch(`/api/kpis/${params.id}`)
            .then((r) => r.json())
            .then((data) => {
                setKpi(data);
                setFormValues(data);
                setFetching(false);
            })
            .catch(console.error);


    }, [params.id]);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);

        const formData = new FormData(e.currentTarget);
        const data = {
            ...serializeKpiFormValues(formData, formValues),
            ownerId: null,
            expectedUpdatedAt: new Date(kpi!.updatedAt).toISOString(),
        };

        try {
            const res = await fetch(`/api/kpis/${params.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });

            if (res.ok) {
                router.push(`/kpis/${params.id}`);
                router.refresh();
            } else {
                toast({ title: "Error", description: "Failed to update KPI", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Error updating KPI", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    if (fetching || !kpi) {
        return (
            <div className="max-w-2xl mx-auto animate-fade-in flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <SabahFormProvider formId={`kpi-edit-${params.id}`} entityType="kpi" entityId={params.id} recordVersion={new Date(kpi!.updatedAt).toISOString()} fields={fields} suggestions={{}}>
        <div className="max-w-2xl mx-auto animate-fade-in">
            <div className="mb-6">
                <Button variant="ghost" asChild>
                    <Link href={`/kpis/${params.id}`}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to KPI
                    </Link>
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Edit KPI</CardTitle>
                    <CardDescription>Update key performance indicator settings</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} onChange={(event) => { const target = event.target as HTMLInputElement; if (target.name) updateKpiFormValue(setFormValues, target.name, target.value); }} className="space-y-6">
                        <div className="flex items-center gap-2"><FormAssistMenu /><FieldAssist fieldName="name" /></div>
                        <div className="space-y-2">
                            <Label htmlFor="perspective">Perspective *</Label>
                            <Select name="perspective" defaultValue={kpi.perspective} required>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select perspective" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Employee Engagement">Employee Engagement</SelectItem>
                                    <SelectItem value="Learning & Development">Learning & Development</SelectItem>
                                    <SelectItem value="Wellbeing">Wellbeing</SelectItem>
                                    <SelectItem value="Culture">Culture</SelectItem>
                                    <SelectItem value="Operations">Operations</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="objective">Objective *</Label>
                            <Input
                                id="objective"
                                name="objective"
                                defaultValue={kpi.objective}
                                placeholder="e.g., Increase employee satisfaction"
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="name">KPI Name *</Label>
                            <Input
                                id="name"
                                name="name"
                                defaultValue={kpi.name}
                                placeholder="e.g., Employee Satisfaction Score"
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="definition">Definition</Label>
                            <Textarea
                                id="definition"
                                name="definition"
                                defaultValue={kpi.definition || ""}
                                placeholder="How is this KPI measured?"
                                rows={3}
                            />
                        </div>

                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="unit">Unit</Label>
                                <Input
                                    id="unit"
                                    name="unit"
                                    defaultValue={kpi.unit || ""}
                                    placeholder="e.g., %, count, hours"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="annualTarget">Annual Target</Label>
                                <Input
                                    id="annualTarget"
                                    name="annualTarget"
                                    type="number"
                                    step="0.01"
                                    defaultValue={kpi.annualTarget || ""}
                                    placeholder="e.g., 85"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="trackingPeriod">Tracking Period *</Label>
                            <Select name="trackingPeriod" defaultValue={kpi.trackingPeriod || "ANNUAL"}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select tracking period" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Q1">Q1 Only</SelectItem>
                                    <SelectItem value="Q2">Q2 Only</SelectItem>
                                    <SelectItem value="Q3">Q3 Only</SelectItem>
                                    <SelectItem value="Q4">Q4 Only</SelectItem>
                                    <SelectItem value="ANNUAL">Annual (All Quarters)</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Select which quarter(s) this KPI needs to be updated
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="weight">Weight (%)</Label>
                            <Input
                                id="weight"
                                name="weight"
                                type="number"
                                step="0.1"
                                min="0"
                                max="100"
                                defaultValue={kpi.weight || ""}
                                placeholder="e.g., 15"
                            />
                            <p className="text-xs text-muted-foreground">
                                All KPI weights should total 100%
                            </p>
                        </div>

                        <div className="space-y-3">
                            <Label>Quarterly Targets (Optional)</Label>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div>
                                    <Label htmlFor="q1Target" className="text-xs">Q1</Label>
                                    <Input
                                        id="q1Target"
                                        name="q1Target"
                                        type="number"
                                        step="0.01"
                                        defaultValue={kpi.q1Target || ""}
                                        placeholder="Q1"
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="q2Target" className="text-xs">Q2</Label>
                                    <Input
                                        id="q2Target"
                                        name="q2Target"
                                        type="number"
                                        step="0.01"
                                        defaultValue={kpi.q2Target || ""}
                                        placeholder="Q2"
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="q3Target" className="text-xs">Q3</Label>
                                    <Input
                                        id="q3Target"
                                        name="q3Target"
                                        type="number"
                                        step="0.01"
                                        defaultValue={kpi.q3Target || ""}
                                        placeholder="Q3"
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="q4Target" className="text-xs">Q4</Label>
                                    <Input
                                        id="q4Target"
                                        name="q4Target"
                                        type="number"
                                        step="0.01"
                                        defaultValue={kpi.q4Target || ""}
                                        placeholder="Q4"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-4 pt-4">
                            <Button type="submit" disabled={loading}>
                                {loading ? "Saving..." : "Save Changes"}
                            </Button>
                            <Button type="button" variant="outline" onClick={() => router.back()}>
                                Cancel
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
        </SabahFormProvider>
    );
}
