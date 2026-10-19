import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    Users,
    Building2,
    Tag,
    Plus,
    Star,
    Megaphone,
    Activity,
} from "lucide-react";
import { getInitials } from "@/lib/utils";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AddDepartmentDialog } from "@/components/admin/add-department-dialog";
import { AddTagDialog } from "@/components/admin/add-tag-dialog";
import { EditUserDialog } from "@/components/admin/edit-user-dialog";
import { DeleteUserButton } from "@/components/admin/delete-user-button";
import { DeleteDepartmentButton } from "@/components/admin/delete-department-button";
import { AnnouncementsManager } from "@/components/admin/announcements-manager";
import { SabahModelSettingsSection } from "@/components/admin/sabah-model-settings-section";
import { SabahPlaybooks } from "@/components/admin/sabah-playbooks";
import { getLearningDependencies } from "@/lib/sabah/capabilities/modules/learning";
import { SabahConnectors } from "@/components/admin/sabah-connectors";
import { BackgroundJobs } from "@/components/sabah/workflow/background-jobs";
import { SystemDiagnostics } from "@/components/admin/system-diagnostics";

async function getAdminData(actorId: string) {
    const users = await prisma.user.findMany({
        include: { departments: { include: { department: true } } },
        orderBy: { name: "asc" },
    });
    const managerChoices = users
        .filter((u) => u.isActive)
        .map((u) => ({ id: u.id, name: u.name || u.email }));
    const playbooks = await getLearningDependencies().playbooks.list();

    const departments = await prisma.department.findMany({
        include: { _count: { select: { users: true } } },
        orderBy: { name: "asc" },
    });

    const tags = await prisma.tag.findMany({
        include: { _count: { select: { taskTags: true, noteTags: true } } },
        orderBy: { name: "asc" },
    });

    const savedViews = await prisma.savedView.findMany({
        where: { scope: "TEAM" },
        include: { owner: true },
        orderBy: { name: "asc" },
    });
    const activeJobs = await prisma.aiJob.findMany({
        where: { actorId, status: { in: ["QUEUED", "LEASED", "RUNNING", "WAITING_APPROVAL", "RETRY_WAIT"] } },
        select: { id: true },
        orderBy: { createdAt: "desc" },
        take: 20,
    });

    return { users, departments, tags, savedViews, managerChoices, playbooks, activeJobIds: activeJobs.map((job) => job.id) };
}

const roleColors: Record<string, string> = {
    ADMIN: "bg-red-500/10 text-red-600",
    MANAGER: "bg-purple-500/10 text-purple-600",
    MEMBER: "bg-blue-500/10 text-blue-600",
    VIEWER: "bg-gray-500/10 text-gray-600",
};

