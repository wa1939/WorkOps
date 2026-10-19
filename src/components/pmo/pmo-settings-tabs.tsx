"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";
import type { PmoSettingsTab } from "@/lib/pmo/settings-tab";

export function PmoSettingsTabs({
    initialTab,
    areasContent,
    contactsContent,
}: {
    initialTab: PmoSettingsTab;
    areasContent: ReactNode;
    contactsContent: ReactNode;
}) {
    const router = useRouter();
    const [tab, setTab] = useState<PmoSettingsTab>(initialTab);

    useEffect(() => setTab(initialTab), [initialTab]);

    function changeTab(value: string) {
        const next: PmoSettingsTab =
            value === "contacts" ? "contacts" : "areas";
        setTab(next);
        router.replace(`/pmo/settings?tab=${next}`, { scroll: false });
    }

    return (
        <Tabs value={tab} onValueChange={changeTab}>
            <TabsList>
                <TabsTrigger value="areas">Work Areas</TabsTrigger>
                <TabsTrigger value="contacts">External Contacts</TabsTrigger>
            </TabsList>
            <TabsContent value="areas" className="mt-5">
                {areasContent}
            </TabsContent>
            <TabsContent value="contacts" className="mt-5">
                {contactsContent}
            </TabsContent>
        </Tabs>
    );
}
