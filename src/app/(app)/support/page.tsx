"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import {
    AlertCircle,
    CheckCircle2,
    Clock,
    MessageSquare,
    User,
    ArrowRight,
    Search
} from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type SupportRequest = {
    id: string;
    title: string;
    description: string | null;
    status: string;
    createdAt: string;
    requester: {
        name: string | null;
        image: string | null;
    };
    claimedBy?: {
        name: string | null;
        image: string | null;
    } | null;
    project?: {
        id: string;
        name: string;
    } | null;
    task?: {
        id: string;
        title: string;
    } | null;
};

export default function SupportPage() {
    const { toast } = useToast();
    const [requests, setRequests] = useState<SupportRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");

    // Fetch requests
    const fetchRequests = async () => {
        try {
            const res = await fetch("/api/support");
            if (!res.ok) throw new Error("Failed to fetch requests");
            const data = await res.json();
            setRequests(data);
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Failed to load support requests", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchRequests();
    }, []);

    // Handle Claim
    const handleClaim = async (id: string) => {
        try {
            const res = await fetch(`/api/support/${id}/claim`, {
                method: "POST",
            });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error || "Failed to claim request");
            }

            toast({ title: "Success", description: "You have claimed this request", variant: "success" });

            fetchRequests(); // Refresh list
        } catch (error) {
            toast({ title: "Error", description: error instanceof Error ? error.message : "Something went wrong", variant: "destructive" });
        }
    };

    // Filter requests
    const filteredRequests = requests.filter(req =>
        req.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        req.requester.name?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const openRequests = filteredRequests.filter(req => req.status === "Open");
    const claimedRequests = filteredRequests.filter(req => req.status !== "Open");

    return (
        <div className="container mx-auto py-8 space-y-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" dir="auto">Support Requests</h1>
                    <p className="text-muted-foreground mt-1">
                        View and manage support requests from the team.
                    </p>
                </div>
                <div className="relative w-full md:w-64">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search requests..."
                        className="pl-8"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            <Tabs defaultValue="open" className="w-full">
                <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
                    <TabsTrigger value="open">
                        Open
                        <Badge variant="secondary" className="ml-2">{openRequests.length}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="claimed">
                        Claimed / Resolved
                        <Badge variant="secondary" className="ml-2">{claimedRequests.length}</Badge>
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="open" className="mt-6 space-y-4">
                    {isLoading ? (
                        <div>Loading...</div>
                    ) : openRequests.length === 0 ? (
                        <EmptyState
                            title="No open requests"
                            description="Great job! There are no pending support requests."
                        />
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {openRequests.map(req => (
                                <RequestCard key={req.id} request={req} onClaim={() => handleClaim(req.id)} />
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="claimed" className="mt-6 space-y-4">
                    {isLoading ? (
                        <div>Loading...</div>
                    ) : claimedRequests.length === 0 ? (
                        <EmptyState
                            title="No claimed requests"
                            description="Requests you or others have claimed will appear here."
                        />
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {claimedRequests.map(req => (
                                <RequestCard key={req.id} request={req} isClaimed />
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}

function RequestCard({ request, onClaim, isClaimed = false }: { request: SupportRequest; onClaim?: () => void; isClaimed?: boolean }) {
    return (
        <Card className="flex flex-col h-full hover:shadow-md transition-shadow" data-entity="support-request" data-entity-id={request.id}>
            <CardHeader className="pb-3">
                <div className="flex justify-between items-start gap-2">
                    <div className="flex items-center gap-2">
                        <Badge variant={isClaimed ? "outline" : "default"} className={isClaimed ? "bg-green-50 text-green-700 border-green-200" : "bg-blue-500 hover:bg-blue-600"}>
                            {request.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {format(new Date(request.createdAt), "MMM d")}
                        </span>
                    </div>
                </div>
                <CardTitle className="text-lg font-semibold mt-2 line-clamp-2" title={request.title}>
                    {request.title}
                </CardTitle>
                <CardDescription className="line-clamp-2 mt-1">
                    {request.description || "No description provided."}
                </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 pb-3">
                <div className="space-y-3 text-sm">
                    {/* Context Links */}
                    {(request.project || request.task) && (
                        <div className="flex flex-col gap-1 p-2 bg-muted/50 rounded-md">
                            {request.project && (
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <span className="font-medium text-xs uppercase">Project:</span>
                                    <span className="truncate">{request.project.name}</span>
                                </div>
                            )}
                            {request.task && (
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <span className="font-medium text-xs uppercase">Task:</span>
                                    <span className="truncate">{request.task.title}</span>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex items-center justify-between pt-2">
                        <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6">
                                <AvatarImage src={request.requester.image || ""} />
                                <AvatarFallback>{getInitials(request.requester.name || "U")}</AvatarFallback>
                            </Avatar>
                            <span className="text-xs text-muted-foreground">
                                Requested by <span className="font-medium text-foreground">{request.requester.name}</span>
                            </span>
                        </div>
                    </div>

                    {isClaimed && request.claimedBy && (
                        <div className="flex items-center justify-between border-t pt-2 mt-2">
                            <div className="flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-green-600" />
                                <span className="text-xs text-muted-foreground">
                                    Claimed by <span className="font-medium text-foreground">{request.claimedBy.name}</span>
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </CardContent>
            {!isClaimed && (
                <CardFooter className="pt-2 border-t bg-muted/20">
                    <Button onClick={onClaim} className="w-full gap-2" size="sm">
                        <User className="w-4 h-4" />
                        Claim Request
                    </Button>
                </CardFooter>
            )}
        </Card>
    );
}

function EmptyState({ title, description }: { title: string; description: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed rounded-lg bg-muted/30">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <MessageSquare className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">{title}</h3>
            <p className="text-sm text-muted-foreground max-w-sm mt-1">{description}</p>
        </div>
    );
}
