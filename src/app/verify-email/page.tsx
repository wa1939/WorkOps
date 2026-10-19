"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import Link from "next/link";

function VerifyEmailContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
    const [message, setMessage] = useState("");

    useEffect(() => {
        const token = searchParams.get("token");

        if (!token) {
            setStatus("error");
            setMessage("No verification token provided");
            return;
        }

        const verifyEmail = async () => {
            try {
                const res = await fetch("/api/auth/verify-email", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ token }),
                });

                const result = await res.json();

                if (!res.ok) {
                    throw new Error(result.error);
                }

                setStatus("success");
                setMessage(result.message);
            } catch (err: unknown) {
                setStatus("error");
                setMessage(err instanceof Error ? err.message : "Verification failed");
            }
        };

        verifyEmail();
    }, [searchParams]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    {status === "loading" && (
                        <>
                            <Loader2 className="mx-auto h-12 w-12 text-primary animate-spin mb-4" />
                            <CardTitle>Verifying Email</CardTitle>
                            <CardDescription>Please wait...</CardDescription>
                        </>
                    )}
                    {status === "success" && (
                        <>
                            <CheckCircle className="mx-auto h-12 w-12 text-green-500 mb-4" />
                            <CardTitle>Email Verified!</CardTitle>
                            <CardDescription>{message}</CardDescription>
                        </>
                    )}
                    {status === "error" && (
                        <>
                            <XCircle className="mx-auto h-12 w-12 text-destructive mb-4" />
                            <CardTitle>Verification Failed</CardTitle>
                            <CardDescription>{message}</CardDescription>
                        </>
                    )}
                </CardHeader>
                <CardContent className="text-center">
                    {status !== "loading" && (
                        <Button asChild>
                            <Link href="/login">Go to Login</Link>
                        </Button>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

export default function VerifyEmailPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        }>
            <VerifyEmailContent />
        </Suspense>
    );
}
