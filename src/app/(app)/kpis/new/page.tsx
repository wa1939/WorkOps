"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { SabahFormProvider } from "@/components/sabah/forms/form-context";
import { FormAssistMenu } from "@/components/sabah/forms/form-assist-menu";
import { FieldAssist } from "@/components/sabah/forms/field-assist";
import { createKpiFieldDescriptors, serializeKpiFormValues, updateKpiFormValue, type KpiFormValues } from "@/components/sabah/forms/kpi-fields";

export default function NewKPIPage() {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [formValues, setFormValues] = useState<KpiFormValues>({});
    const fields = useMemo(() => createKpiFieldDescriptors(formValues, setFormValues), [formValues]);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);

        const formData = new FormData(e.currentTarget);
        const data = {
            ...serializeKpiFormValues(formData, formValues),
            ownerId: null,
            trackingPeriod: serializeKpiFormValues(formData, formValues).trackingPeriod || "ANNUAL",
            status: serializeKpiFormValues(formData, formValues).status || "ON_TRACK",
        };

        try {
            const res = await fetch("/api/kpis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });

            if (res.ok) {
                router.push("/kpis");
                router.refresh();
            } else {
                toast({ title: "Error", description: "Failed to create KPI", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Error creating KPI", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <SabahFormProvider formId="kpi-new" entityType="kpi" entityId={null} recordVersion={null} fields={fields} suggestions={{}}>
        <div className="max-w-2xl mx-auto animate-fade-in">
            <div className="mb-6">
                <Button variant="ghost" asChild>
                    <Link href="/kpis">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to KPIs
                    </Link>
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Create New KPI</CardTitle>
                    <CardDescription>Define a new key performance indicator</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} onChange={(event) => { const target = event.target as HTMLInputElement; if (target.name) updateKpiFormValue(setFormValues, target.name, target.value); }} className="space-y-6">
                        <div className="flex items-center gap-2"><FormAssistMenu /><FieldAssist fieldName="name" /></div>
                        <div className="space-y-2">
                            <Label htmlFor="perspective">Perspective *</Label>
                            <Select name="perspective" required>
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
                                placeholder="e.g., Increase employee satisfaction"
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="name">KPI Name *</Label>
                            <Input
                                id="name"
                                name="name"
                                placeholder="e.g., Employee Satisfaction Score"
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="definition">Definition</Label>
                            <Textarea
                                id="definition"
                                name="definition"
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
                                    placeholder="e.g., 85"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="trackingPeriod">Tracking Period *</Label>
                            <Select name="trackingPeriod" defaultValue="ANNUAL">
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
                                        placeholder="Q4"
                                    />
                                </div>
                            </div>
                        </div>


                        <div className="flex gap-4 pt-4">
                            <Button type="submit" disabled={loading}>
                                {loading ? "Creating..." : "Create KPI"}
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
