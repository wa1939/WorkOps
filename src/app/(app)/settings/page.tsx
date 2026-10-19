"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { User, Bell, Palette, Shield, Loader2, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { NotificationSnooze } from "@/components/notification-snooze";
import { NotificationPreferences } from "@/components/notifications/preferences";
import { PushSettings } from "@/components/notifications/push-settings";

interface UserProfile {
    id: string;
    name: string;
    email: string;
    title: string | null;
    timezone: string;
    capacityPerWeekHours: number;
    quietUntil: string | null;
}

export default function SettingsPage() {
    const router = useRouter();
    const { toast } = useToast();
    const { theme, setTheme } = useTheme();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [profile, setProfile] = useState<UserProfile | null>(null);

    // Deep link support: /settings?tab=notifications opens that tab directly
    // (the push onboarding flow routes here).
    const initialTab = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "notifications"
        ? "notifications"
        : "profile";
    const [tab, setTab] = useState(initialTab);

    // Password change
    const [changingPassword, setChangingPassword] = useState(false);
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);

    useEffect(() => {
        fetch("/api/users/me")
            .then((r) => {
                if (!r.ok) throw new Error("Failed to load profile");
                return r.json();
            })
            .then((data) => {
                setProfile(data);
                setLoading(false);
            })
            .catch(() => {
                toast({ title: "Error", description: "Failed to load profile settings", variant: "destructive" });
                setLoading(false);
            });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleChangePassword = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setChangingPassword(true);

        const formData = new FormData(e.currentTarget);
        const currentPassword = formData.get("currentPassword") as string;
        const newPassword = formData.get("newPassword") as string;
        const confirmPassword = formData.get("confirmPassword") as string;

        if (newPassword !== confirmPassword) {
            toast({ title: "Error", description: "New passwords do not match", variant: "destructive" });
            setChangingPassword(false);
            return;
        }

        try {
            const res = await fetch("/api/users/me/password", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ currentPassword, newPassword }),
            });

            const data = await res.json();

            if (res.ok) {
                toast({ title: "Success", description: "Password changed successfully!", variant: "success" });
                e.currentTarget.reset();
            } else {
                toast({ title: "Error", description: data.error || "Failed to change password", variant: "destructive" });
            }
        } catch {
            toast({ title: "Error", description: "Error changing password", variant: "destructive" });
        } finally {
            setChangingPassword(false);
        }
    };

    const handleSaveProfile = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSaving(true);

        const formData = new FormData(e.currentTarget);
        const data = {
            name: formData.get("name") as string,
            title: formData.get("title") as string,
            timezone: formData.get("timezone") as string,
            capacityPerWeekHours: parseFloat(formData.get("capacityPerWeekHours") as string),
        };

        try {
            const res = await fetch("/api/users/me", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });

            if (res.ok) {
                toast({ title: "Success", description: "Profile saved successfully!", variant: "success" });
                router.refresh();
            } else {
                toast({ title: "Error", description: "Failed to save profile", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Error saving profile", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
            <div>
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" dir="auto">Settings</h1>
                <p className="text-sm text-muted-foreground">Manage your account and preferences</p>
            </div>

            <Tabs value={tab} onValueChange={setTab} className="space-y-4">
                <div className="-mx-6 overflow-x-auto px-6 md:mx-0 md:px-0" style={{ scrollbarWidth: "none" }}>
                    <TabsList className="w-max min-w-full md:w-full md:min-w-0">
                    <TabsTrigger value="profile" className="gap-2 min-h-[44px] flex-1 md:flex-none">
                        <User className="h-4 w-4" />
                        Profile
                    </TabsTrigger>
                    <TabsTrigger value="notifications" className="gap-2 min-h-[44px] flex-1 md:flex-none">
                        <Bell className="h-4 w-4" />
                        Notifications
                    </TabsTrigger>
                    <TabsTrigger value="security" className="gap-2 min-h-[44px] flex-1 md:flex-none">
                        <Shield className="h-4 w-4" />
                        Security
                    </TabsTrigger>
                    <TabsTrigger value="appearance" className="gap-2 min-h-[44px] flex-1 md:flex-none">
                        <Palette className="h-4 w-4" />
                        Appearance
                    </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="profile">
                    <Card>
                        <CardHeader>
                            <CardTitle>Profile Settings</CardTitle>
                            <CardDescription>Update your personal information</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleSaveProfile} className="space-y-6">
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="name">Full Name</Label>
                                        <Input
                                            id="name"
                                            name="name"
                                            defaultValue={profile?.name || ""}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="email">Email</Label>
                                        <Input
                                            id="email"
                                            name="email"
                                            defaultValue={profile?.email || ""}
                                            disabled
                                        />
                                    </div>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="title">Job Title</Label>
                                        <Input
                                            id="title"
                                            name="title"
                                            placeholder="e.g., Project Manager"
                                            defaultValue={profile?.title || ""}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="timezone">Timezone</Label>
                                        <Select name="timezone" defaultValue={profile?.timezone || "Asia/Riyadh"}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select timezone" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Asia/Riyadh">Riyadh (GMT+3)</SelectItem>
                                                <SelectItem value="Asia/Dubai">Dubai (GMT+4)</SelectItem>
                                                <SelectItem value="Asia/Kolkata">Mumbai (GMT+5:30)</SelectItem>
                                                <SelectItem value="Asia/Shanghai">Shanghai (GMT+8)</SelectItem>
                                                <SelectItem value="Asia/Tokyo">Tokyo (GMT+9)</SelectItem>
                                                <SelectItem value="Asia/Singapore">Singapore (GMT+8)</SelectItem>
                                                <SelectItem value="Europe/London">London (GMT)</SelectItem>
                                                <SelectItem value="Europe/Paris">Paris (GMT+1)</SelectItem>
                                                <SelectItem value="Europe/Berlin">Berlin (GMT+1)</SelectItem>
                                                <SelectItem value="Europe/Istanbul">Istanbul (GMT+3)</SelectItem>
                                                <SelectItem value="Africa/Cairo">Cairo (GMT+2)</SelectItem>
                                                <SelectItem value="America/New_York">New York (EST)</SelectItem>
                                                <SelectItem value="America/Chicago">Chicago (CST)</SelectItem>
                                                <SelectItem value="America/Denver">Denver (MST)</SelectItem>
                                                <SelectItem value="America/Los_Angeles">Los Angeles (PST)</SelectItem>
                                                <SelectItem value="America/Toronto">Toronto (EST)</SelectItem>
                                                <SelectItem value="America/Sao_Paulo">São Paulo (GMT-3)</SelectItem>
                                                <SelectItem value="Australia/Sydney">Sydney (GMT+11)</SelectItem>
                                                <SelectItem value="Pacific/Auckland">Auckland (GMT+12)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="capacityPerWeekHours">Weekly Capacity (hours)</Label>
                                    <Input
                                        id="capacityPerWeekHours"
                                        name="capacityPerWeekHours"
                                        type="number"
                                        step="1"
                                        min="0"
                                        max="60"
                                        defaultValue={profile?.capacityPerWeekHours || 35}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        How many hours per week you&apos;re available for tasks
                                    </p>
                                </div>

                                <Button type="submit" disabled={saving}>
                                    {saving ? "Saving..." : "Save Changes"}
                                </Button>
                            </form>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="notifications" className="space-y-4">
                    <div id="push-notifications" aria-label="Push notifications for this device">
                        <PushSettings />
                    </div>
                    <NotificationSnooze initialQuietUntil={profile?.quietUntil ?? null} />
                    <NotificationPreferences />
                </TabsContent>

                <TabsContent value="security">
                    <Card>
                        <CardHeader>
                            <CardTitle>Change Password</CardTitle>
                            <CardDescription>Update your account password</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
                                <div className="space-y-2">
                                    <Label htmlFor="currentPassword">Current Password</Label>
                                    <div className="relative">
                                        <Input
                                            id="currentPassword"
                                            name="currentPassword"
                                            type={showCurrentPassword ? "text" : "password"}
                                            required
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        >
                                            {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="newPassword">New Password</Label>
                                    <div className="relative">
                                        <Input
                                            id="newPassword"
                                            name="newPassword"
                                            type={showNewPassword ? "text" : "password"}
                                            required
                                            minLength={8}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowNewPassword(!showNewPassword)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        >
                                            {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Min 8 characters, with uppercase, lowercase, and a number or special character
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="confirmPassword">Confirm New Password</Label>
                                    <Input
                                        id="confirmPassword"
                                        name="confirmPassword"
                                        type="password"
                                        required
                                        minLength={8}
                                    />
                                </div>
                                <Button type="submit" disabled={changingPassword}>
                                    {changingPassword ? "Changing..." : "Change Password"}
                                </Button>
                            </form>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="appearance">
                    <Card>
                        <CardHeader>
                            <CardTitle>Appearance</CardTitle>
                            <CardDescription>Customize how the app looks</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-2">
                                <Label>Theme</Label>
                                <Select value={theme} onValueChange={setTheme}>
                                    <SelectTrigger className="w-full sm:w-[200px]">
                                        <SelectValue placeholder="Select theme" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="light">Light</SelectItem>
                                        <SelectItem value="dark">Dark</SelectItem>
                                        <SelectItem value="system">System</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
