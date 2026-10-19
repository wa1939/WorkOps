"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Users } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function NewCaseStudyPage() {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [makeFloating, setMakeFloating] = useState(false);
    const [workAreaId, setWorkAreaId] = useState("unclassified");
    const [workAreas, setWorkAreas] = useState<Array<{ id: string; name: string }>>([]);

    useEffect(() => { fetch("/api/pmo/work-areas").then((response) => response.json()).then(setWorkAreas); }, []);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);

        const formData = new FormData(e.currentTarget);
        const data = {
            name: formData.get("name") as string,
            brief: formData.get("brief") as string,
            status: "Open",
            dueAt: formData.get("dueAt") ? new Date(formData.get("dueAt") as string).toISOString() : null,
            makeFloating: makeFloating,
            workAreaId: workAreaId === "unclassified" ? null : workAreaId,
        };

        try {
            const res = await fetch("/api/case-studies", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });

            if (res.ok) {
                router.push("/case-studies");
                router.refresh();
            } else {
                toast({ title: "Error", description: "Failed to create case study", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Error creating case study", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto animate-fade-in">
            <div className="mb-6">
                <Button variant="ghost" asChild>
                    <Link href="/case-studies">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Case Studies
                    </Link>
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Create New Case Study</CardTitle>
                    <CardDescription>Start a new case study for department requests</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="name">Case Study Name *</Label>
                            <Input
                                id="name"
                                name="name"
                                placeholder="Enter case study name"
                                required
                            />
                        </div>

                        <div className="space-y-2"><Label>PMO work area</Label><Select value={workAreaId} onValueChange={setWorkAreaId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unclassified">Unclassified</SelectItem>{workAreas.map((area) => <SelectItem key={area.id} value={area.id}>{area.name}</SelectItem>)}</SelectContent></Select></div>

                        <div className="space-y-2">
                            <Label htmlFor="brief">Brief / Description</Label>
                            <Textarea
                                id="brief"
                                name="brief"
                                placeholder="Describe the case study requirements..."
                                rows={4}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="dueAt">Due Date</Label>
                            <Input
                                id="dueAt"
                                name="dueAt"
                                type="date"
                            />
                        </div>

                        {/* Make Floating Option */}
                        <div className="flex items-center space-x-2 p-3 border rounded-md bg-muted/30">
                            <Checkbox
                                id="makeFloating"
                                checked={makeFloating}
                                onCheckedChange={(checked) => setMakeFloating(checked as boolean)}
                            />
                            <Users className="h-4 w-4 text-muted-foreground" />
                            <div>
                                <Label htmlFor="makeFloating" className="cursor-pointer">Make Floating (Team Pool)</Label>
                                <p className="text-xs text-muted-foreground">No owner assigned - any team member can claim it</p>
                            </div>
                        </div>

                        <div className="flex gap-4 pt-4">
                            <Button type="submit" disabled={loading}>
                                {loading ? "Creating..." : "Create Case Study"}
                            </Button>
                            <Button type="button" variant="outline" onClick={() => router.back()}>
                                Cancel
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
