"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { EvidenceList } from "./evidence-list";
import { ExternalResponsibilityCard } from "./external-responsibility-card";
import { FollowUpDraftPanel } from "./follow-up-draft-panel";
import { LifecycleDialog } from "./lifecycle-dialog";

type Props = {
    taskId: string;
    status: string;
    canManage: boolean;
    cancellationReason: string | null;
    owner: { name: string };
    contact: { name: string; email: string; department: string | null; organization: string | null };
    parentName: string;
    workAreaName: string;
    evidence: Array<{ id: string; label: string; url: string; createdAt: string }>;
};

export function ActionDetailPanel(props: Props) {
    const router = useRouter();
    const [error, setError] = useState("");
    const isTerminal = props.status === "DONE" || props.status === "CANCELED";

    async function response(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const comment = String(new FormData(event.currentTarget).get("comment"));
        const result = await fetch(`/api/pmo/actions/${props.taskId}/responses`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ comment }),
        });
        const body = await result.json();
        if (!result.ok) {
            setError(body.error);
            return;
        }
        event.currentTarget.reset();
        router.refresh();
    }

    return (
        <div className="space-y-6">
            <ExternalResponsibilityCard
                owner={props.owner}
                contact={props.contact}
                parentName={props.parentName}
                workAreaName={props.workAreaName}
                cancellationReason={props.cancellationReason}
            />
            <FollowUpDraftPanel taskId={props.taskId} canManage={props.canManage} />
            <Card>
                <CardHeader>
                    <CardTitle>Evidence</CardTitle>
                </CardHeader>
                <CardContent>
                    <EvidenceList taskId={props.taskId} initialEvidence={props.evidence} canManage={props.canManage} />
                </CardContent>
            </Card>
            {props.canManage && (
                <Card id="update-action">
                    <CardHeader>
                        <CardTitle>Update action</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {isTerminal ? (
                            <p className="text-sm text-muted-foreground">
                                This action is closed. Reopen it to record responses or make changes.
                            </p>
                        ) : (
                            <form onSubmit={response} className="flex flex-col gap-2 sm:flex-row">
                                <Textarea
                                    name="comment"
                                    aria-label="External response"
                                    placeholder="Record the external response"
                                    required
                                />
                                <Button>Record response</Button>
                            </form>
                        )}
                        <div className="flex flex-wrap gap-2">
                            {isTerminal ? (
                                <LifecycleDialog
                                    taskId={props.taskId}
                                    action="reopen"
                                    onDone={() => router.refresh()}
                                />
                            ) : (
                                <>
                                    <LifecycleDialog
                                        taskId={props.taskId}
                                        action="close"
                                        onDone={() => router.refresh()}
                                    />
                                    <LifecycleDialog
                                        taskId={props.taskId}
                                        action="cancel"
                                        onDone={() => router.refresh()}
                                    />
                                </>
                            )}
                        </div>
                        {error && <p className="text-sm text-destructive">{error}</p>}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