export default async function AdminPage() {
    const session = await auth();

    if (!session?.user || session.user.role !== "ADMIN") {
        redirect("/dashboard");
    }

    const { users, departments, tags, savedViews, managerChoices, playbooks, activeJobIds } = await getAdminData(session.user.id);

    return (
        <div className="space-y-6 animate-fade-in">
            <div>
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" dir="auto">Admin</h1>
                <p className="text-muted-foreground">Manage users, departments, tags, and saved views</p>
            </div>

            <Tabs defaultValue="users" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="users" className="gap-2">
                        <Users className="h-4 w-4" />
                        Users
                    </TabsTrigger>
                    <TabsTrigger value="departments" className="gap-2">
                        <Building2 className="h-4 w-4" />
                        Departments
                    </TabsTrigger>
                    <TabsTrigger value="tags" className="gap-2">
                        <Tag className="h-4 w-4" />
                        Tags
                    </TabsTrigger>
                    <TabsTrigger value="views" className="gap-2">
                        <Star className="h-4 w-4" />
                        Saved Views
                    </TabsTrigger>
                    <TabsTrigger value="announcements" className="gap-2">
                        <Megaphone className="h-4 w-4" />
                        Announcements
                    </TabsTrigger>
                    <TabsTrigger value="ai-models" className="gap-2">
                        AI Models
                    </TabsTrigger>
                    <TabsTrigger value="sabah-playbooks" className="gap-2">
                        Sabah Playbooks
                    </TabsTrigger>
                    <TabsTrigger value="sabah-connectors" className="gap-2">
                        Sabah Connectors
                    </TabsTrigger>
                    <TabsTrigger value="diagnostics" className="gap-2">
                        <Activity className="h-4 w-4" />
                        Diagnostics
                    </TabsTrigger>
                </TabsList>

                {/* Users Tab */}
                <TabsContent value="users">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Users</CardTitle>
                                <CardDescription>Manage team members and their roles</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3">
                                {users.map((user) => (
                                    <div
                                        key={user.id}
                                        className="flex items-center gap-4 p-4 rounded-lg border"
                                    >
                                        <Avatar className="h-10 w-10">
                                            <AvatarImage src={user.image || ""} />
                                            <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                                        </Avatar>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium">{user.name}</span>
                                                <Badge className={roleColors[user.role]}>{user.role}</Badge>
                                                {!user.isActive && <Badge variant="secondary">Inactive</Badge>}
                                            </div>
                                            <p className="text-sm text-muted-foreground">{user.email}</p>
                                            {user.departments.length > 0 && (
                                                <div className="flex gap-1 mt-1">
                                                    {user.departments.map((d) => (
                                                        <Badge key={d.id} variant="outline" className="text-xs">
                                                            {d.department.name}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-sm text-muted-foreground">
                                            Capacity: {user.capacityPerWeekHours}h/week
                                        </div>
                                        <div className="flex gap-1">
                                            <EditUserDialog
                                                user={{
                                                    id: user.id,
                                                    name: user.name,
                                                    role: user.role,
                                                    isActive: user.isActive,
                                                    capacityPerWeekHours: user.capacityPerWeekHours,
                                                    managerId: user.managerId,
                                                }}
                                                managerChoices={managerChoices}
                                            />
                                            <DeleteUserButton
                                                userId={user.id}
                                                userName={user.name}
                                                userEmail={user.email}
                                                currentUserId={session.user.id}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Departments Tab */}
                <TabsContent value="departments">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Departments</CardTitle>
                                <CardDescription>Manage organizational departments</CardDescription>
                            </div>
                            <AddDepartmentDialog />
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                                {departments.map((dept) => (
                                    <div
                                        key={dept.id}
                                        className="flex items-center justify-between p-4 rounded-lg border"
                                    >
                                        <div className="flex items-center gap-3">
                                            <Building2 className="h-5 w-5 text-muted-foreground" />
                                            <div>
                                                <p className="font-medium">{dept.name}</p>
                                                <p className="text-sm text-muted-foreground">
                                                    {dept._count.users} members
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex gap-1">
                                            <DeleteDepartmentButton
                                                departmentId={dept.id}
                                                departmentName={dept.name}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Tags Tab */}
                <TabsContent value="tags">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Tags</CardTitle>
                                <CardDescription>Manage task and note tags</CardDescription>
                            </div>
                            <AddTagDialog />
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-wrap gap-3">
                                {tags.map((tag) => (
                                    <div
                                        key={tag.id}
                                        className="flex items-center gap-2 px-3 py-2 rounded-lg border"
                                    >
                                        <div
                                            className="w-3 h-3 rounded-full"
                                            style={{ backgroundColor: tag.color }}
                                        />
                                        <span className="font-medium">{tag.name}</span>
                                        <Badge variant="secondary" className="text-xs">
                                            {tag._count.taskTags + tag._count.noteTags} uses
                                        </Badge>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Saved Views Tab */}
                <TabsContent value="views">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Team Saved Views</CardTitle>
                                <CardDescription>Custom filtered views visible to all team members</CardDescription>
                            </div>
                            <Button asChild className="max-sm:w-full">
                                <Link href="/views/new">
                                    <Plus className="mr-2 h-4 w-4" />
                                    Add View
                                </Link>
                            </Button>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3">
                                {savedViews.length === 0 ? (
                                    <p className="text-center text-muted-foreground py-8">
                                        No team saved views yet
                                    </p>
                                ) : (
                                    savedViews.map((view) => (
                                        <div
                                            key={view.id}
                                            className="flex items-center justify-between p-4 rounded-lg border"
                                        >
                                            <div className="flex items-center gap-3">
                                                <Star className="h-5 w-5 text-yellow-500" />
                                                <div>
                                                    <p className="font-medium">{view.name}</p>
                                                    <p className="text-sm text-muted-foreground">
                                                        {view.scope} view
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                {view.owner && (
                                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                        <span>Created by</span>
                                                        <Avatar className="h-6 w-6">
                                                            <AvatarImage src={view.owner.image || ""} />
                                                            <AvatarFallback className="text-xs">{getInitials(view.owner.name)}</AvatarFallback>
                                                        </Avatar>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Announcements Tab */}
                <TabsContent value="announcements">
                    <AnnouncementsManager />
                </TabsContent>
                <TabsContent value="ai-models">
                    <Card>
                        <CardHeader>
                            <CardTitle>Sabah Model Center</CardTitle>
                            <CardDescription>Providers, role assignments, and data policy for the Sabah copilot</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <SabahModelSettingsSection />
                        </CardContent>
                    </Card>
                </TabsContent>
                <TabsContent value="sabah-playbooks">
                    <SabahPlaybooks canDecide initialPlaybooks={playbooks} />
                </TabsContent>
                <TabsContent value="sabah-connectors">
                    <Card>
                        <CardHeader>
                            <CardTitle>Sabah Connectors</CardTitle>
                            <CardDescription>Manage bounded, signed automation integrations</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <SabahConnectors />
                            <div className="mt-6">
                                <BackgroundJobs statusUrls={activeJobIds.map((id) => ({ id, url: `/api/ai/jobs/${encodeURIComponent(id)}` }))} showEmpty />
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
                <TabsContent value="diagnostics">
                    <Card>
                        <CardHeader>
                            <CardTitle>Diagnostics</CardTitle>
                            <CardDescription>Inspect bounded system events and server-redacted AI transcripts</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <SystemDiagnostics />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
