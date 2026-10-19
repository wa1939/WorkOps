"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import Link from "next/link";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleEmailLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        const result = await signIn("credentials", {
            email,
            password,
            redirect: false,
            callbackUrl: "/"
        });

        if (result?.error) {
            setError(result.error);
            setLoading(false);
        } else if (result?.ok) {
            window.location.href = "/";
        } else {
            setLoading(false);
        }
    };

    const handleAzureLogin = async () => {
        setLoading(true);
        await signIn("microsoft-entra-id", { callbackUrl: "/" });
        setLoading(false);
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
            {/* Background decoration */}
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-violet-500/20 to-transparent rounded-full blur-3xl" />
                <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-purple-500/20 to-transparent rounded-full blur-3xl" />
            </div>


            <Card className="w-full max-w-md relative bg-background/95 backdrop-blur border-border/50">
                <CardHeader className="text-center space-y-4">
                    <div className="mx-auto flex items-center justify-center w-16 h-16 rounded-2xl shadow-lg shadow-primary/20 overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/icons/app-192.png" alt="WorkOps" width={64} height={64} className="w-16 h-16" />
                    </div>
                    <CardTitle className="text-2xl font-bold">WorkOps</CardTitle>
                    <CardDescription>
                        Team tasks, planning and operations
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Tabs defaultValue="email" className="space-y-4">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="email">Email</TabsTrigger>
                            <TabsTrigger value="microsoft">Microsoft</TabsTrigger>
                        </TabsList>

                        <TabsContent value="email" className="space-y-4">
                            <form onSubmit={handleEmailLogin} className="space-y-4">
                                {error && (
                                    <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                                        {error}
                                    </div>
                                )}
                                <div className="space-y-2">
                                    <Label htmlFor="email">Email</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="you@example.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <div className="flex justify-between">
                                        <Label htmlFor="password">Password</Label>
                                        <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                                            Forgot password?
                                        </Link>
                                    </div>
                                    <Input
                                        id="password"
                                        type="password"
                                        placeholder="Your password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                    />
                                </div>
                                <Button type="submit" disabled={loading} className="w-full" size="lg">
                                    {loading ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Signing in...
                                        </>
                                    ) : (
                                        "Sign In"
                                    )}
                                </Button>
                            </form>
                        </TabsContent>

                        <TabsContent value="microsoft" className="space-y-4">
                            <Button
                                onClick={handleAzureLogin}
                                disabled={loading}
                                className="w-full bg-[#0078d4] hover:bg-[#106ebe] text-white"
                                size="lg"
                            >
                                <svg className="mr-2 h-5 w-5" viewBox="0 0 21 21" fill="currentColor">
                                    <path d="M0 0h10v10H0V0zm11 0h10v10H11V0zM0 11h10v10H0V11zm11 0h10v10H11V11z" />
                                </svg>
                                Sign in with Microsoft
                            </Button>
                            <p className="text-xs text-center text-muted-foreground">
                                Use your organizational account to sign in
                            </p>
                        </TabsContent>
                    </Tabs>

                    <div className="mt-6 text-center text-sm text-muted-foreground">
                        Don&apos;t have an account?{" "}
                        <Link href="/signup" className="text-primary hover:underline">
                            Sign up
                        </Link>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
