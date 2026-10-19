import { InstallPrompt } from "@/components/pwa/install-prompt";
import { RegisterWorker } from "@/components/pwa/register-worker";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar, Topbar } from "@/components/layout/sidebar";
import { MobileNavigation } from "@/components/layout/mobile-navigation";
import { OverdueReminder } from "@/components/overdue-reminder";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { ChatWidget } from "@/components/ai-chat/chat-widget";
import { SabahEntry } from "@/components/sabah/sabah-entry";
import { SabahOnboarding } from "@/components/sabah/sabah-onboarding";
import { PwaUpdatePrompt } from "@/components/pwa/update-prompt";
import { SabahProvider } from "@/components/sabah/state/sabah-context";
import { getSabahFlags } from "@/lib/sabah/flags";
import { CommandPalette } from "@/components/cmd/CommandPalette";
import type { Metadata } from "next";

/**
 * Authenticated application shell: never indexed. Search engines must only
 * find the public marketing page; this route-level noindex (not just a
 * robots.txt disallow) is the authoritative signal.
 */
export const metadata: Metadata = {
    robots: { index: false, follow: false },
};

export default async function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();

    if (!session?.user) {
        redirect("/login");
    }

    const sabahPlatform = getSabahFlags().platform;

    return (
        <SabahProvider>
        <div className="flex h-screen overflow-hidden">
            <Sidebar user={session.user} />
            <div className="flex-1 flex flex-col overflow-hidden">
                <Topbar user={session.user} />
                <main className="flex-1 overflow-auto p-4 pb-24 sm:p-6 md:pb-6">{children}</main>
            </div>
            <OverdueReminder userId={session.user.id} />
            <KeyboardShortcuts />
            <CommandPalette isAdmin={session.user.role === "ADMIN"} />
            <SabahEntry platformEnabled={sabahPlatform} />
        </div>
            <RegisterWorker />
            <PwaUpdatePrompt />
            <InstallPrompt />
            {sabahPlatform ? <SabahOnboarding /> : null}
            <MobileNavigation />
        </SabahProvider>
    );
}
