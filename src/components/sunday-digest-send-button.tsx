"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Send } from "lucide-react";
import { useRouter } from "next/navigation";

export function SundayDigestSendButton() {
    const { toast } = useToast();
    const router = useRouter();
    const [sending, setSending] = useState(false);

    const send = async () => {
        setSending(true);
        try {
            const res = await fetch("/api/cron/sunday-digest", { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
            const mail = data.mail;
            if (mail?.skipped) {
                toast({
                    title: "Report saved (no email)",
                    description: mail.reason || "Delivery skipped. Configure recipients in Admin → Settings → Reporting.",
                });
            } else {
                toast({
                    title: "Sunday digest sent",
                    description: `Delivered to ${mail?.recipients?.length ?? 0} recipient(s).`,
                });
            }
            router.refresh();
        } catch (e) {
            toast({ variant: "destructive", title: "Send failed", description: (e as Error).message });
        } finally {
            setSending(false);
        }
    };

    return (
        <Button variant="outline" onClick={send} disabled={sending}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send Sunday Digest
        </Button>
    );
}
