"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Edit, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface EditUserDialogProps {
    user: {
        id: string;
        name: string;
        role: string;
        isActive: boolean;
        capacityPerWeekHours: number;
        managerId?: string | null;
    };
    /** All active users available to become a manager (excluding self). */
    managerChoices?: { id: string; name: string }[];
}

const NO_MANAGER = "__none__";

export function EditUserDialog({ user, managerChoices = [] }: EditUserDialogProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState(user.name);
    const [role, setRole] = useState(user.role);
    const [isActive, setIsActive] = useState(user.isActive);
    const [managerId, setManagerId] = useState<string>(user.managerId ?? NO_MANAGER);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const res = await fetch(`/api/admin/users/${user.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(),
                    role,
                    isActive,
                    managerId: managerId === NO_MANAGER ? null : managerId,
                }),
            });

            if (res.ok) {
                toast({ title: "User Updated", description: `${user.name} has been updated`, variant: "success" });
                setOpen(false);
                router.refresh();
            } else {
                const data = await res.json();
                toast({ title: "Error", description: data.error || "Failed to update user", variant: "destructive" });
            }
        } catch {
            toast({ title: "Error", description: "Failed to update user", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon">
                    <Edit className="h-4 w-4" />
                </Button>
            </DialogTrigger>
            <DialogContent>
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Edit User</DialogTitle>
                        <DialogDescription>Manage {user.name}&apos;s role and status</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <Label htmlFor="user-name">Full Name</Label>
                            <Input
                                id="user-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Ahmed Al-Saud"
                                className="mt-2"
                                required
                                minLength={1}
                                maxLength={100}
                            />
                        </div>
                        <div>
                            <Label>Role</Label>
                            <Select value={role} onValueChange={setRole}>
                                <SelectTrigger className="mt-2">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ADMIN">Admin</SelectItem>
                                    <SelectItem value="MANAGER">Manager</SelectItem>
                                    <SelectItem value="MEMBER">Member</SelectItem>
                                    <SelectItem value="VIEWER">Viewer</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Manager (reports to)</Label>
                            <Select value={managerId} onValueChange={setManagerId}>
                                <SelectTrigger className="mt-2">
                                    <SelectValue placeholder="No manager" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NO_MANAGER}>— No manager —</SelectItem>
                                    {managerChoices
                                        .filter((c) => c.id !== user.id)
                                        .map((c) => (
                                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                        ))}
                                </SelectContent>
                            </Select>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Wires the department org tree — used by the Sunday digest and team-transparency views.
                            </p>
                        </div>
                        <div className="flex items-center justify-between">
                            <Label htmlFor="user-active">Active</Label>
                            <Switch
                                id="user-active"
                                checked={isActive}
                                onCheckedChange={setIsActive}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
