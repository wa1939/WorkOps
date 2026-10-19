"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

interface DeleteButtonProps {
    entityType: "task" | "project" | "case-study";
    entityId: string;
    entityName: string;
    redirectUrl?: string;
    onSuccess?: () => void;
    size?: "sm" | "default" | "lg" | "icon";
    variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
}

export function DeleteButton({
    entityType,
    entityId,
    entityName,
    redirectUrl,
    onSuccess,
    size = "sm",
    variant = "ghost",
}: DeleteButtonProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);

    const apiPath = entityType === "case-study" ? "case-studies" : `${entityType}s`;

    const handleDelete = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/${apiPath}/${entityId}`, {
                method: "DELETE",
            });

            if (res.ok) {
                setOpen(false);
                if (onSuccess) {
                    onSuccess();
                }
                if (redirectUrl) {
                    router.push(redirectUrl);
                } else {
                    router.refresh();
                }
            } else {
                const errorData = await res.json();
                toast({ title: "Error", description: `Failed to delete: ${errorData.error || "Unknown error"}`, variant: "destructive" });
            }
        } catch (error) {
            console.error(`Error deleting ${entityType}:`, error);
            toast({ title: "Error", description: `Error deleting ${entityType}`, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>
                <Button
                    size={size}
                    variant={variant}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                    <Trash2 className="h-4 w-4" />
                    {size !== "icon" && <span className="ml-1">Delete</span>}
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This will permanently delete <strong>{entityName}</strong>. This action
                        cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleDelete}
                        disabled={loading}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                        {loading ? "Deleting..." : "Delete"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
