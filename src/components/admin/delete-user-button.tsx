"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { Button } from "@/components/ui/button";
import { Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface DeleteUserButtonProps {
    userId: string;
    userName: string;
    userEmail: string;
    currentUserId: string;
}

export function DeleteUserButton({ userId, userName, userEmail, currentUserId }: DeleteUserButtonProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [confirmText, setConfirmText] = useState("");

    const isSelf = userId === currentUserId;

    const handleDelete = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/users/${userId}`, {
                method: "DELETE",
            });

            if (res.ok) {
                toast({
                    title: "User Deleted",
                    description: `${userName} has been removed permanently`,
                    variant: "success",
                });
                setConfirmText("");
                router.refresh();
            } else {
                const data = await res.json();
                toast({
                    title: "Error",
                    description: data.error || "Failed to delete user",
                    variant: "destructive",
                });
            }
        } catch {
            toast({ title: "Error", description: "Failed to delete user", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    if (isSelf) {
        return (
            <Button
                variant="ghost"
                size="icon"
                disabled
                title="Cannot delete yourself"
                className="text-muted-foreground/50"
            >
                <Trash2 className="h-4 w-4" />
            </Button>
        );
    }

    const canConfirm = confirmText.trim().toLowerCase() === userEmail.toLowerCase();

    return (
        <AlertDialog onOpenChange={(open) => !open && setConfirmText("")}>
            <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600 hover:bg-red-500/10">
                    <Trash2 className="h-4 w-4" />
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-red-600">Delete User</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="space-y-3">
                            <p>
                                This will permanently delete <strong>{userName}</strong> ({userEmail}).
                                Their owned projects, case studies, and KPIs will have their ownership cleared.
                                Task assignments, comments, and notifications will be removed.
                            </p>
                            <p className="text-red-500">This action cannot be undone.</p>
                            <div>
                                <label className="text-sm font-medium text-foreground">
                                    Type <code className="px-1 py-0.5 rounded bg-muted">{userEmail}</code> to confirm:
                                </label>
                                <input
                                    type="text"
                                    value={confirmText}
                                    onChange={(e) => setConfirmText(e.target.value)}
                                    placeholder={userEmail}
                                    className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                />
                            </div>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleDelete}
                        disabled={loading || !canConfirm}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Delete Permanently
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
